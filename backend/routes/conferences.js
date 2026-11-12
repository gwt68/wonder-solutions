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
    const client = twilioClient();
    // Twilio can't speak into a room it is closing, so each caller is sent to
    // a short goodbye of their own first.
    try {
      const list = await client.conferences(conf.twilio_conference_sid).participants.list({ limit: 50 });
      await Promise.all(list.map((p) =>
        client.calls(p.callSid)
          .update({ twiml: '<Response><Say>The conference has ended. Goodbye.</Say><Hangup/></Response>' })
          .catch((e) => console.error('goodbye failed for', p.callSid, e.message))
      ));
    } catch (e) {
      console.error('could not play goodbye:', e.message);
    }
    await client.conferences(conf.twilio_conference_sid).update({ status: 'completed' }).catch(() => {});
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

// Streams the recording through us, since Twilio's URL needs credentials.
router.get('/:id/recording', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT recording_url FROM conferences WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    const url = rows[0]?.recording_url;
    if (!url) return res.status(404).json({ error: 'No recording for that conference' });

    const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
    const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const twRes = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!twRes.ok) return res.status(502).json({ error: 'Could not fetch the recording from Twilio' });

    res.set('Content-Type', twRes.headers.get('content-type') || 'audio/mpeg');
    if (req.query.download === '1') {
      res.set('Content-Disposition', `attachment; filename="conference-${req.params.id}.mp3"`);
    }
    res.send(Buffer.from(await twRes.arrayBuffer()));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load the recording' });
  }
});

// Pulls the RE... id out of a stored recording URL.
function recordingSidFrom(url) {
  const m = /\/Recordings\/(RE[0-9a-f]+)/i.exec(url || '');
  return m ? m[1] : null;
}

async function deleteTwilioRecording(url) {
  const sid = recordingSidFrom(url);
  if (!sid) return;
  try {
    await twilioClient().recordings(sid).remove();
  } catch (e) {
    console.error('could not delete recording at Twilio:', e.message);
  }
}

// Removes just the recording, keeping who attended.
router.delete('/:id/recording', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT recording_url FROM conferences WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Conference not found' });
    await deleteTwilioRecording(rows[0].recording_url);
    await pool.query('UPDATE conferences SET recording_url = NULL WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete the recording' });
  }
});

// Removes the whole record, recording and attendance alike.
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT recording_url, status FROM conferences WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Conference not found' });
    if (rows[0].status === 'active') {
      return res.status(400).json({ error: 'End the conference before deleting it' });
    }
    await deleteTwilioRecording(rows[0].recording_url);
    await pool.query('UPDATE call_ins SET conference_id = NULL WHERE conference_id = $1', [req.params.id]);
    await pool.query('DELETE FROM conferences WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete the conference' });
  }
});

module.exports = router;