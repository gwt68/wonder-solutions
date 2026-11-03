const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const twilio = require('twilio');
const pool = require('../db/pool');
const { requireAuth, requireFullAccount, requirePerm } = require('./auth');

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

async function sendToContact(contact, message, method, fromNumber) {
  const client = twilioClient();
  if (!fromNumber) return { status: 'failed', error_message: 'This account has no Twilio number configured' };

  const hasAudio = !!(message.audio_url || message.has_uploaded_audio);
  const hasImage = !!message.has_image;

  try {
    if (method === 'sms') {
      if (!message.text_content) return { status: 'failed', error_message: 'This message has no text to send as an SMS' };
      const result = await client.messages.create({
        to: contact.phone_number, from: fromNumber, body: message.text_content,
        statusCallback: webhookUrl('sms-status'),
      });
      return { status: 'sent', twilio_sid: result.sid };
    }

    if (method === 'voice_note') {
      if (!hasImage && !hasAudio) return { status: 'failed', error_message: 'This message has no audio or picture to send as an MMS' };
      const mediaUrl = hasImage ? imageProxyUrl(message.id) : audioProxyUrl(message.id);
      const params = { to: contact.phone_number, from: fromNumber, mediaUrl: [mediaUrl], statusCallback: webhookUrl('sms-status') };
      if (message.text_content) params.body = message.text_content;
      const result = await client.messages.create(params);
      return { status: 'sent', twilio_sid: result.sid };
    }

    if (method === 'call') {
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const twiml = new VoiceResponse();
      const beep = twiml.pause({ length: 1 }); // brief pause lets a voicemail greeting finish before the message plays
      if (hasAudio) twiml.play(audioProxyUrl(message.id));
      else if (message.text_content) twiml.say(message.text_content);
      else return { status: 'failed', error_message: 'This message has nothing to play or say on a call' };

      const result = await client.calls.create({
        to: contact.phone_number, from: fromNumber, twiml: twiml.toString(),
        statusCallback: webhookUrl('call-status'),
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST', machineDetection: 'Enable', machineDetectionTimeout: 4,
      });
      return { status: 'sent', twilio_sid: result.sid };
    }

    return { status: 'failed', error_message: `Unknown method: ${method}` };
  } catch (err) {
    console.error('sendToContact error:', err);
    return { status: 'failed', error_message: err.message || err.toString() || 'Unknown error (no details provided)' };
  }
}

async function createSendBatch({ message_id, recipients, scheduled_at, userId, isConversationReply = false, batch_id }) {
  const { rows: userRows } = await pool.query('SELECT twilio_phone_number FROM users WHERE id = $1', [userId]);
  const fromNumber = userRows[0]?.twilio_phone_number;

  const { rows: messageRows } = await pool.query(
    'SELECT * FROM messages WHERE id = $1 AND user_id = $2', [message_id, userId]
  );
  if (!messageRows.length) throw new Error('Message not found');
  const message = messageRows[0];
  const { rows: mediaCheck } = await pool.query(
    'SELECT (audio_data IS NOT NULL) AS has_audio, (image_data IS NOT NULL) AS has_image FROM messages WHERE id = $1',
    [message_id]
  );
  message.has_uploaded_audio = mediaCheck[0]?.has_audio || false;
  message.has_image = mediaCheck[0]?.has_image || false;

  const { rows: permRows } = await pool.query(
    'SELECT is_admin, can_send_mms, can_send_voice FROM users WHERE id = $1', [userId]
  );
  const perms = permRows[0] || {};
  if (!perms.is_admin) {
    const isVoice = message.type === 'voice' || message.has_uploaded_audio || !!message.audio_url;
    const isMms = message.has_image;
    if (isVoice && perms.can_send_voice !== true) throw new Error('You do not have permission to send voice messages');
    if (isMms && perms.can_send_mms !== true) throw new Error('You do not have permission to send picture messages');
  }

  const contactIds = [...new Set(recipients.map((r) => r.contact_id))];
  const { rows: contactRows } = await pool.query(
    'SELECT * FROM contacts WHERE id = ANY($1::int[]) AND user_id = $2', [contactIds, userId]
  );
  const contactsById = Object.fromEntries(contactRows.map((c) => [c.id, c]));
  if (!contactRows.length) throw new Error('No matching contacts found');

  const isScheduled = !!scheduled_at && new Date(scheduled_at) > new Date();
  // A caller sending the same broadcast to several groups passes its own id
  // so History shows one row rather than one per group.
  const batchId = batch_id || crypto.randomUUID();
  const created = [];

  const expanded = [];
  for (const recipient of recipients) {
    const contact = contactsById[recipient.contact_id];
    if (!contact) continue;
    const enabledMethods = contact.methods && contact.methods.length ? contact.methods : [contact.preferred_method];
    const requestedMethods = Array.isArray(recipient.methods) && recipient.methods.length
      ? recipient.methods : [recipient.method || contact.preferred_method];
    const validMethods = requestedMethods.filter((m) => enabledMethods.includes(m));
    if (!validMethods.length) validMethods.push(contact.preferred_method);
    for (const method of validMethods) expanded.push({ contact, method });
  }

  for (const { contact, method } of expanded) {
    if (isScheduled) {
      const { rows } = await pool.query(
        `INSERT INTO sends (contact_id, message_id, status, scheduled_at, method, batch_id, user_id, is_conversation_reply)
         VALUES ($1, $2, 'scheduled', $3, $4, $5, $6, $7) RETURNING *`,
        [contact.id, message_id, scheduled_at, method, batchId, userId, isConversationReply]
      );
      created.push(rows[0]);
    } else {
      const result = await sendToContact(contact, message, method, fromNumber);
      const { rows } = await pool.query(
        `INSERT INTO sends (contact_id, message_id, status, twilio_sid, error_message, sent_at, method, batch_id, user_id, is_conversation_reply)
         VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9) RETURNING *`,
        [contact.id, message_id, result.status, result.twilio_sid || null, result.error_message || null, method, batchId, userId, isConversationReply]
      );
      created.push(rows[0]);
    }
  }

  return { count: created.length, scheduled: isScheduled, batch_id: batchId, sends: created };
}

