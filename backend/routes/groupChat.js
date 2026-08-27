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
    `SELECT g.id, g.name, cg.is_admin
       FROM groups g
       JOIN contact_groups cg ON cg.group_id = g.id
      WHERE g.user_id = $1
        AND cg.contact_id = $2
        AND g.member_posting <> 'off'
        AND (cg.can_post = TRUE OR cg.is_admin = TRUE)
      ORDER BY g.name`,
    [userId, contactId]
  );
  return rows;
}

// ---- Admin commands ---------------------------------------------------

function normalizePhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

async function cmdAdd({ user, group, rest }) {
  const parts = rest.trim().split(/\s+/);
  const phone = normalizePhone(parts[0]);
  if (!phone) return 'Use: #add 8455551234 First Last';
  const name = parts.slice(1).join(' ').trim();
  if (!name) return 'Add a name too: #add 8455551234 First Last';

  const [firstName, ...lastParts] = name.split(' ');

  const existing = await findContactByPhone(user.id, phone);
  let contactId = existing?.id;

  if (!contactId) {
    const { rows } = await pool.query(
      `INSERT INTO contacts (first_name, last_name, phone_number, preferred_method, methods, user_id)
       VALUES ($1, $2, $3, 'sms', ARRAY['sms'], $4) RETURNING id`,
      [firstName, lastParts.join(' ') || null, phone, user.id]
    );
    contactId = rows[0].id;
  }

  await pool.query(
    `INSERT INTO contact_groups (contact_id, group_id, can_post)
     VALUES ($1, $2, TRUE)
     ON CONFLICT (contact_id, group_id) DO UPDATE SET can_post = TRUE, muted = FALSE`,
    [contactId, group.id]
  );

  return `${name} added to ${group.name} and can post.`;
}

async function cmdRemove({ user, group, rest }) {
  const phone = normalizePhone(rest.trim().split(/\s+/)[0]);
  if (!phone) return 'Use: #remove 8455551234';

  const contact = await findContactByPhone(user.id, phone);
  if (!contact) return 'No contact with that number.';

  const { rowCount } = await pool.query(
    `DELETE FROM contact_groups WHERE contact_id = $1 AND group_id = $2`,
    [contact.id, group.id]
  );
  if (!rowCount) return `${contact.display_name} is not in ${group.name}.`;
  return `${contact.display_name} removed from ${group.name}.`;
}

async function cmdCount({ user, group }) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS members,
            (COUNT(*) FILTER (WHERE cg.can_post))::int AS posters,
            (COUNT(*) FILTER (WHERE cg.muted))::int AS muted
       FROM contact_groups cg WHERE cg.group_id = $1`,
    [group.id]
  );
  const { rows: postRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM group_post_log
      WHERE group_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
    [group.id]
  );
  const r = rows[0];
  return `${group.name}: ${r.members} members, ${r.posters} can post, ${r.muted} muted. ${postRows[0].n} posts in the last 7 days.`;
}

const COMMAND_HELP = 'Commands: #add 8455551234 First Last · #remove 8455551234 · #count';

async function handleCommand({ user, group, sender, body, isAdmin }) {
  if (!isAdmin) return 'Only group admins can use commands.';

  const trimmed = body.trim();
  const spaceAt = trimmed.indexOf(' ');
  const verb = (spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt)).toLowerCase();
  const rest = spaceAt === -1 ? '' : trimmed.slice(spaceAt + 1);

  try {
    if (verb === '#add') return await cmdAdd({ user, group, rest });
    if (verb === '#remove') return await cmdRemove({ user, group, rest });
    if (verb === '#count') return await cmdCount({ user, group });
    if (verb === '#help') return COMMAND_HELP;
  } catch (err) {
    console.error('group command error:', err);
    return 'That command failed. Check the format and try again.';
  }
  return `Unknown command. ${COMMAND_HELP}`;
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
  const messageId = msgRows[0].id;

  await createSendBatch({
    message_id: messageId,
    recipients: smsMembers.map((m) => ({ contact_id: m.id, method: 'sms' })),
    userId: user.id,
  });

  // One row per post: drives both the rate limit and the Group Chat feed.
  await pool.query(
    `INSERT INTO group_post_log (group_id, contact_id, message_id, body)
     VALUES ($1, $2, $3, $4)`,
    [group.id, sender.id, messageId, body]
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
      `SELECT can_post, muted, is_admin FROM contact_groups WHERE group_id = $1 AND contact_id = $2`,
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

    if (body.trim().startsWith('#')) {
      return handleCommand({ user, group, sender, body, isAdmin: perm[0].is_admin });
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
    if (body.trim().startsWith('#')) {
      return handleCommand({ user, group: groups[0], sender, body, isAdmin: groups[0].is_admin });
    }
    if (await overRateLimit(sender.id)) return 'You have sent a lot of messages in the last hour. Try again shortly.';
    return fanOut({ user, group: groups[0], sender, body });
  }

  await savePendingPick(user.id, from, { text: body, options: groups.map((g) => ({ id: g.id, name: g.name })) });
  const list = groups.map((g, i) => `${i + 1} ${g.name}`).join('\n');
  return `Which group is this for?\n${list}\nReply with the number.`;
}

module.exports = { handleGroupPost, lookupGroupNumber };
