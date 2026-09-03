const pool = require('../db/pool');
const { createSendBatch } = require('./sends');

const RATE_LIMIT_PER_HOUR = 10;
const PENDING_HOLD_HOURS = 48;

const NAME_EXPR = `COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.name, c.phone_number)`;

// ---- lookups ----------------------------------------------------------

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

async function getGroup(userId, groupId) {
  const { rows } = await pool.query(
    `SELECT id, name, member_posting, post_prefix FROM groups WHERE id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  return rows[0] || null;
}

// Groups this contact has JOINED and may post to.
async function postableGroups(userId, contactId) {
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.post_prefix, cg.is_admin
       FROM groups g
       JOIN contact_groups cg ON cg.group_id = g.id
      WHERE g.user_id = $1
        AND cg.contact_id = $2
        AND g.member_posting <> 'off'
        AND cg.join_status = 'joined'
        AND (cg.can_post = TRUE OR cg.is_admin = TRUE)
      ORDER BY g.name`,
    [userId, contactId]
  );
  return rows;
}

// Groups this contact has been invited to but not yet answered.
async function invitedGroups(userId, contactId) {
  const { rows } = await pool.query(
    `SELECT g.id, g.name
       FROM groups g
       JOIN contact_groups cg ON cg.group_id = g.id
      WHERE g.user_id = $1
        AND cg.contact_id = $2
        AND cg.join_status = 'pending'
        AND cg.invited_at IS NOT NULL
      ORDER BY cg.invited_at DESC`,
    [userId, contactId]
  );
  return rows;
}

async function joinedCount(groupId, exceptContactId = null) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM contact_groups
      WHERE group_id = $1 AND join_status = 'joined'
        AND ($2::int IS NULL OR contact_id <> $2)`,
    [groupId, exceptContactId]
  );
  return rows[0].n;
}

async function overRateLimit(contactId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM group_post_log
      WHERE contact_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
    [contactId]
  );
  return rows[0].n >= RATE_LIMIT_PER_HOUR;
}

// ---- pending "which group?" prompt -------------------------------------

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

// ---- sending -----------------------------------------------------------

// Sends one SMS to one contact via the normal send pipeline, so it lands in
// History with a cost. Flagged is_group_post so it stays out of the library.
async function sendSystemMessage({ user, contactId, title, text }) {
  const { rows } = await pool.query(
    `INSERT INTO messages (title, type, text_content, user_id, is_group_post)
     VALUES ($1, 'sms', $2, $3, TRUE) RETURNING id`,
    [title, text, user.id]
  );
  await createSendBatch({
    message_id: rows[0].id,
    recipients: [{ contact_id: contactId, method: 'sms' }],
    userId: user.id,
  });
  return rows[0].id;
}

function inviteText(groupName, othersCount) {
  const others = othersCount === 1 ? '1 other' : `${othersCount} others`;
  return `You've been added to "${groupName}" with ${others}.\n\n`
    + 'Reply #join to send and receive messages here via SMS (data rates apply) '
    + 'or #exit to leave the group.';
}

async function sendInvite({ user, group, contactId }) {
  const others = await joinedCount(group.id, contactId);
  await sendSystemMessage({
    user,
    contactId,
    title: `${group.name} invite`,
    text: inviteText(group.name, others),
  });
  await pool.query(
    `UPDATE contact_groups SET invited_at = NOW()
      WHERE group_id = $1 AND contact_id = $2`,
    [group.id, contactId]
  );
}

async function fanOut({ user, group, sender, body }) {
  const { rows: members } = await pool.query(
    `SELECT c.id, c.methods, c.preferred_method, cg.join_status, cg.invited_at
       FROM contacts c
       JOIN contact_groups cg ON cg.contact_id = c.id
       JOIN groups g ON g.id = cg.group_id
      WHERE cg.group_id = $1
        AND g.user_id = $2
        AND c.user_id = $2
        AND cg.muted = FALSE
        AND cg.join_status <> 'declined'
        AND c.id <> $3`,
    [group.id, user.id, sender.id]
  );

  const smsCapable = members.filter((m) => {
    const enabled = m.methods && m.methods.length ? m.methods : [m.preferred_method];
    return enabled.includes('sms');
  });

  const joined = smsCapable.filter((m) => m.join_status === 'joined');
  const notYet = smsCapable.filter((m) => m.join_status === 'pending');

  const text = group.post_prefix === 'group_name'
    ? `${group.name} — ${sender.display_name}: ${body}`
    : `${sender.display_name}: ${body}`;

  const { rows: msgRows } = await pool.query(
    `INSERT INTO messages (title, type, text_content, user_id, is_group_post)
     VALUES ($1, 'sms', $2, $3, TRUE) RETURNING id`,
    [`${group.name} post`, text, user.id]
  );
  const messageId = msgRows[0].id;

  if (joined.length) {
    await createSendBatch({
      message_id: messageId,
      recipients: joined.map((m) => ({ contact_id: m.id, method: 'sms' })),
      userId: user.id,
    });
  }

  // Anyone not yet joined: hold this message, and invite them if we haven't.
  for (const m of notYet) {
    await pool.query(
      `INSERT INTO pending_group_messages (group_id, contact_id, message_id)
       VALUES ($1, $2, $3)`,
      [group.id, m.id, messageId]
    );
    if (!m.invited_at) {
      await sendInvite({ user, group, contactId: m.id });
    }
  }

  await pool.query(
    `INSERT INTO group_post_log (group_id, contact_id, message_id, body)
     VALUES ($1, $2, $3, $4)`,
    [group.id, sender.id, messageId, body]
  );

  return '';
}

