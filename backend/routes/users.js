const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

router.use(requireAuth);

// GET all users (never exposes password hashes)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, username, name, phone, email, created_at FROM users ORDER BY created_at ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST create a new user
router.post('/', async (req, res) => {
  const { username, password, name, phone, email } = req.body;
  if (!username || username.trim().length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, name, phone, email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, name, phone, email, created_at`,
      [username.trim(), hash, name || null, phone || null, email || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already taken' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT update an existing user (username, name, phone, email, and optionally reset password)
router.put('/:id', async (req, res) => {
  const { username, password, name, phone, email } = req.body;
  if (!username || username.trim().length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (password && password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  try {
    let query, params;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      query = `UPDATE users SET username = $1, name = $2, phone = $3, email = $4, password_hash = $5 WHERE id = $6
                RETURNING id, username, name, phone, email, created_at`;
      params = [username.trim(), name || null, phone || null, email || null, hash, req.params.id];
    } else {
      query = `UPDATE users SET username = $1, name = $2, phone = $3, email = $4 WHERE id = $5
                RETURNING id, username, name, phone, email, created_at`;
      params = [username.trim(), name || null, phone || null, email || null, req.params.id];
    }
    const { rows } = await pool.query(query, params);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already taken' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
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
