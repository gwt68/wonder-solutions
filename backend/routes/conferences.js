const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const pool = require('../db/pool');
const { requireAuth, requirePerm } = require('./auth');

router.use(requireAuth, requirePerm('can_use_conferences'));

function twilioClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !token) throw new Error('Twilio credentials are not configured');
  return twilio(sid, token);
}

// The conference that is open right now for this account, if any.
async function activeConference(userId) {
  const { rows } = await pool.query(
    `SELECT id, twilio_conference_sid FROM conferences
      WHERE user_id = $1 AND status = 'active' AND twilio_conference_sid IS NOT NULL
      ORDER BY id DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

// Who is on the call, named where the number matches a contact.
router.get('/live', async (req, res) => {
  try {
    const conf = await activeConference(req.userId);
    if (!conf) return res.json({ active: false, participants: [] });

    const list = await twilioClient().conferences(conf.twilio_conference_sid).participants.list({ limit: 50 });
    const callSids = list.map((p) => p.callSid);

    const { rows: named } = await pool.query(
      `SELECT ci.call_sid, ci.from_phone_number,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.name) AS contact_name
         FROM call_ins ci
         LEFT JOIN contacts c ON c.id = ci.contact_id
        WHERE ci.call_sid = ANY($1::text[])`,
      [callSids.length ? callSids : ['']]
    );
    const byCallSid = Object.fromEntries(named.map((r) => [r.call_sid, r]));

    res.json({
      active: true,
      conference_id: conf.id,
      participants: list.map((p) => ({
        call_sid: p.callSid,
        muted: p.muted,
        is_host: p.endConferenceOnExit,
        phone_number: byCallSid[p.callSid]?.from_phone_number || null,
        name: byCallSid[p.callSid]?.contact_name || null,
      })),
    });
  } catch (err) {
    console.error('conference live error:', err);
    res.status(500).json({ error: err.message || 'Could not read the conference' });
  }
});

// Mute or unmute everyone except the host.
router.post('/mute-all', async (req, res) => {
  const muted = req.body.muted !== false;
  try {
    const conf = await activeConference(req.userId);
    if (!conf) return res.status(400).json({ error: 'No conference is running' });
    const client = twilioClient();
    const list = await client.conferences(conf.twilio_conference_sid).participants.list({ limit: 50 });
    let changed = 0;
    for (const p of list) {
      if (p.endConferenceOnExit) continue;
      try {
        await client.conferences(conf.twilio_conference_sid).participants(p.callSid).update({ muted });
        changed += 1;
      } catch (e) {
        console.error('mute failed for', p.callSid, e.message);
      }
    }
    res.json({ changed, muted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not change the conference' });
  }
});

router.post('/participants/:callSid/mute', async (req, res) => {
  const { muted } = req.body;
  if (typeof muted !== 'boolean') return res.status(400).json({ error: 'muted must be true or false' });
  try {
    const conf = await activeConference(req.userId);
    if (!conf) return res.status(400).json({ error: 'No conference is running' });
    await twilioClient().conferences(conf.twilio_conference_sid)
      .participants(req.params.callSid).update({ muted });
    res.json({ ok: true, muted });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not change that caller' });
  }
});

// Hang up on everyone at once.
router.post('/end', async (req, res) => {
  try {
    const conf = await activeConference(req.userId);
    if (!conf) return res.status(400).json({ error: 'No conference is running' });
    await twilioClient().conferences(conf.twilio_conference_sid).update({ status: 'completed' });
    await pool.query(`UPDATE conferences SET status = 'ended' WHERE id = $1`, [conf.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Could not end the conference' });
  }
});

// Past conferences with who attended and for how long.
router.get('/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.access_code, c.status, c.created_at, c.recording_url,
              COUNT(ci.id)::int AS attendee_count,
              COALESCE(SUM(ci.duration_seconds), 0)::int AS total_seconds
         FROM conferences c
         LEFT JOIN call_ins ci ON ci.conference_id = c.id
        WHERE c.user_id = $1
        GROUP BY c.id
        ORDER BY c.created_at DESC
        LIMIT 50`,
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load conference history' });
  }
});

router.get('/:id/attendees', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ci.call_sid, ci.from_phone_number, ci.started_at, ci.ended_at,
              ci.duration_seconds, ci.cost,
              (ci.call_sid = c.host_call_sid) AS is_host,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', ct.first_name, ct.last_name)), ''), ct.name) AS contact_name
         FROM call_ins ci
         JOIN conferences c ON c.id = ci.conference_id
         LEFT JOIN contacts ct ON ct.id = ci.contact_id
        WHERE ci.conference_id = $1 AND c.user_id = $2
        ORDER BY ci.started_at ASC`,
      [req.params.id, req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load attendees' });
  }
});

module.exports = router;