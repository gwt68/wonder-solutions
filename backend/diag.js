const twilio = require("twilio");
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });
const client = twilio(process.env.TW_SID, process.env.TW_TOKEN);
(async () => {
  const { rows } = await pool.query(
    "SELECT id, twilio_sid FROM sends WHERE cost IS NULL AND twilio_sid IS NOT NULL AND created_at::date = '2026-11-04' LIMIT 3"
  );
  for (const r of rows) {
    try {
      const m = await client.messages(r.twilio_sid).fetch();
      console.log(r.twilio_sid, "status:", m.status, "price:", m.price, "unit:", m.priceUnit, "segments:", m.numSegments);
    } catch (e) {
      console.log(r.twilio_sid, "ERROR:", e.status, e.message);
    }
  }
  await pool.end();
})();