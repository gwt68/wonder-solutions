const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });

function scopeParam(req) {
  return req.isAdmin ? null : req.userId;
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, type, text_content, audio_url, audio_mime_type,
              (audio_data IS NOT NULL) AS has_uploaded_audio,
              (image_data IS NOT NULL) AS has_image, created_at
       FROM messages WHERE ($1::int IS NULL OR user_id = $1) ORDER BY created_at DESC`,
      [scopeParam(req)]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  const { title, type, text_content, audio_url } = req.body;
  if (!type) return res.status(400).json({ error: 'type is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO messages (title, type, text_content, audio_url, user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, type, text_content, audio_url,
                 (audio_data IS NOT NULL) AS has_uploaded_audio,
                 (image_data IS NOT NULL) AS has_image, created_at`,
      [title || null, type, text_content || null, audio_url || null, req.userId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create message' });
  }
});

router.post('/upload', requireAuth, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file was uploaded' });
  const title = req.body.title || req.file.originalname;
  try {
    const { rows } = await pool.query(
      `INSERT INTO messages (title, type, audio_data, audio_mime_type, user_id)
       VALUES ($1, 'voice_note', $2, $3, $4)
       RETURNING id, title, type, text_content, audio_url,
                 (audio_data IS NOT NULL) AS has_uploaded_audio,
                 (image_data IS NOT NULL) AS has_image, created_at`,
      [title, req.file.buffer, req.file.mimetype, req.userId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save uploaded audio' });
  }
});

router.post('/upload-image', requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image file was uploaded' });
  const title = req.body.title || req.file.originalname;
  try {
    const { rows } = await pool.query(
      `INSERT INTO messages (title, type, image_data, image_mime_type, user_id)
       VALUES ($1, 'image', $2, $3, $4)
       RETURNING id, title, type, text_content, audio_url,
                 (audio_data IS NOT NULL) AS has_uploaded_audio,
                 (image_data IS NOT NULL) AS has_image, created_at`,
      [title, req.file.buffer, req.file.mimetype, req.userId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save uploaded image' });
  }
});

router.put('/:id', requireAuth, async (req, res) => {
  const { title, text_content } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE messages SET title = COALESCE($1, title), text_content = COALESCE($2, text_content)
       WHERE id = $3 AND ($4::int IS NULL OR user_id = $4)
       RETURNING id, title, type, text_content, audio_url,
                 (audio_data IS NOT NULL) AS has_uploaded_audio,
                 (image_data IS NOT NULL) AS has_image, created_at`,
      [title, text_content, req.params.id, scopeParam(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Message not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

router.put('/:id/audio', requireAuth, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file was uploaded' });
  try {
    const { rows } = await pool.query(
      `UPDATE messages SET audio_data = $1, audio_mime_type = $2, audio_url = NULL
       WHERE id = $3 AND ($4::int IS NULL OR user_id = $4)
       RETURNING id, title, type, text_content, audio_url,
                 (audio_data IS NOT NULL) AS has_uploaded_audio,
                 (image_data IS NOT NULL) AS has_image, created_at`,
      [req.file.buffer, req.file.mimetype, req.params.id, scopeParam(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Message not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save trimmed audio' });
  }
});

router.get('/:id/audio', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT audio_data, audio_mime_type, audio_url FROM messages WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).end();
    const msg = rows[0];
    if (msg.audio_data) {
      res.set('Content-Type', msg.audio_mime_type || 'audio/mpeg');
      return res.send(msg.audio_data);
    }
    if (msg.audio_url) {
      const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
      const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
      if (!sid || !token) return res.status(500).json({ error: 'Server is missing Twilio credentials' });
      const auth = Buffer.from(`${sid}:${token}`).toString('base64');
      const twilioRes = await fetch(msg.audio_url, { headers: { Authorization: `Basic ${auth}` } });
      if (!twilioRes.ok) {
        const body = await twilioRes.text().catch(() => '');
        return res.status(502).json({ error: 'Could not fetch recording from Twilio', twilioStatus: twilioRes.status, twilioBody: body.slice(0, 300) });
      }
      res.set('Content-Type', twilioRes.headers.get('content-type') || 'audio/mpeg');
      const buffer = Buffer.from(await twilioRes.arrayBuffer());
      return res.send(buffer);
    }
    res.status(404).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load audio' });
  }
});

router.get('/:id/image', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT image_data, image_mime_type FROM messages WHERE id = $1', [req.params.id]);
    if (!rows.length || !rows[0].image_data) return res.status(404).end();
    res.set('Content-Type', rows[0].image_mime_type || 'image/jpeg');
    res.send(rows[0].image_data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load image' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM messages WHERE id = $1 AND ($2::int IS NULL OR user_id = $2)', [req.params.id, scopeParam(req)]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete message' });
  }
});

router.post('/bulk-delete', requireAuth, async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM messages WHERE id = ANY($1::int[]) AND ($2::int IS NULL OR user_id = $2)',
      [ids, scopeParam(req)]
    );
    res.json({ deleted: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete messages' });
  }
});

module.exports = router;