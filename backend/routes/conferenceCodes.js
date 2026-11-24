const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAuth, requirePerm } = require('./auth');

router.use(requireAuth, requirePerm('can_use_conferences'));

// Keeps a pasted list of numbers tidy: one per line, digits only.
function cleanNumbers(text) {
  return String(text || '')
    .split(/[^0-9+]+/)
    .map((s) => s.replace(/\D/g, ''))
    .filter((s) => s.length >= 7)
    .join('\n');
}

// Only ever returns hardcoded column names, which is what makes the
// UPDATE below safe to build by hand.
function shape(body) {
  const out = {};
  if (body.name !== undefined) out.name = String(body.name || '').slice(0, 60) || null;
  if (body.start_mode !== undefined) out.start_mode = body.start_mode === 'two' ? 'two' : 'admin';
  if (body.record_mode !== undefined) {
    out.record_mode = ['always', 'never', 'ask'].includes(body.record_mode) ? body.record_mode : 'always';
  }
  if (body.announce_names !== undefined) out.announce_names = body.announce_names === true;
  if (body.default_muted !== undefined) out.default_muted = body.default_muted === true;
  for (const k of ['whitelist_group_id', 'unmuted_group_id', 'muted_group_id']) {
    if (body[k] !== undefined) out[k] = body[k] === '' || body[k] == null ? null : Number(body[k]);
  }
  for (const k of ['unmuted_numbers', 'muted_numbers']) {
    if (body[k] !== undefined) out[k] = cleanNumbers(body[k]) || null;
  }
  return out;
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT cc.*,
              (SELECT count(*) FROM conferences c WHERE c.code_id = cc.id AND c.status <> 'ended') AS open_rooms
         FROM conference_codes cc WHERE cc.user_id = $1 ORDER BY cc.id`,
      [req.userId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load the conference codes' });
  }
});

router.post('/', async (req, res) => {
  const code = String(req.body.code || '').replace(/\D/g, '');
  if (code.length < 4 || code.length > 8) {
    return res.status(400).json({ error: 'The code needs to be 4 to 8 digits' });
  }
  const f = shape(req.body);
  try {
    const { rows } = await pool.query(
      `INSERT INTO conference_codes (user_id, code, name, start_mode, record_mode, announce_names,
         whitelist_group_id, default_muted, unmuted_group_id, unmuted_numbers, muted_group_id, muted_numbers)
       VALUES ($1, $2, $3, COALESCE($4, 'admin'), COALESCE($5, 'always'), COALESCE($6, false),
               $7, COALESCE($8, false), $9, $10, $11, $12)
       RETURNING *`,
      [req.userId, code, f.name ?? null, f.start_mode ?? null, f.record_mode ?? null,
       f.announce_names ?? null, f.whitelist_group_id ?? null, f.default_muted ?? null,
       f.unmuted_group_id ?? null, f.unmuted_numbers ?? null, f.muted_group_id ?? null,
       f.muted_numbers ?? null]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'You already have a conference with that code' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not add the conference code' });
  }
});

router.put('/:id', async (req, res) => {
  const f = shape(req.body);
  if (req.body.code !== undefined) {
    const code = String(req.body.code || '').replace(/\D/g, '');
    if (code.length < 4 || code.length > 8) {
      return res.status(400).json({ error: 'The code needs to be 4 to 8 digits' });
    }
    f.code = code;
  }
  const keys = Object.keys(f);
  if (!keys.length) return res.status(400).json({ error: 'Nothing to change' });
  const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
  try {
    const { rows } = await pool.query(
      `UPDATE conference_codes SET ${sets} WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.userId, ...keys.map((k) => f[k])]
    );
    if (!rows.length) return res.status(404).json({ error: 'That conference code was not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'You already have a conference with that code' });
    }
    console.error(err);
    res.status(500).json({ error: 'Could not save the conference code' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rows: mine } = await pool.query(
      'SELECT id FROM conference_codes WHERE id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (!mine.length) return res.status(404).json({ error: 'That conference code was not found' });

    const { rows: live } = await pool.query(
      `SELECT 1 FROM conferences WHERE code_id = $1 AND status <> 'ended' AND twilio_conference_sid IS NOT NULL LIMIT 1`,
      [req.params.id]
    );
    if (live.length) return res.status(400).json({ error: 'That conference is running right now' });

    const { rows: cnt } = await pool.query(
      'SELECT count(*) AS n FROM conference_codes WHERE user_id = $1', [req.userId]
    );
    if (Number(cnt[0].n) <= 1) return res.status(400).json({ error: 'Keep at least one conference code' });

    await pool.query('DELETE FROM conference_codes WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not delete the conference code' });
  }
});

module.exports = router;
