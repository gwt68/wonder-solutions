const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

router.use(requireAuth);

// GET all trusted phone numbers
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM trusted_phones ORDER BY created_at ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch trusted phone numbers' });
  }
});

// POST add a trusted phone number
router.post('/', async (req, res) => {
  const { phone_number, label } = req.body;
  if (!phone_number || phone_number.trim().length < 7) {
    return res.status(400).json({ error: 'Enter a valid phone number, e.g. +19145551234' });
  }
  try {
    const { rows } = await pool.query(
      'INSERT INTO trusted_phones (phone_number, label) VALUES ($1, $2) RETURNING *',
      [phone_number.trim(), label || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That number is already trusted' });
    console.error(err);
    res.status(500).json({ error: 'Failed to add phone number' });
  }
});

// DELETE a trusted phone number
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM trusted_phones WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove phone number' });
  }
});

module.exports = router;
