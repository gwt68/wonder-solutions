const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

router.use(requireAuth);

function scopeParam(req) {
  return req.isAdmin ? null : req.userId;
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

router.put('/:id', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE groups SET name = $1, source = 'web'
       WHERE id = $2 AND ($3::int IS NULL OR user_id = $3) RETURNING *`,
      [name, req.params.id, scopeParam(req)]
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
      `SELECT c.* FROM contacts c
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