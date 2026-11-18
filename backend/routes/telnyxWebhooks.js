/* ==================================================================
 * telnyxWebhooks.js - Telnyx delivery status and inbound messages
 * ==================================================================
 * Telnyx posts JSON where Twilio posts form-encoded fields, so both
 * routes here translate rather than duplicate logic:
 *
 *   /webhooks/telnyx-status    delivery receipts -> sends table
 *   /webhooks/telnyx-inbound   inbound SMS -> the existing voice.js
 *                              handler, reshaped to Twilio field names
 * ================================================================== */

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const voiceRouter = require('./voice');

// Telnyx status -> the vocabulary the rest of the app already uses.
const STATUS = {
  queued: 'sent',
  sending: 'sent',
  sent: 'sent',
  delivered: 'delivered',
  delivery_failed: 'failed',
  delivery_unconfirmed: 'sent',
  failed: 'failed'
};

router.post('/telnyx-status', async (req, res) => {
  res.sendStatus(200);

  try {
    const data = req.body && req.body.data;
    if (!data) return;

    const p = data.payload || {};
    const id = p.id;
    if (!id) return;

    const target = Array.isArray(p.to) && p.to.length ? p.to[0] : {};
    const status = STATUS[target.status] || target.status || null;

    const err = Array.isArray(p.errors) && p.errors.length
      ? (p.errors[0].code + ': ' + (p.errors[0].detail || p.errors[0].title))
      : null;

    if (status) {
      await pool.query(
        'UPDATE sends SET status = $1, error_message = COALESCE($2, error_message) WHERE twilio_sid = $3',
        [status, err, id]
      );
    }

    // Unlike Twilio, Telnyx gives the price on the webhook itself, so
    // there is nothing to go back and fetch later.
    if (p.cost && p.cost.amount != null) {
      await pool.query(
        'UPDATE sends SET cost = $1, cost_unit = $2 WHERE twilio_sid = $3',
        [Math.abs(Number(p.cost.amount)), p.cost.currency || 'USD', id]
      );
    }
  } catch (e) {
    console.error('telnyx-status webhook error:', e.message);
  }
});

/**
 * Inbound SMS and MMS. Reshapes the payload into the field names
 * voice.js already reads, then hands the request to that router so
 * there is exactly one copy of the command handling.
 */
router.post('/telnyx-inbound', (req, res, next) => {
  const data = (req.body && req.body.data) || {};

  if (data.event_type !== 'message.received') {
    return res.sendStatus(200);
  }

  const p = data.payload || {};
  const media = Array.isArray(p.media) ? p.media : [];

  const shaped = {
    From: p.from && p.from.phone_number,
    To: Array.isArray(p.to) && p.to[0] ? p.to[0].phone_number : undefined,
    Body: p.text || '',
    MessageSid: p.id,
    NumMedia: String(media.length)
  };

  media.forEach((m, i) => {
    shaped['MediaUrl' + i] = m.url;
    shaped['MediaContentType' + i] = m.content_type;
  });

  if (!shaped.From || !shaped.To) {
    console.error('telnyx-inbound: missing from/to', JSON.stringify(p).slice(0, 200));
    return res.sendStatus(200);
  }

  req.body = shaped;
  req.url = '/sms-incoming';
  req.originalUrl = '/voice/sms-incoming';
  req.method = 'POST';

  return voiceRouter(req, res, next);
});

module.exports = router;
