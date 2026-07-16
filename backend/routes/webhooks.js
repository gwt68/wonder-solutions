const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const pool = require('../db/pool');

function twilioClient() {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  return twilio(sid, token);
}

const SMS_TERMINAL_STATUSES = ['delivered', 'undelivered', 'failed'];
const CALL_TERMINAL_STATUSES = ['completed', 'busy', 'no-answer', 'canceled', 'failed'];

// Twilio posts here as an SMS/MMS moves through queued -> sent -> delivered/undelivered/failed.
// Not behind requireAuth — Twilio can't send our login token.
router.post('/sms-status', async (req, res) => {
  const { MessageSid, MessageStatus } = req.body;
  try {
    if (MessageSid) {
      await pool.query(
        `UPDATE sends SET delivery_status = $1 WHERE twilio_sid = $2`,
        [MessageStatus, MessageSid]
      );

      if (SMS_TERMINAL_STATUSES.includes(MessageStatus)) {
        try {
          const msg = await twilioClient().messages(MessageSid).fetch();
          if (msg.price != null) {
            await pool.query(
              `UPDATE sends SET cost = $1, cost_unit = $2 WHERE twilio_sid = $3`,
              [Math.abs(parseFloat(msg.price)), msg.priceUnit || 'USD', MessageSid]
            );
          }
        } catch (priceErr) {
          console.error('Could not fetch message price:', priceErr.message);
        }
      }
    }
  } catch (err) {
    console.error('sms-status webhook error:', err);
  }
  res.status(200).end();
});

// Twilio posts here as a call moves through ringing -> answered/no-answer -> completed,
// including call duration and (if machine detection is on) whether a person or
// voicemail/answering machine picked up.
router.post('/call-status', async (req, res) => {
  const { CallSid, CallStatus, CallDuration, AnsweredBy } = req.body;
  try {
    if (CallSid) {
      await pool.query(
        `UPDATE sends SET
           delivery_status = $1,
           call_duration = COALESCE($2::int, call_duration),
           answered_by = COALESCE($3, answered_by)
         WHERE twilio_sid = $4`,
        [CallStatus, CallDuration || null, AnsweredBy || null, CallSid]
      );

      if (CALL_TERMINAL_STATUSES.includes(CallStatus)) {
        try {
          const call = await twilioClient().calls(CallSid).fetch();
          if (call.price != null) {
            await pool.query(
              `UPDATE sends SET cost = $1, cost_unit = $2 WHERE twilio_sid = $3`,
              [Math.abs(parseFloat(call.price)), call.priceUnit || 'USD', CallSid]
            );
          }
        } catch (priceErr) {
          console.error('Could not fetch call price:', priceErr.message);
        }
      }
    }
  } catch (err) {
    console.error('call-status webhook error:', err);
  }
  res.status(200).end();
});

module.exports = router;
