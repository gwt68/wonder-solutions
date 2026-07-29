const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const { sendSMS } = require('./signalhouse');

// Temporary test route — sends one SMS via Signal House to confirm the
// integration works. Remove once real sends.js migration is complete.
router.post('/test-sms', requireAuth, async (req, res) => {
  const { to, body } = req.body;
  if (!to || !body) return res.status(400).json({ error: 'to and body are required' });

  const result = await sendSMS({
    from: '+18456133686', // your new Signal House test number
    to,
    body,
  });

  res.json(result);
});

module.exports = router;