const twilio = require("twilio");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });
const client = twilio(process.env.TW_SID, process.env.TW_TOKEN);

(async () => {
  const { rows } = await pool.query(
    "SELECT id, twilio_sid FROM sends WHERE cost IS NULL AND twilio_sid IS NOT NULL AND created_at::date = '2026-11-04'"
  );
  console.log("to fetch:", rows.length);
  let done = 0, skipped = 0;
  for (const r of rows) {
    try {
      const m = await client.messages(r.twilio_sid).fetch();
      if (m.price != null) {
        await pool.query("UPDATE sends SET cost = $1, cost_unit = $2 WHERE id = $3",
          [Math.abs(parseFloat(m.price)), m.priceUnit || "USD", r.id]);
        done++;
      } else skipped++;
    } catch (e) { skipped++; }
    if ((done + skipped) % 50 === 0) console.log(done + skipped, "/", rows.length);
  }
  console.log("updated:", done, "no price:", skipped);
  await pool.end();
})();