// ---- join / exit -------------------------------------------------------

async function deliverHeldMessages({ user, group, contactId }) {
  const { rows } = await pool.query(
    `SELECT DISTINCT message_id FROM pending_group_messages
      WHERE group_id = $1 AND contact_id = $2
        AND created_at > NOW() - ($3 || ' hours')::interval
      ORDER BY message_id ASC`,
    [group.id, contactId, PENDING_HOLD_HOURS]
  );

  for (const r of rows) {
    await createSendBatch({
      message_id: r.message_id,
      recipients: [{ contact_id: contactId, method: 'sms' }],
      userId: user.id,
    });
  }

  await pool.query(
    `DELETE FROM pending_group_messages WHERE group_id = $1 AND contact_id = $2`,
    [group.id, contactId]
  );

  return rows.length;
}

async function handleJoin({ user, group, sender }) {
  await pool.query(
    `UPDATE contact_groups SET join_status = 'joined', joined_at = NOW(), muted = FALSE
      WHERE group_id = $1 AND contact_id = $2`,
    [group.id, sender.id]
  );
  const held = await deliverHeldMessages({ user, group, contactId: sender.id });
  const others = await joinedCount(group.id, sender.id);
  const tail = held ? '' : ' Text this number any time to reach the group.';
  return `You're in "${group.name}" with ${others} ${others === 1 ? 'other' : 'others'}.`
    + `${tail} Text #exit to leave.`;
}

async function handleExit({ group, sender }) {
  await pool.query(
    `UPDATE contact_groups SET join_status = 'declined' WHERE group_id = $1 AND contact_id = $2`,
    [group.id, sender.id]
  );
  await pool.query(
    `DELETE FROM pending_group_messages WHERE group_id = $1 AND contact_id = $2`,
    [group.id, sender.id]
  );
  return `You've left "${group.name}". Nothing further will be sent to you from this group.`;
}

// ---- admin commands ----------------------------------------------------

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
    `INSERT INTO contact_groups (contact_id, group_id, can_post, join_status)
     VALUES ($1, $2, TRUE, 'pending')
     ON CONFLICT (contact_id, group_id) DO UPDATE SET can_post = TRUE, muted = FALSE`,
    [contactId, group.id]
  );

  await sendInvite({ user, group, contactId });
  return `${name} has been invited to ${group.name}. They join by replying #join.`;
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

