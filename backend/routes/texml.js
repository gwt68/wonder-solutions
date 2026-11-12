/* ==================================================================
 * texml.js — call documents for Telnyx
 * ==================================================================
 * Twilio accepts TwiML inline on calls.create(). Telnyx fetches it
 * from a URL instead, so each outbound call points here and we render
 * the same document.
 *
 * Deliberately NOT behind requireAuth — Telnyx has no session. The id
 * is a plain integer, so treat anything served here as public. That is
 * acceptable for broadcast content going out to a whole group anyway,
 * but do not route anything private through it.
 * ================================================================== */

const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const pool = require('../db/pool');

const VoiceResponse = twilio.twiml.VoiceResponse;

function audioProxyUrl(messageId) {
  const base = (process.env.BASE_URL || '').replace(/\/$/, '');
  return `${base}/api/messages/${messageId}/audio`;
}

async function render(req, res) {
  const id = parseInt(req.params.messageId, 10);
  const twiml = new VoiceResponse();

  try {
    const { rows } = await pool.query(
      `SELECT id, text_content, audio_url, (audio_data IS NOT NULL) AS has_audio
         FROM messages WHERE id = $1`, [id]);

    const m = rows[0];
    if (!m) {
      twiml.say('That message is no longer available.');
    } else {
      // Matches the Twilio path: a short pause so a voicemail greeting
      // finishes before the message starts.
      twiml.pause({ length: 1 });
      if (m.audio_url || m.has_audio) twiml.play(audioProxyUrl(m.id));
      else if (m.text_content) twiml.say(m.text_content);
      else twiml.say('This message has nothing to play.');
    }
  } catch (err) {
    console.error('texml render failed:', err.message);
    twiml.say('Sorry, something went wrong.');
  }

  res.type('text/xml').send(twiml.toString());
}

router.get('/play/:messageId', render);
router.post('/play/:messageId', render);

module.exports = router;