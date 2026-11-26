/* ==================================================================
 * telnyxWebhooks.js - Telnyx delivery status and inbound messages
 * ==================================================================
 * Telnyx posts JSON where Twilio posts form-encoded fields, so both
 * routes here translate rather than duplicate logic:
 *
 *   /webhooks/telnyx-status    delivery receipts -> sends table
 *   /webhooks/telnyx-inbound   inbound SMS -> the existing voice.js
 *                              handler, reshaped to Twilio field names
 *
 * Twilio reads a TwiML <Message> in the response body and sends it as
 * a reply. Telnyx does not - it ignores the body entirely. voice.js
 * answers every inbound message that way, so this file captures the
 * XML it produces and sends those replies over the Telnyx API.
 * ================================================================== */

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const voiceRouter = require('./voice');
const telnyx = require('../lib/telnyx');

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

function webhookUrl(path) {
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  return `${base}/webhooks/${path}`;
}

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
      // Telnyx reports the carrier outcome directly. Keep the same shape as
      // Twilio: status is the submission, delivery_status is the outcome.
      const sendStatus = status === 'failed' ? 'failed' : 'sent';
      await pool.query(
        'UPDATE sends SET delivery_status = $1, status = $2, error_message = COALESCE($3, error_message) WHERE twilio_sid = $4',
        [status, sendStatus, err, id]
      );
    }

    // Telnyx speaks its own error codes; store the Twilio ones the rest of
    // the app already understands, so the skip rules and the Contacts pills
    // keep working unchanged. 40001 is a landline or non-routable number,
    // 40012 one the carrier rejected outright. Neither will ever take a text.
    const DEAD_CODES = { '40001': '30006', '40012': '30005' };
    const rawCode = Array.isArray(p.errors) && p.errors.length ? String(p.errors[0].code) : null;
    const deadCode = rawCode ? DEAD_CODES[rawCode] : null;
    if (deadCode) {
      await pool.query(
        'UPDATE contacts SET undeliverable_code = $1, undeliverable_at = NOW() WHERE id = (SELECT contact_id FROM sends WHERE twilio_sid = $2)',
        [deadCode, id]
      ).catch((e) => console.error('could not flag contact:', e.message));
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

/** Undo the escaping twiml.message() applied when it built the XML. */
function xmlDecode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Pull the reply text out of a <Response><Message>..</Message></Response>. */
function messagesFromTwiml(xml) {
  const out = [];
  const re = /<Message\b[^>]*>([\s\S]*?)<\/Message>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const text = xmlDecode(m[1]).trim();
    if (text) out.push(text);
  }
  return out;
}

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

  // voice.js answers with TwiML. Telnyx throws the body away, so the
  // reply is intercepted here and sent over the API instead. The XML
  // still goes back on the wire - Telnyx simply ignores it.
  const realSend = res.send.bind(res);
  let handled = false;
  res.send = function (body) {
    if (!handled) {
      handled = true;
      const replies = messagesFromTwiml(body);
      for (const text of replies) {
        telnyx.sendSms({
          to: shaped.From,
          from: shaped.To,
          text,
          statusCallback: webhookUrl('telnyx-status')
        }).catch(e => console.error('telnyx-inbound reply failed:', e.message));
      }
    }
    return realSend(body);
  };

  req.body = shaped;
  req.url = '/sms-incoming';
  req.originalUrl = '/voice/sms-incoming';
  req.method = 'POST';

  return voiceRouter(req, res, next);
});

module.exports = router;
