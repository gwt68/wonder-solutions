const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const twilio = require('twilio');
const pool = require('../db/pool');
const { requireAuth, requireAdmin } = require('./auth');

router.use(requireAuth, requireAdmin);

function twilioClient() {
  return twilio((process.env.TWILIO_ACCOUNT_SID || '').trim(), (process.env.TWILIO_AUTH_TOKEN || '').trim());
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, username, name, phone, email, twilio_phone_number, is_admin, created_at FROM users ORDER BY created_at ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/', async (req, res) => {
  const { username, password, name, phone, email, area_code } = req.body;
  if (!username || username.trim().length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  try {
    const client = twilioClient();
    const available = await client.availablePhoneNumbers('US').local.list({ areaCode: area_code, limit: 1 });
    if (!available.length) return res.status(400).json({ error: 'No numbers available for that area code' });

    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber: available[0].phoneNumber,
      smsUrl: `${process.env.BASE_URL}/voice/sms-incoming`,
      voiceUrl: `${process.env.BASE_URL}/voice/incoming`,
    });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, name, phone, email, twilio_phone_number, twilio_phone_sid)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, username, name, phone, email, twilio_phone_number, is_admin, created_at`,
      [username.trim(), hash, name || null, phone || null, email || null, purchased.phoneNumber, purchased.sid]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username is already taken' });
    console.error(err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.put('/:id', async (req, res) => {
  const { username, password, name, phone, email } = req.body;
  if (!username || username.trim().length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (password && password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  try {
    let query, params;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      query = `UPDATE users SET username = $1, name = $2, phone = $3, email = $4, password_hash = $5 WHERE id = $6
                RETURNING id, username, name, phone, email, twilio_phone_number, is_admin, created_at`;
      params = [username.trim(), name || null, phone || null, email || null, hash, req.params.id];
    } else {
      query = `UPDATE users SET username = $1, name = $2, phone = $3, email = $4 WHERE id = $5
                RETURNING id, username, name, phone, email, twilio_phone_number, is_admin, created_at`;
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

router.delete('/:id', async (req, res) => {
  try {
    const { rows: remaining } = await pool.query('SELECT COUNT(*) FROM users');
    if (parseInt(remaining[0].count, 10) <= 1) {
      return res.status(400).json({ error: "Can't delete the last remaining user account" });
    }
    const { rows } = await pool.query('SELECT twilio_phone_sid FROM users WHERE id = $1', [req.params.id]);
    if (rows[0]?.twilio_phone_sid) {
      try {
        await twilioClient().incomingPhoneNumbers(rows[0].twilio_phone_sid).remove();
      } catch (twilioErr) {
        console.error('Failed to release Twilio number (continuing with user deletion):', twilioErr.message);
      }
    }
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;