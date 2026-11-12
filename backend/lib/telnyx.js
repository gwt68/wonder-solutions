/* ==================================================================
 * telnyx.js — Telnyx send paths
 * ==================================================================
 * Mirrors what sendToContact does on Twilio, so the caller doesn't
 * care which provider is active.
 *
 * Env vars:
 *   TELNYX_API_KEY              required
 *   TELNYX_MESSAGING_PROFILE_ID required for SMS/MMS
 *   TELNYX_TEXML_APP_ID         required for calls
 *
 * NOTE: the TeXML call parameters below mirror Twilio's REST shape,
 * which is what Telnyx documents, but they have NOT been tested
 * against a live account yet. Verify on the first test call before
 * trusting them.
 * ================================================================== */

const API = 'https://api.telnyx.com/v2';

function key() {
  const k = (process.env.TELNYX_API_KEY || '').trim();
  if (!k) throw new Error('TELNYX_API_KEY is not configured');
  return k;
}

async function post(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}

  if (!res.ok) {
    const detail = json?.errors?.[0]?.detail || text.slice(0, 300);
    throw new Error(`Telnyx ${res.status}: ${detail}`);
  }
  return json?.data || {};
}

/** SMS. Returns the Telnyx message id, which we store in twilio_sid. */
async function sendSms({ to, from, text, statusCallback }) {
  const data = await post('/messages', {
    from, to, text,
    ...(process.env.TELNYX_MESSAGING_PROFILE_ID
      ? { messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID } : {}),
    ...(statusCallback ? { webhook_url: statusCallback } : {}),
    use_profile_webhooks: false
  });
  return data.id;
}

/** MMS — same endpoint, media_urls instead of (or alongside) text. */
async function sendMms({ to, from, text, mediaUrl, statusCallback }) {
  const data = await post('/messages', {
    from, to,
    media_urls: [mediaUrl],
    ...(text ? { text } : {}),
    ...(process.env.TELNYX_MESSAGING_PROFILE_ID
      ? { messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID } : {}),
    ...(statusCallback ? { webhook_url: statusCallback } : {}),
    use_profile_webhooks: false
  });
  return data.id;
}

/**
 * Outbound call via a TeXML application.
 *
 * Telnyx fetches the TeXML from `url` rather than accepting inline XML
 * the way Twilio's `twiml` parameter does, so the caller has to expose
 * the document at a public URL.
 */
async function startCall({ to, from, url, statusCallback }) {
  const appId = (process.env.TELNYX_TEXML_APP_ID || '').trim();
  if (!appId) throw new Error('TELNYX_TEXML_APP_ID is not configured');

  const data = await post(`/texml/calls/${appId}`, {
    To: to,
    From: from,
    Url: url,
    ...(statusCallback ? {
      StatusCallback: statusCallback,
      StatusCallbackMethod: 'POST',
      StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed']
    } : {}),
    MachineDetection: 'Enable',
    MachineDetectionTimeout: 4
  });

  return data.call_sid || data.id;
}

module.exports = { sendSms, sendMms, startCall };