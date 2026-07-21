const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireAuth } = require('./auth');

router.use(requireAuth);

// GET all contacts, with their group memberships
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, COALESCE(
        json_agg(
          json_build_object('id', g.id, 'name', g.name)
        ) FILTER (WHERE g.id IS NOT NULL), '[]'
      ) AS groups
      FROM contacts c
      LEFT JOIN contact_groups cg ON cg.contact_id = c.id
      LEFT JOIN groups g ON g.id = cg.group_id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// POST create a new contact
router.post('/', async (req, res) => {
  const { first_name, last_name, phone_number, email, address, city, state, zip, country, preferred_method, methods, notes, group_ids } = req.body;
  if (!phone_number) return res.status(400).json({ error: 'phone_number is required' });

  const enabledMethods = Array.isArray(methods) && methods.length ? methods : [preferred_method || 'sms'];
  const defaultMethod = enabledMethods.includes(preferred_method) ? preferred_method : enabledMethods[0];

  try {
    const { rows } = await pool.query(
      `INSERT INTO contacts (first_name, last_name, phone_number, email, address, city, state, zip, country, preferred_method, methods, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        first_name || null,
        last_name || null,
        phone_number,
        email || null,
        address || null,
        city || null,
        state || null,
        zip || null,
        country || null,
        defaultMethod,
        enabledMethods,
        notes || null,
      ]
    );
    const contact = rows[0];

    if (Array.isArray(group_ids) && group_ids.length) {
      const values = group_ids.map((gid) => `(${contact.id}, ${gid})`).join(',');
      await pool.query(
        `INSERT INTO contact_groups (contact_id, group_id) VALUES ${values} ON CONFLICT DO NOTHING`
      );
    }

    res.status(201).json(contact);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'A contact with this phone number already exists' });
    res.status(500).json({ error: 'Failed to create contact' });
  }
});

// POST bulk-import contacts (used by the Excel upload feature)
// Expects: { contacts: [{ first_name, last_name, phone_number, email, address, city, state, zip, country, preferred_method, notes }, ...], group_id }
router.post('/bulk', async (req, res) => {
  const { contacts, group_id } = req.body;
  if (!Array.isArray(contacts) || !contacts.length) {
    return res.status(400).json({ error: 'contacts array is required' });
  }

  const results = { created: 0, skipped: 0, errors: [] };

  for (const c of contacts) {
    const phone = (c.phone_number || '').toString().trim();
    if (!phone) {
      results.skipped++;
      results.errors.push({ row: c, reason: 'Missing phone number' });
      continue;
    }
    try {
      const method = c.preferred_method || 'sms';
      const { rows } = await pool.query(
        `INSERT INTO contacts (first_name, last_name, phone_number, email, address, city, state, zip, country, preferred_method, methods, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (phone_number) DO UPDATE SET
           first_name = COALESCE(EXCLUDED.first_name, contacts.first_name),
           last_name = COALESCE(EXCLUDED.last_name, contacts.last_name),
           email = COALESCE(EXCLUDED.email, contacts.email),
           address = COALESCE(EXCLUDED.address, contacts.address),
           city = COALESCE(EXCLUDED.city, contacts.city),
           state = COALESCE(EXCLUDED.state, contacts.state),
           zip = COALESCE(EXCLUDED.zip, contacts.zip),
           country = COALESCE(EXCLUDED.country, contacts.country),
           notes = COALESCE(EXCLUDED.notes, contacts.notes)
         RETURNING id`,
        [
          c.first_name || null,
          c.last_name || null,
          phone,
          c.email || null,
          c.address || null,
          c.city || null,
          c.state || null,
          c.zip || null,
          c.country || null,
          method,
          [method],
          c.notes || null,
        ]
      );
      if (group_id && rows.length) {
        await pool.query(
          `INSERT INTO contact_groups (contact_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [rows[0].id, group_id]
        );
      }
      results.created++;
    } catch (err) {
      results.skipped++;
      results.errors.push({ row: c, reason: err.message });
    }
  }

  res.json(results);
});

// PUT update a contact
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { first_name, last_name, phone_number, email, address, city, state, zip, country, preferred_method, methods, notes, group_ids } = req.body;

  let defaultMethod = preferred_method;
  let enabledMethods = Array.isArray(methods) && methods.length ? methods : null;
  if (enabledMethods && defaultMethod && !enabledMethods.includes(defaultMethod)) {
    defaultMethod = enabledMethods[0];
  }

  try {
    const { rows } = await pool.query(
      `UPDATE contacts SET
         first_name = $1,
         last_name = $2,
         phone_number = COALESCE($3, phone_number),
         email = $4,
         address = $5,
         city = $6,
         state = $7,
         zip = $8,
         country = $9,
         preferred_method = COALESCE($10, preferred_method),
         methods = COALESCE($11, methods),
         notes = $12
       WHERE id = $13 RETURNING *`,
      [
        first_name || null,
        last_name || null,
        phone_number,
        email || null,
        address || null,
        city || null,
        state || null,
        zip || null,
        country || null,
        defaultMethod,
        enabledMethods,
        notes || null,
        id,
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Contact not found' });

    if (Array.isArray(group_ids)) {
      await pool.query('DELETE FROM contact_groups WHERE contact_id = $1', [id]);
      if (group_ids.length) {
        const values = group_ids.map((gid) => `(${id}, ${gid})`).join(',');
        await pool.query(`INSERT INTO contact_groups (contact_id, group_id) VALUES ${values}`);
      }
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// DELETE a contact
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM contacts WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// POST bulk-update several contacts' delivery methods at once, e.g.
// { ids: [1,2,3], methods: ['voice_note'], preferred_method: 'voice_note' }
router.post('/bulk-update', async (req, res) => {
  const { ids, methods, preferred_method } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'ids array is required' });
  }
  if (!Array.isArray(methods) || !methods.length) {
    return res.status(400).json({ error: 'methods array is required' });
  }
  const finalPreferred = methods.includes(preferred_method) ? preferred_method : methods[0];
  try {
    const { rowCount } = await pool.query(
      `UPDATE contacts SET methods = $1, preferred_method = $2 WHERE id = ANY($3::int[])`,
      [methods, finalPreferred, ids]
    );
    res.json({ updated: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update contacts' });
  }
});

// POST bulk delete several contacts at once, e.g. { ids: [1, 2, 3] }
router.post('/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'ids array is required' });
  }
  try {
    const { rowCount } = await pool.query('DELETE FROM contacts WHERE id = ANY($1::int[])', [ids]);
    res.json({ deleted: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete contacts' });
  }
});

module.exports = router;
