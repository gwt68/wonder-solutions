// One-time backfill: pulls the last 7 days of inbound calls from Twilio
// and inserts any that aren't already in call_ins.
// Run once with: node backfill-callins.js   (from the backend folder)
// Then delete this file.

const twilio = require('twilio');
const pool = require('./db/pool');

const DAYS_BACK = 7;

async function main() {
  const client = twilio(
    (process.env.TWILIO_ACCOUNT_SID || '').trim(),
    (process.env.TWILIO_AUTH_TOKEN || '').trim()
  );

  const since = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000);

  // Map each user's Twilio number so we know which account a call belongs to
  const { rows: users } = await pool.query(
    'SELECT id, twilio_phone_number FROM users WHERE twilio_phone_number IS NOT NULL'
  );
  const numberToUser = {};
  users.forEach((u) => { numberToUser[u.twilio_phone_number] = u.id; });

  console.log(`Fetching inbound calls since ${since.toISOString()}...`);
  const calls = await client.calls.list({ startTimeAfter: since, limit: 1000 });
  const inbound = calls.filter((c) => c.direction === 'inbound');
  console.log(`Found ${inbound.length} inbound calls.`);

  let inserted = 0;
  let skipped = 0;

  for (const call of inbound) {
    const userId = numberToUser[call.to];
    if (!userId) { skipped += 1; continue; }

    const { rows: contactRows } = await pool.query(
      `SELECT id FROM contacts
       WHERE user_id = $2
         AND regexp_replace(phone_number, '\\D', '', 'g')
             LIKE '%' || right(regexp_replace($1, '\\D', '', 'g'), 10)`,
      [call.from, userId]
    );

    const { rows: trustedRows } = await pool.query(
      'SELECT 1 FROM trusted_phones WHERE phone_number = $1 AND user_id = $2',
      [call.from, userId]
    );

    const result = await pool.query(
      `INSERT INTO call_ins
         (user_id, call_sid, from_phone_number, contact_id, is_trusted,
          status, duration_seconds, cost, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (call_sid) DO NOTHING`,
      [
        userId,
        call.sid,
        call.from,
        contactRows[0]?.id || null,
        trustedRows.length > 0,
        call.status,
        call.duration ? parseInt(call.duration, 10) : null,
        call.price ? Math.abs(parseFloat(call.price)) : null,
        call.startTime,
        call.endTime,
      ]
    );

    if (result.rowCount > 0) inserted += 1; else skipped += 1;
  }

  console.log(`Done. Inserted ${inserted}, skipped ${skipped}.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});