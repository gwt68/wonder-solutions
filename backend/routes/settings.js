const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

router.use(requireAuth);

// GET my own call-in PIN
router.get('/pin', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT call_in_pin FROM users WHERE id = $1', [req.userId]);
    res.json({ pin: rows[0]?.call_in_pin || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch PIN' });
  }
});

// PUT update my own call-in PIN
router.put('/pin', async (req, res) => {
  const { pin } = req.body;
  if (!pin || !/^\d{4,8}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4-8 digits' });
  }
  try {
    await pool.query('UPDATE users SET call_in_pin = $1 WHERE id = $2', [pin, req.userId]);
    res.json({ pin });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update PIN' });
  }
});

// PUT update my own web portal login password
router.put('/portal-password', async (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// GET my own portal username
router.get('/portal-username', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT username FROM users WHERE id = $1', [req.userId]);
    res.json({ username: rows[0]?.username || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch username' });
  }
});

// PUT update my own portal username
router.put('/portal-username', async (req, res) => {
  const { username } = req.body;
  if (!username || username.trim().length < 2) {
    return res.status(400).json({ error: 'Username must be at least 2 characters' });
  }
  try {
    await pool.query('UPDATE users SET username = $1 WHERE id = $2', [username.trim(), req.userId]);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already taken' });
    console.error(err);
    res.status(500).json({ error: 'Failed to update username' });
  }
});

// PUT set/update the account recovery key
// NOTE: this still uses the legacy global settings table and powers the
// old shared-login recovery flow, which is no longer the primary login
// path. Left in place for now since removing it isn't part of this fix.
router.put('/recovery-key', async (req, res) => {
  const { recovery_key } = req.body;
  if (!recovery_key || recovery_key.length < 4) {
    return res.status(400).json({ error: 'Recovery key must be at least 4 characters' });
  }
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('recovery_key', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [recovery_key]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update recovery key' });
  }
});

// GET my own Twilio sending number (read-only, for display)
router.get('/twilio-number', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT twilio_phone_number FROM users WHERE id = $1', [req.userId]);
    res.json({ number: rows[0]?.twilio_phone_number || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch Twilio number' });
  }
});

// GET/PUT the owner's phone number — texts sent from this number to your
// Wonder Solutions number are saved as new messages automatically
// NOTE: this is a legacy single-number setting; trusted_phones (plural,
// its own table/route) is the newer multi-number version used elsewhere.
router.get('/owner-phone', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'owner_phone_number'`);
    res.json({ phone: rows.length ? rows[0].value : null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch owner phone number' });
  }
});

router.put('/owner-phone', async (req, res) => {
  const { phone } = req.body;
  if (!phone || phone.trim().length < 7) {
    return res.status(400).json({ error: 'Enter a valid phone number, e.g. +19145551234' });
  }
  try {
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('owner_phone_number', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1`,
      [phone.trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update owner phone number' });
  }
});

module.exports = router;