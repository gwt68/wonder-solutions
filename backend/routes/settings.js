const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const pool = require('../db/pool');
const multer = require('multer');
const { requireAuth } = require('./auth');
const holdUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

router.use(requireAuth);

// What hold music is on file, if any.
router.get('/hold-music', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT hold_music_name, (hold_music_data IS NOT NULL) AS has_music FROM users WHERE id = $1',
      [req.userId]
    );
    res.json({ name: rows[0]?.hold_music_name || null, has_music: rows[0]?.has_music || false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to read hold music' });
  }
});

router.post('/hold-music', holdUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file was uploaded' });
  const ok = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave'];
  if (!ok.includes(req.file.mimetype)) {
    return res.status(400).json({ error: 'Hold music has to be an MP3 or WAV file' });
  }
  try {
    await pool.query(
      'UPDATE users SET hold_music_data = $1, hold_music_mime = $2, hold_music_name = $3 WHERE id = $4',
      [req.file.buffer, req.file.mimetype, req.file.originalname, req.userId]
    );
    res.json({ name: req.file.originalname, has_music: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save the hold music' });
  }
});

router.delete('/hold-music', async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET hold_music_data = NULL, hold_music_mime = NULL, hold_music_name = NULL WHERE id = $1',
      [req.userId]
    );
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove the hold music' });
  }
});

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

// GET my group-message-prefix preference
router.get('/group-prefix-mode', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT group_prefix_mode FROM users WHERE id = $1', [req.userId]);
    res.json({ mode: rows[0]?.group_prefix_mode || 'never' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch group prefix setting' });
  }
});

// PUT update my group-message-prefix preference
router.put('/group-prefix-mode', async (req, res) => {
  const { mode } = req.body;
  if (!['always', 'never', 'ask'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be always, never, or ask' });
  }
  try {
    await pool.query('UPDATE users SET group_prefix_mode = $1 WHERE id = $2', [mode, req.userId]);
    res.json({ mode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update group prefix setting' });
  }
});

// GET my conference settings
router.get('/conference', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT conference_code, conference_start_mode, conference_record, conference_record_mode, conference_announce_names, conference_whitelist_group_id FROM users WHERE id = $1',
      [req.userId]
    );
    res.json({
      code: rows[0]?.conference_code || '',
      start_mode: rows[0]?.conference_start_mode || 'admin',
      record: rows[0]?.conference_record !== false,
      record_mode: rows[0]?.conference_record_mode || 'always',
      announce_names: rows[0]?.conference_announce_names === true,
      whitelist_group_id: rows[0]?.conference_whitelist_group_id ?? null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch conference settings' });
  }
});

// PUT update my conference settings
router.put('/conference', async (req, res) => {
  const { code, start_mode, record, record_mode, announce_names, whitelist_group_id } = req.body;
  if (code !== undefined && !/^[0-9]{4,8}$/.test(String(code))) {
    return res.status(400).json({ error: 'The code must be 4 to 8 digits' });
  }
  if (start_mode !== undefined && !['admin', 'two'].includes(start_mode)) {
    return res.status(400).json({ error: 'start_mode must be admin or two' });
  }
  if (record_mode !== undefined && !['always', 'never', 'ask'].includes(record_mode)) {
    return res.status(400).json({ error: 'record_mode must be always, never or ask' });
  }
  try {
    if (code !== undefined) {
      const { rows: clash } = await pool.query(
        'SELECT 1 FROM users WHERE conference_code = $1 AND id <> $2', [String(code), req.userId]
      );
      if (clash.length) return res.status(409).json({ error: 'Another account is already using that code' });
    }
    const { rows } = await pool.query(
      `UPDATE users SET
         conference_code = COALESCE($1, conference_code),
         conference_start_mode = COALESCE($2, conference_start_mode),
         conference_record = COALESCE($3, conference_record),
         conference_record_mode = COALESCE($5, conference_record_mode),
         conference_announce_names = COALESCE($6, conference_announce_names),
         conference_whitelist_group_id = CASE WHEN $7::text = 'keep' THEN conference_whitelist_group_id ELSE $7::int END
       WHERE id = $4
       RETURNING conference_code, conference_start_mode, conference_record, conference_record_mode, conference_announce_names, conference_whitelist_group_id`,
      [code !== undefined ? String(code) : null, start_mode ?? null,
       typeof record === 'boolean' ? record : null, req.userId, record_mode ?? null,
       typeof announce_names === 'boolean' ? announce_names : null,
       whitelist_group_id === undefined ? 'keep' : (whitelist_group_id === null ? null : String(whitelist_group_id))]
    );
    res.json({
      code: rows[0].conference_code,
      start_mode: rows[0].conference_start_mode,
      record: rows[0].conference_record,
      record_mode: rows[0].conference_record_mode,
      announce_names: rows[0].conference_announce_names,
      whitelist_group_id: rows[0].conference_whitelist_group_id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update conference settings' });
  }
});

// GET my timezone preference
router.get('/timezone', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT timezone FROM users WHERE id = $1', [req.userId]);
    res.json({ timezone: rows[0]?.timezone || 'America/New_York' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch timezone' });
  }
});

// PUT update my timezone preference
router.put('/timezone', async (req, res) => {
  const { timezone } = req.body;
  if (!timezone) return res.status(400).json({ error: 'timezone is required' });
  try {
    await pool.query('UPDATE users SET timezone = $1 WHERE id = $2', [timezone, req.userId]);
    res.json({ timezone });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update timezone' });
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