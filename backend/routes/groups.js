const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

router.use(requireAuth);

function scopeParam(req) {
  return req.userId;
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT g.*, COUNT(cg.contact_id)::int AS member_count
      FROM groups g
      LEFT JOIN contact_groups cg ON cg.group_id = g.id
      WHERE ($1::int IS NULL OR g.user_id = $1)
      GROUP BY g.id
      ORDER BY g.created_at DESC
    `, [scopeParam(req)]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// --- Group chat -------------------------------------------------------
// Placed above the /:id routes so 'chat' is never read as a group id.

router.get('/chat/enabled', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.name, g.member_posting, g.post_prefix,
              COUNT(DISTINCT cg.contact_id)::int AS member_count,
              (COUNT(DISTINCT cg.contact_id) FILTER (WHERE cg.can_post))::int AS poster_count,
              (COUNT(DISTINCT cg.contact_id) FILTER (WHERE cg.join_status = 'joined'))::int AS joined_count,
              (COUNT(DISTINCT cg.contact_id) FILTER (WHERE cg.join_status = 'pending'))::int AS pending_count,
              MAX(gpl.created_at) AS last_post_at
         FROM groups g
         LEFT JOIN contact_groups cg ON cg.group_id = g.id
         LEFT JOIN group_post_log gpl ON gpl.group_id = g.id
        WHERE g.user_id = $1 AND g.member_posting = 'approved'
        GROUP BY g.id
        ORDER BY MAX(gpl.created_at) DESC NULLS LAST, g.name`,
      [scopeParam(req)]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch group chats' });
  }
});

const USAGE_PERIODS = {
  hour:  { unit: 'hour',  lookback: '48 hours' },
  day:   { unit: 'day',   lookback: '30 days' },
  week:  { unit: 'week',  lookback: '26 weeks' },
  month: { unit: 'month', lookback: '12 months' },
};

