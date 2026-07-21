const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const twilio = require('twilio');
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

router.use(requireAuth);

function twilioClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  if (!sid || !token) throw new Error('Twilio credentials are not configured');
  return twilio(sid, token);
}

function audioProxyUrl(messageId) {
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  return `${base}/api/messages/${messageId}/audio`;
}

function imageProxyUrl(messageId) {
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  return `${base}/api/messages/${messageId}/image`;
}

function webhookUrl(path) {
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  return `${base}/webhooks/${path}`;
}

// Sends one message to one contact via a specific method.
// Returns { status: 'sent' | 'failed', twilio_sid, error_message }
async function sendToContact(contact, message, method) {
  const client = twilioClient();
  const from = (process.env.TWILIO_PHONE_NUMBER || '').trim();
  if (!from) return { status: 'failed', error_message: 'TWILIO_PHONE_NUMBER is not configured' };

  const hasAudio = !!(message.audio_url || message.has_uploaded_audio);
  const hasImage = !!message.has_image;

  try {
    if (method === 'sms') {
      if (!message.text_content) {
        return { status: 'failed', error_message: 'This message has no text to send as an SMS' };
      }
      const result = await client.messages.create({
        to: contact.phone_number,
        from,
        body: message.text_content,
        statusCallback: webhookUrl('sms-status'),
      });
      return { status: 'sent', twilio_sid: result.sid };
    }

    if (method === 'voice_note') {
      if (!hasImage && !hasAudio) {
        return { status: 'failed', error_message: 'This message has no audio or picture to send as an MMS' };
      }
      const mediaUrl = hasImage ? imageProxyUrl(message.id) : audioProxyUrl(message.id);
      const params = {
        to: contact.phone_number,
        from,
        mediaUrl: [mediaUrl],
        statusCallback: webhookUrl('sms-status'),
      };
      if (message.text_content) params.body = message.text_content;
      const result = await client.messages.create(params);
      return { status: 'sent', twilio_sid: result.sid };
    }

    if (method === 'call') {
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const twiml = new VoiceResponse();
      if (hasAudio) {
        twiml.play(audioProxyUrl(message.id));
      } else if (message.text_content) {
        twiml.say(message.text_content);
      } else {
        return { status: 'failed', error_message: 'This message has nothing to play or say on a call' };
      }
      const result = await client.calls.create({
        to: contact.phone_number,
        from,
        twiml: twiml.toString(),
        statusCallback: webhookUrl('call-status'),
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        machineDetection: 'Enable', // lets us tell if a person or voicemail answered
      });
      return { status: 'sent', twilio_sid: result.sid };
    }

    return { status: 'failed', error_message: `Unknown method: ${method}` };
  } catch (err) {
    console.error('sendToContact error:', err);
    return { status: 'failed', error_message: err.message || err.toString() || 'Unknown error (no details provided)' };
  }
}

// Core logic for creating a batch of sends — used by the API route below,
// and reused directly (no HTTP round trip) by the phone system's "send a
// message" flow. recipients: [{ contact_id, methods: [method, ...] }]
async function createSendBatch({ message_id, recipients, scheduled_at }) {
  const { rows: messageRows } = await pool.query('SELECT * FROM messages WHERE id = $1', [message_id]);
  if (!messageRows.length) throw new Error('Message not found');
  const message = messageRows[0];
  const { rows: mediaCheck } = await pool.query(
    'SELECT (audio_data IS NOT NULL) AS has_audio, (image_data IS NOT NULL) AS has_image FROM messages WHERE id = $1',
    [message_id]
  );
  message.has_uploaded_audio = mediaCheck[0]?.has_audio || false;
  message.has_image = mediaCheck[0]?.has_image || false;

  const contactIds = [...new Set(recipients.map((r) => r.contact_id))];
  const { rows: contactRows } = await pool.query('SELECT * FROM contacts WHERE id = ANY($1::int[])', [contactIds]);
  const contactsById = Object.fromEntries(contactRows.map((c) => [c.id, c]));
  if (!contactRows.length) throw new Error('No matching contacts found');

  const isScheduled = !!scheduled_at && new Date(scheduled_at) > new Date();
  const batchId = crypto.randomUUID();
  const created = [];

  const expanded = [];
  for (const recipient of recipients) {
    const contact = contactsById[recipient.contact_id];
    if (!contact) continue;
    const enabledMethods = contact.methods && contact.methods.length ? contact.methods : [contact.preferred_method];
    const requestedMethods = Array.isArray(recipient.methods) && recipient.methods.length
      ? recipient.methods
      : [recipient.method || contact.preferred_method];
    const validMethods = requestedMethods.filter((m) => enabledMethods.includes(m));
    if (!validMethods.length) validMethods.push(contact.preferred_method);
    for (const method of validMethods) {
      expanded.push({ contact, method });
    }
  }

  for (const { contact, method } of expanded) {
    if (isScheduled) {
      const { rows } = await pool.query(
        `INSERT INTO sends (contact_id, message_id, status, scheduled_at, method, batch_id)
         VALUES ($1, $2, 'scheduled', $3, $4, $5) RETURNING *`,
        [contact.id, message_id, scheduled_at, method, batchId]
      );
      created.push(rows[0]);
    } else {
      const result = await sendToContact(contact, message, method);
      const { rows } = await pool.query(
        `INSERT INTO sends (contact_id, message_id, status, twilio_sid, error_message, sent_at, method, batch_id)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7) RETURNING *`,
        [contact.id, message_id, result.status, result.twilio_sid || null, result.error_message || null, method, batchId]
      );
      created.push(rows[0]);
    }
  }

  return { count: created.length, scheduled: isScheduled, batch_id: batchId, sends: created };
}

