/* ==================================================================
 * provider.js - which carrier sends for a given number
 * ==================================================================
 * During the migration both Twilio and Telnyx numbers are live at the
 * same time, so the sending number decides the provider rather than a
 * global flag. users.sms_provider is the source of truth; the set of
 * Telnyx numbers is cached briefly so this costs one query a minute
 * rather than one per message.
 * ================================================================== */

const pool = require('../db/pool');

const TTL_MS = 60 * 1000;

let telnyxNumbers = new Set();
let loadedAt = 0;

async function refresh() {
  const { rows } = await pool.query(
    'SELECT twilio_phone_number FROM users WHERE sms_provider = $1 AND twilio_phone_number IS NOT NULL',
    ['telnyx']
  );
  telnyxNumbers = new Set(rows.map(r => r.twilio_phone_number));
  loadedAt = Date.now();
}

/**
 * True when this number is served by Telnyx. On a lookup failure the
 * last known answer stands - better a stale answer than every send
 * silently switching provider because the database hiccuped.
 */
async function isTelnyxNumber(num) {
  if (!num) return false;

  if (Date.now() - loadedAt > TTL_MS) {
    try {
      await refresh();
    } catch (e) {
      console.error('provider lookup failed, using cached set:', e.message);
    }
  }

  return telnyxNumbers.has(num);
}

/** Forces the next call to re-read, for use right after changing a user. */
function invalidate() {
  loadedAt = 0;
}

module.exports = { isTelnyxNumber, invalidate };