router.post('/', requireFullAccount, requirePerm('can_send'), async (req, res) => {
  const { message_id, recipients, scheduled_at } = req.body;
  if (!message_id || !Array.isArray(recipients) || !recipients.length) {
    return res.status(400).json({ error: 'message_id and a non-empty recipients array are required' });
  }
  try {
    const result = await createSendBatch({ message_id, recipients, scheduled_at, userId: req.userId });
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to create send' });
  }
});

router.get('/', async (req, res) => {
  const { contact_id, user_id } = req.query;
  let scope;
  const seeAll = req.isAdmin || req.canViewAllHistory === true;
  if (seeAll && user_id === 'all') scope = null;
  else if (seeAll && user_id) scope = parseInt(user_id, 10);
  else scope = req.userId;
  try {
    const baseQuery = `
      SELECT s.*, COALESCE(s.method, c.preferred_method) AS effective_method,
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.name) AS contact_name,
             c.phone_number, c.preferred_method,
             m.title AS message_title, m.type AS message_type,
             m.text_content AS message_text, m.audio_url AS message_audio_url,
             (m.audio_data IS NOT NULL) AS message_has_uploaded_audio,
             (m.image_data IS NOT NULL) AS message_has_image,
             r.id AS reply_id, r.text_content AS reply_text, r.created_at AS reply_at
      FROM sends s
      JOIN contacts c ON c.id = s.contact_id
      JOIN messages m ON m.id = s.message_id
      LEFT JOIN LATERAL (
        SELECT id, text_content, created_at FROM messages
        WHERE is_reply = TRUE AND reply_contact_id = c.id AND created_at > s.sent_at
        ORDER BY created_at ASC LIMIT 1
      ) r ON TRUE
      WHERE ($1::int IS NULL OR s.user_id = $1) AND s.is_conversation_reply = FALSE
    `;
    const { rows } = contact_id
      ? await pool.query(`${baseQuery} AND s.contact_id = $2 ORDER BY COALESCE(s.scheduled_at, s.created_at) DESC`, [scope, contact_id])
      : await pool.query(`${baseQuery} ORDER BY COALESCE(s.scheduled_at, s.created_at) DESC LIMIT 500`, [scope]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch send history' });
  }
});

router.delete('/:id', async (req, res) => {
  const scope = req.userId;
  try {
    await pool.query('DELETE FROM sends WHERE id = $1 AND ($2::int IS NULL OR user_id = $2)', [req.params.id, scope]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete send record' });
  }
});

// Resends every failed delivery in a batch as a NEW batch, so the original
// record of what failed stays intact. Failed rows may point at different
// messages (group-title clones), so they're grouped by message_id and share
// one new batch id.
router.post('/batch/:batchId/retry', requirePerm('can_retry_failed'), async (req, res) => {
  const scope = req.isAdmin ? null : req.userId;
  try {
    const { rows: failed } = await pool.query(
      `SELECT contact_id, message_id, method FROM sends
        WHERE batch_id = $1 AND status = 'failed' AND ($2::int IS NULL OR user_id = $2)`,
      [req.params.batchId, scope]
    );
    if (!failed.length) return res.status(400).json({ error: 'Nothing failed in that broadcast' });

    const byMessage = {};
    failed.forEach((f) => {
      if (!byMessage[f.message_id]) byMessage[f.message_id] = [];
      byMessage[f.message_id].push(f);
    });

    let sharedBatchId = null;
    let total = 0;
    for (const [messageId, list] of Object.entries(byMessage)) {
      const recipients = list.map((f) => (f.method ? { contact_id: f.contact_id, methods: [f.method] } : { contact_id: f.contact_id }));
      const result = await createSendBatch({
        message_id: parseInt(messageId, 10),
        recipients,
        userId: req.userId,
        batch_id: sharedBatchId,
      });
      sharedBatchId = sharedBatchId || result.batch_id;
      total += result.count;
    }
    res.json({ retried: total, batch_id: sharedBatchId });
  } catch (err) {
    console.error('batch retry error:', err);
    res.status(500).json({ error: err.message || 'Failed to retry' });
  }
});

// Retries one failed delivery in place — no new History row for a single contact.
router.post('/:id/retry', requirePerm('can_retry_failed'), async (req, res) => {
  const scope = req.isAdmin ? null : req.userId;
  try {
    const { rows } = await pool.query(
      `SELECT s.*, c.* , s.id AS send_id, s.method AS send_method, s.message_id AS msg_id
         FROM sends s JOIN contacts c ON c.id = s.contact_id
        WHERE s.id = $1 AND ($2::int IS NULL OR s.user_id = $2)`,
      [req.params.id, scope]
    );
    if (!rows.length) return res.status(404).json({ error: 'Send not found' });
    const row = rows[0];

    const { rows: userRows } = await pool.query('SELECT twilio_phone_number FROM users WHERE id = $1', [req.userId]);
    const fromNumber = userRows[0]?.twilio_phone_number;

    const { rows: msgRows } = await pool.query('SELECT * FROM messages WHERE id = $1', [row.msg_id]);
    if (!msgRows.length) return res.status(404).json({ error: 'Message not found' });
    const message = msgRows[0];
    const { rows: mediaCheck } = await pool.query(
      'SELECT (audio_data IS NOT NULL) AS has_audio, (image_data IS NOT NULL) AS has_image FROM messages WHERE id = $1',
      [row.msg_id]
    );
    message.has_uploaded_audio = mediaCheck[0]?.has_audio || false;
    message.has_image = mediaCheck[0]?.has_image || false;

    const contact = { id: row.contact_id, phone_number: row.phone_number, preferred_method: row.preferred_method };
    const method = row.send_method || row.preferred_method;
    const result = await sendToContact(contact, message, method, fromNumber);

    await pool.query(
      `UPDATE sends SET status = $1, twilio_sid = $2, error_message = $3, sent_at = NOW() WHERE id = $4`,
      [result.status, result.twilio_sid || null, result.error_message || null, row.send_id]
    );
    res.json({ status: result.status, error_message: result.error_message || null });
  } catch (err) {
    console.error('send retry error:', err);
    res.status(500).json({ error: err.message || 'Failed to retry' });
  }
});

router.put('/batch/:batchId/cancel', async (req, res) => {
  const scope = req.isAdmin ? null : req.userId;
  try {
    const { rowCount } = await pool.query(
      `UPDATE sends SET status = 'canceled' WHERE batch_id = $1 AND status = 'scheduled' AND ($2::int IS NULL OR user_id = $2)`,
      [req.params.batchId, scope]
    );
    res.json({ canceled: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to cancel scheduled send' });
  }
});

async function processDueSends() {
  try {
    const { rows: due } = await pool.query(
      `SELECT s.*, c.phone_number, c.preferred_method, c.id AS c_id, c.name AS c_name,
              m.id AS m_id, m.text_content, m.audio_url, u.twilio_phone_number AS from_number
       FROM sends s
       JOIN contacts c ON c.id = s.contact_id
       JOIN messages m ON m.id = s.message_id
       JOIN users u ON u.id = s.user_id
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

      const result = await sendToContact(contact, message, method, row.from_number);
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