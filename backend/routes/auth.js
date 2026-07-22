const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const router = express.Router();
const pool = require('../db/pool');

const validTokens = new Map(); // token -> { expiry, userId, isAdmin }
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function issueToken(user) {
  const token = crypto.randomBytes(32).toString('hex');
  validTokens.set(token, {
    expiry: Date.now() + TOKEN_TTL_MS,
    userId: user.id,
    isAdmin: user.is_admin,
  });
  return token;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const session = token && validTokens.get(token);

  if (!session || session.expiry < Date.now()) {
    if (token) validTokens.delete(token);
    return res.status(401).json({ error: 'Not logged in' });
  }
  req.userId = session.userId;
  req.isAdmin = session.isAdmin;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

  try {
    const { rows: userRows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (userRows.length) {
      const match = await bcrypt.compare(password, userRows[0].password_hash);
      if (match) return res.json({ token: issueToken(userRows[0]) });
      return res.status(401).json({ error: 'Incorrect username or password' });
    }

    const { rows } = await pool.query(
      `SELECT key, value FROM settings WHERE key IN ('portal_username', 'portal_password')`
    );
    const settingsMap = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    const correctUsername = settingsMap.portal_username || 'admin';
    const correctPassword = settingsMap.portal_password;

    if (!correctPassword || username !== correctUsername || password !== correctPassword) {
      return res.status(401).json({ error: 'Incorrect username or password' });
    }
    return res.status(400).json({ error: 'Shared login is no longer supported — please use an individual account' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/recover', async (req, res) => {
  const { recovery_key, new_username, new_password } = req.body;
  if (!recovery_key || !new_username || !new_password) {
    return res.status(400).json({ error: 'Recovery key, new username, and new password are all required' });
  }
  if (new_username.trim().length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (new_password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'recovery_key'`);
    const correctKey = rows.length ? rows[0].value : null;
    if (!correctKey) {
      return res.status(400).json({ error: 'No recovery key has been set up yet. Set one from Settings while logged in.' });
    }
    if (recovery_key !== correctKey) {
      return res.status(401).json({ error: 'Incorrect recovery key' });
    }
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('portal_username', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [new_username.trim()]
    );
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('portal_password', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [new_password]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Recovery failed' });
  }
});

module.exports = { router, requireAuth, requireAdmin };