// POST create a send — takes an explicit list of { contact_id, method } (built
// by the frontend, letting each recipient use a specific method rather than
// always their default), then either sends immediately or schedules for later.
router.post('/', async (req, res) => {
  const { message_id, recipients, scheduled_at } = req.body;
  if (!message_id || !Array.isArray(recipients) || !recipients.length) {
    return res.status(400).json({ error: 'message_id and a non-empty recipients array are required' });
  }
  try {
    const result = await createSendBatch({ message_id, recipients, scheduled_at });
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create send' });
  }
});

// GET send history, joined with contact and message info.
// Pass ?contact_id=X to get the full log for one contact (no limit applied).
router.get('/', async (req, res) => {
  const { contact_id } = req.query;
  try {
    const baseQuery = `
      SELECT s.*, COALESCE(s.method, c.preferred_method) AS effective_method,
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.name) AS contact_name,
             c.phone_number, c.preferred_method,
             m.title AS message_title, m.type AS message_type,
             m.text_content AS message_text, m.audio_url AS message_audio_url,
             (m.audio_data IS NOT NULL) AS message_has_uploaded_audio,
             (m.image_data IS NOT NULL) AS message_has_image
      FROM sends s
      JOIN contacts c ON c.id = s.contact_id
      JOIN messages m ON m.id = s.message_id
    `;
    const { rows } = contact_id
      ? await pool.query(
          `${baseQuery} WHERE s.contact_id = $1 ORDER BY COALESCE(s.scheduled_at, s.created_at) DESC`,
          [contact_id]
        )
      : await pool.query(`${baseQuery} ORDER BY COALESCE(s.scheduled_at, s.created_at) DESC LIMIT 500`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch send history' });
  }
});

// DELETE a send record (e.g. clearing out a failed attempt)
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sends WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete send record' });
  }
});

// Called on an interval from server.js to process any scheduled sends whose time has come.
async function processDueSends() {
  try {
    const { rows: due } = await pool.query(
      `SELECT s.*, c.phone_number, c.preferred_method, c.id AS c_id, c.name AS c_name,
              m.id AS m_id, m.text_content, m.audio_url
       FROM sends s
       JOIN contacts c ON c.id = s.contact_id
       JOIN messages m ON m.id = s.message_id
       WHERE s.status = 'scheduled' AND s.scheduled_at <= NOW()`
    );

    for (const row of due) {
      const contact = { id: row.c_id, name: row.c_name, phone_number: row.phone_number, preferred_method: row.preferred_method };
      const method = row.method || row.preferred_method;
      const { rows: mediaCheck } = await pool.query(
        'SELECT (audio_data IS NOT NULL) AS has_audio, (image_data IS NOT NULL) AS has_image FROM messages WHERE id = $1',
        [row.m_id]
      );
      const message = {
        id: row.m_id, text_content: row.text_content, audio_url: row.audio_url,
        has_uploaded_audio: mediaCheck[0]?.has_audio || false,
        has_image: mediaCheck[0]?.has_image || false,
      };

      const result = await sendToContact(contact, message, method);
      await pool.query(
        `UPDATE sends SET status = $1, twilio_sid = $2, error_message = $3, sent_at = NOW() WHERE id = $4`,
        [result.status, result.twilio_sid || null, result.error_message || null, row.id]
      );
    }
  } catch (err) {
    console.error('Error processing scheduled sends:', err);
  }
}

module.exports = { router, processDueSends, createSendBatch };
