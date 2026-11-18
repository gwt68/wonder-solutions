/* ==================================================================
 * telnyxWebhooks.js - delivery status from Telnyx
 * ==================================================================
 * Telnyx posts JSON, not form-encoded like Twilio, and the shape is
 * different enough to need its own handler. Mounted alongside the
 * Twilio webhooks so both providers can report at once during the
 * migration.
 * ================================================================== */

const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

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

module.exports = router;
