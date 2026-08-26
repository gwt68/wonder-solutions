const pool = require('../db/pool');
const { createSendBatch } = require('./sends');

const RATE_LIMIT_PER_HOUR = 10;

const NAME_EXPR = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.name, c.phone_number)`;

// A number dedicated to one group, if this inbound arrived on one.
async function lookupGroupNumber(calledNumber) {
  const { rows } = await pool.query(
    `SELECT gn.group_id, g.name AS group_name, g.member_posting, u.*
       FROM group_numbers gn
       JOIN groups g ON g.id = gn.group_id
       JOIN users  u ON u.id = gn.user_id
      WHERE gn.phone_number = $1`,
    [calledNumber]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    group: { id: r.group_id, name: r.group_name, member_posting: r.member_posting },
    user: r,
  };
}

async function findContactByPhone(userId, phone) {
  const { rows } = await pool.query(
    `SELECT c.id, c.methods, c.preferred_method, ${NAME_EXPR} AS display_name
       FROM contacts c
      WHERE c.user_id = $2
        AND regexp_replace(c.phone_number, '\\D', '', 'g')
            LIKE '%' || right(regexp_replace($1, '\\D', '', 'g'), 10)
      LIMIT 1`,
    [phone, userId]
  );
  return rows[0] || null;
}

// Groups this contact may post to.
async function postableGroups(userId, contactId) {
  const { rows } = await pool.query(
    `SELECT g.id, g.name
       FROM groups g
       JOIN contact_groups cg ON cg.group_id = g.id
      WHERE g.user_id = $1
        AND cg.contact_id = $2
        AND g.member_posting <> 'off'
        AND cg.can_post = TRUE
      ORDER BY g.name`,
    [userId, contactId]
  );
  return rows;
}

async function overRateLimit(contactId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM group_post_log
      WHERE contact_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [contactId]
  );
  return rows[0].n >= RATE_LIMIT_PER_HOUR;
}

async function getGroup(userId, groupId) {
  const { rows } = await pool.query(
    `SELECT id, name, member_posting FROM groups WHERE id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  return rows[0] || null;
}

// Pending "which group?" prompt, stored in the existing session table.
async function getPendingPick(userId, from) {
  const { rows } = await pool.query(
    `SELECT * FROM sms_send_sessions
      WHERE user_id = $1 AND from_phone_number = $2 AND step = 'group_pick'
        AND updated_at > NOW() - INTERVAL '10 minutes'`,
    [userId, from]
  );
  return rows[0] || null;
}

async function savePendingPick(userId, from, data) {
  await pool.query(
    `INSERT INTO sms_send_sessions (user_id, from_phone_number, step, data)
     VALUES ($1, $2, 'group_pick', $3)
     ON CONFLICT (user_id, from_phone_number)
       DO UPDATE SET step = 'group_pick', data = $3, updated_at = NOW()`,
    [userId, from, JSON.stringify(data)]
  );
}

async function clearPendingPick(userId, from) {
  await pool.query(
    `DELETE FROM sms_send_sessions
      WHERE user_id = $1 AND from_phone_number = $2 AND step = 'group_pick'`,
    [userId, from]
  );
}

async function fanOut({ user, group, sender, body }) {
  const { rows: members } = await pool.query(
    `SELECT c.id, c.methods, c.preferred_method
       FROM contacts c
       JOIN contact_groups cg ON cg.contact_id = c.id
       JOIN groups g ON g.id = cg.group_id
      WHERE cg.group_id = $1
        AND g.user_id = $2
        AND c.user_id = $2
        AND cg.muted = FALSE
        AND c.id <> $3`,
    [group.id, user.id, sender.id]
  );

  const smsMembers = members.filter((m) => {
    const enabled = m.methods && m.methods.length ? m.methods : [m.preferred_method];
    return enabled.includes('sms');
  });

  if (!smsMembers.length) return 'Nobody else in that group can receive texts right now.';

  const text = `${group.name} — ${sender.display_name}: ${body}`;

  const { rows: msgRows } = await pool.query(
    `INSERT INTO messages (title, type, text_content, user_id, is_group_post)
     VALUES ($1, 'sms', $2, $3, TRUE) RETURNING id`,
    [`${group.name} post`, text, user.id]
  );

  await createSendBatch({
    message_id: msgRows[0].id,
    recipients: smsMembers.map((m) => ({ contact_id: m.id, method: 'sms' })),
    userId: user.id,
  });

  await pool.query(
    `INSERT INTO group_post_log (group_id, contact_id) VALUES ($1, $2)`,
    [group.id, sender.id]
  );

  return `Sent to ${smsMembers.length} ${smsMembers.length === 1 ? 'person' : 'people'} in ${group.name}.`;
}

/**
 * Handles an inbound SMS as a possible group post.
 * Returns a reply string to text back, or null to let existing handling run.
 *
 * directGroupId is set when the message arrived on a group's dedicated number.
 */
async function handleGroupPost({ user, from, body, directGroupId = null }) {
  const sender = await findContactByPhone(user.id, from);
  if (!sender) return null;

  // Dedicated number: the group is already known.
  if (directGroupId) {
    const group = await getGroup(user.id, directGroupId);
    if (!group || group.member_posting === 'off') return null;

    const { rows: perm } = await pool.query(
      `SELECT can_post, muted FROM contact_groups WHERE group_id = $1 AND contact_id = $2`,
      [group.id, sender.id]
    );
    if (!perm.length) return null;

    if (/^leave$/i.test(body)) {
      await pool.query(
        `UPDATE contact_groups SET muted = TRUE WHERE group_id = $1 AND contact_id = $2`,
        [group.id, sender.id]
      );
      return `You've been muted in ${group.name}. Text JOIN to start receiving again.`;
    }
    if (/^join$/i.test(body)) {
      await pool.query(
        `UPDATE contact_groups SET muted = FALSE WHERE group_id = $1 AND contact_id = $2`,
        [group.id, sender.id]
      );
      return `You're back in ${group.name}.`;
    }

    if (!perm[0].can_post) return `You're not set up to post to ${group.name} yet.`;
    if (await overRateLimit(sender.id)) return 'You have sent a lot of messages in the last hour. Try again shortly.';

    return fanOut({ user, group, sender, body });
  }

  // Shared number: work out which group this is for.
  const pending = await getPendingPick(user.id, from);
  if (pending) {
    const choice = parseInt(body.trim(), 10);
    const options = pending.data.options || [];
    if (!Number.isInteger(choice) || choice < 1 || choice > options.length) {
      return `Reply with a number from 1 to ${options.length}.`;
    }
    const picked = options[choice - 1];
    await clearPendingPick(user.id, from);
    const group = await getGroup(user.id, picked.id);
    if (!group) return 'That group is no longer available.';
    if (await overRateLimit(sender.id)) return 'You have sent a lot of messages in the last hour. Try again shortly.';
    return fanOut({ user, group, sender, body: pending.data.text });
  }

  const groups = await postableGroups(user.id, sender.id);
  if (!groups.length) return null;

  if (groups.length === 1) {
    if (await overRateLimit(sender.id)) return 'You have sent a lot of messages in the last hour. Try again shortly.';
    return fanOut({ user, group: groups[0], sender, body });
  }

  await savePendingPick(user.id, from, { text: body, options: groups.map((g) => ({ id: g.id, name: g.name })) });
  const list = groups.map((g, i) => `${i + 1} ${g.name}`).join('\n');
  return `Which group is this for?\n${list}\nReply with the number.`;
}

module.exports = { handleGroupPost, lookupGroupNumber };
