const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

router.use(requireAuth);

// GET all users (never exposes password hashes)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, created_at FROM users ORDER BY created_at ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST create a new user
router.post('/', async (req, res) => {
  const { username, password } = req.body;
  if (!username || username.trim().length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
      [username.trim(), hash]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already taken' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// DELETE a user
router.delete('/:id', async (req, res) => {
  try {
    const { rows: remaining } = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(remaining[0].count, 10) <= 1) {
      return res.status(400).json({ error: "Can't delete the last remaining user account" });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