// Usage and cost for group posts only, bucketed by period.
router.get('/chat/usage', async (req, res) => {
  const period = USAGE_PERIODS[req.query.period] ? req.query.period : 'day';
  const { unit, lookback } = USAGE_PERIODS[period];
  try {
    const { rows } = await pool.query(
      `SELECT date_trunc($2, s.sent_at) AS bucket,
              COUNT(*)::int AS messages,
              COALESCE(SUM(ABS(s.cost)), 0)::float AS cost
         FROM sends s
         JOIN messages m ON m.id = s.message_id
        WHERE s.user_id = $1
          AND m.is_group_post = TRUE
          AND s.sent_at IS NOT NULL
          AND s.sent_at > NOW() - $3::interval
        GROUP BY bucket
        ORDER BY bucket DESC`,
      [scopeParam(req), unit, lookback]
    );
    const totals = rows.reduce(
      (acc, r) => ({ messages: acc.messages + r.messages, cost: acc.cost + r.cost }),
      { messages: 0, cost: 0 }
    );
    res.json({ period, buckets: rows, totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

router.get('/:id/posts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT gpl.id, gpl.created_at, gpl.body,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.name, c.phone_number) AS sender_name,
              c.phone_number AS sender_phone,
              (SELECT COUNT(*)::int FROM sends s WHERE s.message_id = gpl.message_id) AS recipient_count
         FROM group_post_log gpl
         JOIN groups g ON g.id = gpl.group_id
         JOIN contacts c ON c.id = gpl.contact_id
        WHERE gpl.group_id = $1 AND ($2::int IS NULL OR g.user_id = $2)
        ORDER BY gpl.created_at DESC
        LIMIT 100`,
      [req.params.id, scopeParam(req)]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch group posts' });
  }
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO groups (name, source, user_id) VALUES ($1, 'web', $2) RETURNING *`,
      [name, req.userId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Accepts a rename, a member_posting change, or both.
router.put('/:id', async (req, res) => {
  const { name, member_posting, post_prefix } = req.body;
  if (name === undefined && member_posting === undefined && post_prefix === undefined) {
    return res.status(400).json({ error: 'name, member_posting or post_prefix is required' });
  }
  if (member_posting !== undefined && !['off', 'approved'].includes(member_posting)) {
    return res.status(400).json({ error: 'member_posting must be off or approved' });
  }
  if (post_prefix !== undefined && !['off', 'group_name'].includes(post_prefix)) {
    return res.status(400).json({ error: 'post_prefix must be off or group_name' });
  }
  try {
    const sets = [];
    const params = [];
    if (name !== undefined) {
      params.push(name);
      sets.push(`name = $${params.length}`, `source = 'web'`);
    }
    if (member_posting !== undefined) {
      params.push(member_posting);
      sets.push(`member_posting = $${params.length}`);
    }
    if (post_prefix !== undefined) {
      params.push(post_prefix);
      sets.push(`post_prefix = $${params.length}`);
    }
    params.push(req.params.id);
    const idIdx = params.length;
    params.push(scopeParam(req));
    const scopeIdx = params.length;

    const { rows } = await pool.query(
      `UPDATE groups SET ${sets.join(', ')}
        WHERE id = $${idIdx} AND ($${scopeIdx}::int IS NULL OR user_id = $${scopeIdx})
        RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Group not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM groups WHERE id = $1 AND ($2::int IS NULL OR user_id = $2)',
      [req.params.id, scopeParam(req)]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

router.post('/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM groups WHERE id = ANY($1::int[]) AND ($2::int IS NULL OR user_id = $2)',
      [ids, scopeParam(req)]
    );
    res.json({ deleted: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete groups' });
  }
});

router.get('/:id/contacts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, cg.can_post, cg.muted, cg.is_admin, cg.join_status, cg.invited_at FROM contacts c
       JOIN contact_groups cg ON cg.contact_id = c.id
       JOIN groups g ON g.id = cg.group_id
       WHERE cg.group_id = $1 AND ($2::int IS NULL OR g.user_id = $2)
       ORDER BY c.created_at DESC`,
      [req.params.id, scopeParam(req)]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch group contacts' });
  }
});

router.get('/:id/audio-label', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT audio_label_url FROM groups WHERE id = $1', [req.params.id]);
    if (!rows.length || !rows[0].audio_label_url) return res.status(404).end();

    const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
    const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
    const auth = Buffer.from(`${sid}:${token}`).toString('base64');
    const twilioRes = await fetch(rows[0].audio_label_url, { headers: { Authorization: `Basic ${auth}` } });
    if (!twilioRes.ok) return res.status(502).json({ error: 'Could not fetch recording from Twilio' });
    res.set('Content-Type', twilioRes.headers.get('content-type') || 'audio/mpeg');
    const buffer = Buffer.from(await twilioRes.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load audio' });
  }
});

router.post('/:id/contacts', async (req, res) => {
  const { contact_ids } = req.body;
  if (!Array.isArray(contact_ids) || !contact_ids.length) {
    return res.status(400).json({ error: 'contact_ids array is required' });
  }
  try {
    const values = contact_ids.map((cid) => `(${parseInt(cid, 10)}, ${req.params.id})`).join(',');
    await pool.query(`INSERT INTO contact_groups (contact_id, group_id) VALUES ${values} ON CONFLICT DO NOTHING`);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add contacts to group' });
  }
});

// Approve or mute one member of one group. Scoped through groups.user_id
// because contact_groups has no user_id of its own.
router.put('/:id/contacts/:contactId', async (req, res) => {
  const { can_post, muted, is_admin } = req.body;
  if (can_post === undefined && muted === undefined && is_admin === undefined) {
    return res.status(400).json({ error: 'can_post, muted or is_admin is required' });
  }
  try {
    const sets = [];
    const params = [];
    if (can_post !== undefined) {
      params.push(!!can_post);
      sets.push(`can_post = $${params.length}`);
    }
    if (muted !== undefined) {
      params.push(!!muted);
      sets.push(`muted = $${params.length}`);
    }
    if (is_admin !== undefined) {
      params.push(!!is_admin);
      sets.push(`is_admin = $${params.length}`);
    }
    params.push(req.params.id);
    const gidIdx = params.length;
    params.push(req.params.contactId);
    const cidIdx = params.length;
    params.push(scopeParam(req));
    const scopeIdx = params.length;

    const { rowCount } = await pool.query(
      `UPDATE contact_groups cg SET ${sets.join(', ')}
         FROM groups g
        WHERE g.id = cg.group_id
          AND cg.group_id = $${gidIdx}
          AND cg.contact_id = $${cidIdx}
          AND ($${scopeIdx}::int IS NULL OR g.user_id = $${scopeIdx})`,
      params
    );
    if (!rowCount) return res.status(404).json({ error: 'Group member not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update group member' });
  }
});

router.post('/bulk-assign', async (req, res) => {
  const { contact_ids, group_ids } = req.body;
  if (!Array.isArray(contact_ids) || !contact_ids.length) return res.status(400).json({ error: 'contact_ids array is required' });
  if (!Array.isArray(group_ids) || !group_ids.length) return res.status(400).json({ error: 'group_ids array is required' });
  try {
    const values = [];
    for (const cid of contact_ids) {
      for (const gid of group_ids) {
        values.push(`(${parseInt(cid, 10)}, ${parseInt(gid, 10)})`);
      }
    }
    await pool.query(`INSERT INTO contact_groups (contact_id, group_id) VALUES ${values.join(',')} ON CONFLICT DO NOTHING`);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to assign contacts to groups' });
  }
});

router.delete('/:id/contacts/:contactId', async (req, res) => {
  try {
    await pool.query('DELETE FROM contact_groups WHERE group_id = $1 AND contact_id = $2', [req.params.id, req.params.contactId]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove contact from group' });
  }
});

module.exports = router;