async function cmdCount({ group }) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS members,
            (COUNT(*) FILTER (WHERE cg.join_status = 'joined'))::int AS joined,
            (COUNT(*) FILTER (WHERE cg.join_status = 'pending'))::int AS pending,
            (COUNT(*) FILTER (WHERE cg.can_post AND cg.join_status = 'joined'))::int AS posters
       FROM contact_groups cg WHERE cg.group_id = $1`,
    [group.id]
  );
  const { rows: postRows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM group_post_log
      WHERE group_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
    [group.id]
  );
  const r = rows[0];
  return `${group.name}: ${r.joined} joined, ${r.pending} not yet joined, ${r.posters} can post. `
    + `${postRows[0].n} posts in the last 7 days.`;
}

const COMMAND_HELP = 'Commands: #add 8455551234 First Last · #remove 8455551234 · #count · #exit';

async function handleCommand({ user, group, rest, verb, isAdmin }) {
  try {
    if (verb === '#count') {
      if (!isAdmin) return 'Only group admins can use that.';
      return await cmdCount({ group });
    }
    if (verb === '#add') {
      if (!isAdmin) return 'Only group admins can use that.';
      return await cmdAdd({ user, group, rest });
    }
    if (verb === '#remove') {
      if (!isAdmin) return 'Only group admins can use that.';
      return await cmdRemove({ user, group, rest });
    }
    if (verb === '#help') return COMMAND_HELP;
  } catch (err) {
    console.error('group command error:', err);
    return 'That command failed. Check the format and try again.';
  }
  return null;
}

// ---- entry point -------------------------------------------------------

/**
 * Handles an inbound SMS as a possible group post.
 * Returns a string to text back ('' means stay silent), or null to let the
 * existing reply-saving path handle it.
 */
async function handleGroupPost({ user, from, body, directGroupId = null }) {
  const sender = await findContactByPhone(user.id, from);
  if (!sender) return null;

  const trimmed = (body || '').trim();
  const spaceAt = trimmed.indexOf(' ');
  const verb = (spaceAt === -1 ? trimmed : trimmed.slice(0, spaceAt)).toLowerCase();
  const rest = spaceAt === -1 ? '' : trimmed.slice(spaceAt + 1);
  const isCommand = verb.startsWith('#');

  // --- #join / #exit answer an outstanding invite -----------------------
  if (verb === '#join' || verb === '#exit') {
    let group = null;

    if (directGroupId) {
      group = await getGroup(user.id, directGroupId);
    } else {
      const invites = await invitedGroups(user.id, sender.id);
      if (invites.length === 1) {
        group = await getGroup(user.id, invites[0].id);
      } else if (invites.length > 1) {
        const list = invites.map((g, i) => `${i + 1} ${g.name}`).join('\n');
        return `Which group?\n${list}\nReply with the number, then #join or #exit.`;
      } else if (verb === '#exit') {
        // No pending invite — treat as leaving the group they post to.
        const groups = await postableGroups(user.id, sender.id);
        if (groups.length === 1) group = await getGroup(user.id, groups[0].id);
      }
    }

    if (!group) return "You don't have a group invitation waiting.";
    return verb === '#join'
      ? handleJoin({ user, group, sender })
      : handleExit({ group, sender });
  }

  // --- dedicated number -------------------------------------------------
  if (directGroupId) {
    const group = await getGroup(user.id, directGroupId);
    if (!group || group.member_posting === 'off') return null;

    const { rows: perm } = await pool.query(
      `SELECT can_post, muted, is_admin, join_status, invited_at
         FROM contact_groups WHERE group_id = $1 AND contact_id = $2`,
      [group.id, sender.id]
    );
    if (!perm.length) return null;
    const p = perm[0];

    if (p.join_status === 'pending') {
      if (!p.invited_at) await sendInvite({ user, group, contactId: sender.id });
      return 'Reply #join to start sending and receiving messages in this group, or #exit to leave.';
    }
    if (p.join_status === 'declined') return null;

    if (isCommand) {
      const reply = await handleCommand({ user, group, rest, verb, isAdmin: p.is_admin });
      if (reply !== null) return reply;
    }

    if (!p.can_post) return `You're not set up to post to ${group.name} yet.`;
    if (await overRateLimit(sender.id)) return 'You have sent a lot of messages in the last hour. Try again shortly.';

    return fanOut({ user, group, sender, body });
  }

  // --- shared number ----------------------------------------------------
  const pending = await getPendingPick(user.id, from);
  if (pending) {
    const choice = parseInt(trimmed, 10);
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

  // Not joined anywhere, but invited somewhere: nudge instead of posting.
  if (!groups.length) {
    const invites = await invitedGroups(user.id, sender.id);
    if (invites.length) {
      return `Reply #join to start sending and receiving messages in "${invites[0].name}", or #exit to leave.`;
    }
    return null;
  }

  if (groups.length === 1) {
    if (isCommand) {
      const reply = await handleCommand({ user, group: groups[0], rest, verb, isAdmin: groups[0].is_admin });
      if (reply !== null) return reply;
    }
    if (await overRateLimit(sender.id)) return 'You have sent a lot of messages in the last hour. Try again shortly.';
    return fanOut({ user, group: groups[0], sender, body });
  }

  await savePendingPick(user.id, from, { text: body, options: groups.map((g) => ({ id: g.id, name: g.name })) });
  const list = groups.map((g, i) => `${i + 1} ${g.name}`).join('\n');
  return `Which group is this for?\n${list}\nReply with the number.`;
}

// Called from the portal (routes/groups.js) to invite pending members.
async function sendInvites({ userId, groupId, contactIds }) {
  const { rows: userRows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  if (!userRows.length) throw new Error('User not found');
  const user = userRows[0];

  const group = await getGroup(userId, groupId);
  if (!group) throw new Error('Group not found');

  let sent = 0;
  for (const contactId of contactIds) {
    try {
      await sendInvite({ user, group, contactId });
      sent += 1;
    } catch (err) {
      console.error('invite failed for contact', contactId, err);
    }
  }
  return sent;
}

module.exports = { handleGroupPost, lookupGroupNumber, sendInvites };
