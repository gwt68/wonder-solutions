const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

router.use(requireAuth);

// GET /api/call-ins?userId=all|<id>
router.get('/', async (req, res) => {
  try {
    const isAdmin = !!req.isAdmin;
    const requested = req.query.userId;

    let scope = 'ci.user_id = $1';
    let params = [req.userId];

    if (isAdmin && requested === 'all') {
      scope = 'TRUE';
      params = [];
    } else if (isAdmin && requested && requested !== 'all') {
      params = [parseInt(requested, 10)];
    }

    const { rows } = await pool.query(
      `SELECT ci.id, ci.call_sid, ci.from_phone_number, ci.is_trusted,
              ci.interrupted_with, ci.reached, ci.status,
              ci.duration_seconds, ci.cost, ci.started_at, ci.ended_at,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.name) AS contact_name,
              m.title AS played_message_name,
              u.username AS user_name
         FROM call_ins ci
         LEFT JOIN contacts c ON c.id = ci.contact_id
         LEFT JOIN messages m ON m.id = ci.played_message_id
         LEFT JOIN users u    ON u.id = ci.user_id
        WHERE ${scope}
        ORDER BY ci.started_at DESC
        LIMIT 500`,
      params
    );

    const totalCost = rows.reduce((s, r) => s + (parseFloat(r.cost) || 0), 0);
    const totalSeconds = rows.reduce((s, r) => s + (r.duration_seconds || 0), 0);

    res.json({ callIns: rows, totalCost, totalSeconds, count: rows.length });
  } catch (err) {
    console.error('call-ins fetch error:', err);
    res.status(500).json({ error: 'Failed to load call-ins' });
  }
});

module.exports = router;