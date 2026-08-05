// backend/routes/signup.js
//
// PUBLIC route — no auth. Receives opt-ins from the website form at
// https://www.wondersolutionsny.com/signup.html
//
// Stores the consent proof verbatim (exact wording shown, timestamp,
// source URL, IP). That record is what you produce if a complaint is
// ever filed.

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// Which account new website signups belong to.
// Your account is user id 4.
const SIGNUP_USER_ID = parseInt(process.env.SIGNUP_USER_ID || '4', 10);

// Only allow the real site to post here.
const ALLOWED_ORIGINS = [
  'https://www.wondersolutionsny.com',
  'https://wondersolutionsny.com',
];

router.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function toE164(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

router.post('/', async (req, res) => {
  const { name, phone, list, consent, consentText, consentAt, source } = req.body || {};

  if (!consent) {
    return res.status(400).json({ error: 'Consent is required' });
  }
  const phoneE164 = toE164(phone);
  if (!phoneE164) {
    return res.status(400).json({ error: 'Enter a valid 10-digit US mobile number' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Reuse an existing contact if this number is already on file.
    const { rows: existing } = await client.query(
      `SELECT id FROM contacts
       WHERE user_id = $1
         AND RIGHT(REGEXP_REPLACE(phone_number, '\\D', '', 'g'), 10)
             = RIGHT($2, 10)
       LIMIT 1`,
      [SIGNUP_USER_ID, phoneE164]
    );

    let contactId;
    if (existing.length) {
      contactId = existing[0].id;
    } else {
      const { rows: inserted } = await client.query(
        `INSERT INTO contacts (user_id, name, phone_number, preferred_method, methods)
         VALUES ($1, $2, $3, 'sms', ARRAY['sms','call'])
         RETURNING id`,
        [SIGNUP_USER_ID, name.trim(), phoneE164]
      );
      contactId = inserted[0].id;
    }

    await client.query(
      `INSERT INTO consent_records
         (user_id, contact_id, name, phone_number, list_name,
          consent_text, consent_at, source_url, ip_address, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        SIGNUP_USER_ID,
        contactId,
        name.trim(),
        phoneE164,
        list || null,
        consentText || '(consent text not supplied by form)',
        consentAt ? new Date(consentAt) : new Date(),
        source || null,
        req.headers['x-forwarded-for'] || req.ip || null,
        req.headers['user-agent'] || null,
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('signup error:', err);
    res.status(500).json({ error: 'Could not save your signup. Please try again.' });
  } finally {
    client.release();
  }
});

module.exports = router;
