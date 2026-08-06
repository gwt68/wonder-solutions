const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

router.use(requireAuth);

function scopeParam(req) {
  return req.isAdmin ? null : req.userId;
}

// GET all trusted phone numbers for the logged-in user (admin sees all)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM trusted_phones WHERE ($1::int IS NULL OR user_id = $1) ORDER BY created_at ASC',
      [scopeParam(req)]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch trusted phone numbers' });
  }
});

// POST add a trusted phone number, scoped to the logged-in user
router.post('/', async (req, res) => {
  const { phone_number, label } = req.body;
  if (!phone_number || phone_number.trim().length < 7) {
    return res.status(400).json({ error: 'Enter a valid phone number, e.g. +19145551234' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO trusted_phones (phone_number, label, user_id) VALUES ($1, $2, $3) RETURNING *',
      [phone_number.trim(), label || null, req.userId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That number is already trusted' });
    console.error(err);
    res.status(500).json({ error: 'Failed to add phone number' });
  }
});

// DELETE a trusted phone number — only your own (admin can delete any)
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM trusted_phones WHERE id = $1 AND ($2::int IS NULL OR user_id = $2)',
      [req.params.id, scopeParam(req)]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove phone number' });
  }
});

module.exports = router;