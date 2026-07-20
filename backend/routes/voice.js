const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const pool = require('../db/pool');
const { createSendBatch } = require('./sends');

const VoiceResponse = twilio.twiml.VoiceResponse;
const BASE_URL = process.env.BASE_URL; // e.g. https://wonder-solutions-backend.up.railway.app

// A male neural voice, spoken with a touch more pace and pitch for a livelier,
// more energetic feel than flat default TTS.
const SAY_OPTS = { voice: 'Polly.Matthew-Neural' };

// Wraps a TwiML node (VoiceResponse or a <Gather>) so every .say() call on it
// automatically gets a bit of extra energy via real SSML prosody (using
// Twilio's actual builder methods — passing raw SSML as a plain string gets
// escaped and read aloud literally, so this has to go through .prosody()).
function livelyVoice(node) {
  const originalSay = node.say.bind(node);
  node.say = (text, opts = {}) => {
    const sayNode = originalSay({ ...SAY_OPTS, ...opts });
    sayNode.prosody({ rate: '112%' }, text);
    return sayNode;
  };
  return node;
}

// Classic phone-keypad multi-tap letters, for entering a name via touch-tone.
const KEY_LETTERS = {
  '2': ['A', 'B', 'C'],
  '3': ['D', 'E', 'F'],
  '4': ['G', 'H', 'I'],
  '5': ['J', 'K', 'L'],
  '6': ['M', 'N', 'O'],
  '7': ['P', 'Q', 'R', 'S'],
  '8': ['T', 'U', 'V'],
  '9': ['W', 'X', 'Y', 'Z'],
};

// ---------- session helpers ----------

async function getSession(callSid) {
  const { rows } = await pool.query('SELECT * FROM call_sessions WHERE call_sid = $1', [callSid]);
  if (rows.length) return rows[0];
  const { rows: created } = await pool.query(
    `INSERT INTO call_sessions (call_sid, step, attempts, data) VALUES ($1, 'pin_entry', 0, '{}') RETURNING *`,
    [callSid]
  );
  return created[0];
}

async function updateSession(callSid, step, dataPatch = {}, attempts = null) {
  // Merges the data patch directly in Postgres (JSONB concatenation), avoiding
  // an extra SELECT before the UPDATE — cuts a full DB round trip off every
  // single interaction, which matters a lot for how snappy the call feels.
  const { rows } = await pool.query(
    `UPDATE call_sessions
     SET step = $1, data = data || $2::jsonb, attempts = COALESCE($3, attempts), updated_at = NOW()
     WHERE call_sid = $4
     RETURNING *`,
    [step, JSON.stringify(dataPatch), attempts, callSid]
  );
  return rows[0];
}

async function clearSession(callSid) {
  await pool.query('DELETE FROM call_sessions WHERE call_sid = $1', [callSid]);
}

async function getPin() {
  const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'call_in_pin'`);
  return rows.length ? rows[0].value : '1234';
}

// ---------- prompt builders ----------

function gatherDigits(twiml, action, prompt, opts = {}) {
  const gather = livelyVoice(twiml.gather({
    numDigits: opts.numDigits,
    finishOnKey: opts.finishOnKey ?? '#',
    action,
    method: 'POST',
    timeout: opts.timeout ?? 8,
  }));
  gather.say(prompt, SAY_OPTS);
  // if caller enters nothing, Twilio falls through past <Gather> - repeat the menu
  twiml.redirect(action.replace('/handle', '/repeat'));
  return twiml;
}

function say(twiml, text) {
  twiml.say(text, SAY_OPTS);
  return twiml;
}

// ---------- entry point ----------

router.post('/incoming', async (req, res) => {
  const callSid = req.body.CallSid;
  await clearSession(callSid); // fresh session on every new call
  await getSession(callSid); // creates pin_entry session

  const twiml = livelyVoice(new VoiceResponse());
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    'Welcome. Please enter your PIN followed by the pound sign.'
  );
  res.type('text/xml').send(twiml.toString());
});

// ---------- single handler, dispatches on session step ----------

router.post('/handle', async (req, res) => {
  const callSid = req.body.CallSid;
  const digits = req.body.Digits;
  // Twilio's RecordingUrl points to the recording *resource*, not the audio file itself.
  // Appending .mp3 gives the actual playable media.
  const recordingUrl = req.body.RecordingUrl ? `${req.body.RecordingUrl}.mp3` : null;
  const session = await getSession(callSid);
  const twiml = livelyVoice(new VoiceResponse());

  switch (session.step) {
    case 'pin_entry': {
      const correctPin = await getPin();
      if (digits === correctPin) {
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
      } else {
        const attempts = session.attempts + 1;
        if (attempts >= 3) {
          say(twiml, 'Too many incorrect attempts. Goodbye.');
          twiml.hangup();
          await clearSession(callSid);
        } else {
          await updateSession(callSid, 'pin_entry', {}, attempts);
          gatherDigits(twiml, `${BASE_URL}/voice/handle`, 'Incorrect PIN. Please try again, followed by the pound sign.');
        }
      }
      break;
    }

    case 'main_menu': {
      if (digits === '1') {
        await updateSession(callSid, 'record_prompt');
        recordPrompt(twiml);
      } else if (digits === '2') {
        await startReview(callSid, twiml);
      } else if (digits === '3') {
        await updateSession(callSid, 'contact_phone_entry');
        contactPhoneEntry(twiml);
      } else if (digits === '4') {
        await updateSession(callSid, 'pin_change_entry');
        pinChangeEntry(twiml);
      } else if (digits === '5') {
        await announceStatus(twiml);
      } else if (digits === '6') {
        await startBroadcastMessageSelect(callSid, twiml);
      } else if (digits === '7') {
        await updateSession(callSid, 'assign_group_phone_entry');
        assignGroupPhoneEntry(twiml);
      } else {
        mainMenu(twiml, true);
      }
      break;
    }

    // ----- Branch 4: change the call-in PIN -----

    case 'pin_change_entry': {
      if (digits && /^\d{4,8}$/.test(digits)) {
        await updateSession(callSid, 'pin_change_confirm', { pending_new_pin: digits });
        confirmNewPin(twiml, digits);
      } else {
        pinChangeEntry(twiml, true);
      }
      break;
    }

    case 'pin_change_confirm': {
      if (digits === '1') {
        await pool.query(
          `INSERT INTO settings (key, value) VALUES ('call_in_pin', $1)
           ON CONFLICT (key) DO UPDATE SET value = $1`,
          [session.data.pending_new_pin]
        );
        await updateSession(callSid, 'main_menu');
        say(twiml, 'Your PIN has been updated.');
        mainMenu(twiml);
      } else {
        await updateSession(callSid, 'pin_change_entry');
        pinChangeEntry(twiml);
      }
      break;
    }

    // ----- Branch 1: record a new message -----

    case 'record_prompt': {
      // Twilio hits this after <Record> completes, with RecordingUrl
      if (recordingUrl) {
        await updateSession(callSid, 'record_review', { pending_recording_url: recordingUrl });
        recordReviewPrompt(twiml);
      } else {
        recordPrompt(twiml); // shouldn't normally happen, re-prompt
      }
      break;
    }

    case 'record_review': {
      if (digits === '1') {
        // save
        const { rows } = await pool.query(
          `INSERT INTO messages (title, type, audio_url) VALUES ($1, 'voice_note', $2) RETURNING id`,
          [`Recorded by phone`, session.data.pending_recording_url]
        );
        await updateSession(callSid, 'main_menu', { last_message_id: rows[0].id });
        say(twiml, 'Message saved.');
        mainMenu(twiml);
      } else if (digits === '2') {
        twiml.play(session.data.pending_recording_url);
        recordReviewPrompt(twiml);
      } else if (digits === '3') {
        await updateSession(callSid, 'record_prompt');
        recordPrompt(twiml);
      } else if (digits === '4') {
        await updateSession(callSid, 'main_menu');
        say(twiml, 'Cancelled.');
        mainMenu(twiml);
      } else {
        recordReviewPrompt(twiml, true);
      }
      break;
    }

    // ----- Branch 2: review saved messages -----

    case 'review_list': {
      const ids = session.data.message_ids || [];
      let index = session.data.review_index || 0;

      if (digits === '0') {
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
        break;
      }
      if (digits === '2') {
        const currentId = ids[index];
        await pool.query('DELETE FROM messages WHERE id = $1', [currentId]);
      }
      // '1' (keep) and '#' (next) both just advance
      index += 1;
      if (index >= ids.length) {
        say(twiml, 'No more messages.');
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
      } else {
        await updateSession(callSid, 'review_list', { review_index: index });
        await playReviewMessage(twiml, ids[index], index, ids.length);
      }
      break;
    }

    // ----- Branch 3: manage contacts -----

    case 'contact_phone_entry': {
      if (digits && digits.length >= 10) {
        await updateSession(callSid, 'contact_phone_confirm', { pending_phone: digits });
        confirmPhone(twiml, digits);
      } else {
        contactPhoneEntry(twiml, true);
      }
      break;
    }

    case 'contact_phone_confirm': {
      if (digits === '1') {
        await updateSession(callSid, 'contact_name_offer');
        nameOffer(twiml);
      } else {
        await updateSession(callSid, 'contact_phone_entry');
        contactPhoneEntry(twiml);
      }
      break;
    }

    // ----- Name entry via keypad (multi-tap, like an old phone) -----

    case 'contact_name_offer': {
      if (digits === '1') {
        await updateSession(callSid, 'contact_name_entry_key', { name_buffer: '', name_current_key: null, name_cycle_count: 0 });
        nameEntryPrompt(twiml);
      } else {
        await updateSession(callSid, 'contact_method_select');
        methodSelect(twiml);
      }
      break;
    }

    case 'contact_name_entry_key': {
      if (!digits) {
        // Gather timed out with no key pressed — just re-prompt, no state change.
        const k = session.data.name_current_key;
        const currentLetter = k ? KEY_LETTERS[k][(session.data.name_cycle_count - 1) % KEY_LETTERS[k].length] : '';
        gatherSingleKey(
          twiml,
          `${BASE_URL}/voice/handle`,
          currentLetter
            ? `Current letter ${currentLetter}. Press another key, star to erase, 0 for space, or pound to finish.`
            : 'Press a key to continue, or pound to finish.'
        );
        break;
      }
      const result = processNameDigit(session.data, digits);
      if (result.finished) {
        const finalName = result.data.name_buffer.trim();
        await updateSession(callSid, 'contact_method_select', { pending_name: finalName || null });
        twiml.say(finalName ? `Name saved as ${finalName.split('').join(' ')}.` : 'No name entered.', SAY_OPTS);
        methodSelect(twiml);
      } else {
        await updateSession(callSid, 'contact_name_entry_key', result.data);
        gatherSingleKey(twiml, `${BASE_URL}/voice/handle`, result.feedback || undefined);
      }
      break;
    }

    case 'contact_method_select': {
      const methodMap = { '1': 'sms', '2': 'call', '3': 'voice_note' };
      const method = methodMap[digits];
      if (method) {
        await updateSession(callSid, 'contact_group_offer', { pending_method: method });
        groupOffer(twiml);
      } else {
        methodSelect(twiml, true);
      }
      break;
    }

    case 'contact_group_offer': {
      if (digits === '1') {
        const groups = await pool.query('SELECT id, name FROM groups ORDER BY id');
        await updateSession(callSid, 'contact_group_list', { group_page: groups.rows });
        groupList(twiml, groups.rows);
      } else {
        await saveContact(callSid, twiml, null);
      }
      break;
    }

    case 'contact_group_list': {
      const groupRows = session.data.group_page || [];
      if (digits === '9') {
        await updateSession(callSid, 'contact_group_new_record');
        newGroupRecordPrompt(twiml);
      } else if (digits === '0') {
        await saveContact(callSid, twiml, null);
      } else {
        const idx = parseInt(digits, 10) - 1;
        const group = groupRows[idx];
        if (group) {
          await saveContact(callSid, twiml, group.id);
        } else {
          groupList(twiml, groupRows, true);
        }
      }
      break;
    }

    case 'contact_group_new_record': {
      if (recordingUrl) {
        const { rows } = await pool.query(
          `INSERT INTO groups (name, source, audio_label_url) VALUES ($1, 'phone_placeholder', $2) RETURNING id`,
          [`New group`, recordingUrl]
        );
        await saveContact(callSid, twiml, rows[0].id);
      } else {
        newGroupRecordPrompt(twiml);
      }
      break;
    }

    case 'contact_saved_next': {
      if (digits === '1') {
        await updateSession(callSid, 'contact_phone_entry');
        contactPhoneEntry(twiml);
      } else {
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
      }
      break;
    }

    // ----- Branch 5: send a broadcast -----

    case 'broadcast_message_select': {
      const messages = session.data.broadcast_messages || [];
      if (digits === '0') {
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
      } else {
        const idx = parseInt(digits, 10) - 1;
        const message = messages[idx];
        if (message) {
          await updateSession(callSid, 'broadcast_target_select', { broadcast_message_id: message.id, broadcast_message_title: message.title });
          broadcastTargetPrompt(twiml);
        } else {
          broadcastMessageList(twiml, messages, true);
        }
      }
      break;
    }

    case 'broadcast_target_select': {
      if (digits === '1') {
        await updateSession(callSid, 'broadcast_contact_phone_entry');
        broadcastContactPhoneEntry(twiml);
      } else if (digits === '2') {
        const groups = await pool.query('SELECT id, name FROM groups ORDER BY id');
        if (!groups.rows.length) {
          twiml.say('You have no groups yet.', SAY_OPTS);
          broadcastTargetPrompt(twiml);
        } else {
          await updateSession(callSid, 'broadcast_group_pick', { group_page: groups.rows });
          broadcastGroupList(twiml, groups.rows);
        }
      } else if (digits === '3') {
        await updateSession(callSid, 'broadcast_confirm', { broadcast_target: 'all' });
        await broadcastConfirmPrompt(callSid, twiml);
      } else {
        broadcastTargetPrompt(twiml, true);
      }
      break;
    }

    case 'broadcast_contact_phone_entry': {
      if (digits && digits.length >= 10) {
        const { rows } = await pool.query('SELECT id, name FROM contacts WHERE phone_number = $1', [digits]);
        if (rows.length) {
          await updateSession(callSid, 'broadcast_confirm', {
            broadcast_target: 'contact', broadcast_contact_id: rows[0].id, broadcast_contact_name: rows[0].name,
          });
          await broadcastConfirmPrompt(callSid, twiml);
        } else {
          broadcastContactPhoneEntry(twiml, true);
        }
      } else {
        broadcastContactPhoneEntry(twiml, true);
      }
      break;
    }

    case 'broadcast_group_pick': {
      const groupRows = session.data.group_page || [];
      if (digits === '0') {
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
      } else {
        const idx = parseInt(digits, 10) - 1;
        const group = groupRows[idx];
        if (group) {
          await updateSession(callSid, 'broadcast_confirm', {
            broadcast_target: 'group', broadcast_group_id: group.id, broadcast_group_name: group.name,
          });
          await broadcastConfirmPrompt(callSid, twiml);
        } else {
          broadcastGroupList(twiml, groupRows, true);
        }
      }
      break;
    }

    case 'broadcast_confirm': {
      if (digits === '1') {
        await executeBroadcast(callSid, twiml);
      } else {
        twiml.say('Cancelled.', SAY_OPTS);
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
      }
      break;
    }

    // ----- Branch 6: assign an existing contact to a group -----

    case 'assign_group_phone_entry': {
      if (digits && digits.length >= 10) {
        const { rows } = await pool.query('SELECT id, name FROM contacts WHERE phone_number = $1', [digits]);
        if (rows.length) {
          const groups = await pool.query('SELECT id, name FROM groups ORDER BY id');
          if (!groups.rows.length) {
            twiml.say('You have no groups yet. Create one first from the web portal, or by adding a new contact by phone.', SAY_OPTS);
            await updateSession(callSid, 'main_menu');
            mainMenu(twiml);
          } else {
            await updateSession(callSid, 'assign_group_select', { assign_contact_id: rows[0].id, group_page: groups.rows });
            twiml.say(`Found ${rows[0].name || 'that contact'}.`, SAY_OPTS);
            broadcastGroupList(twiml, groups.rows);
          }
        } else {
          twiml.say('No contact found with that number.', SAY_OPTS);
          assignGroupPhoneEntry(twiml);
        }
      } else {
        assignGroupPhoneEntry(twiml, true);
      }
      break;
    }

    case 'assign_group_select': {
      const groupRows = session.data.group_page || [];
      if (digits === '0') {
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
      } else {
        const idx = parseInt(digits, 10) - 1;
        const group = groupRows[idx];
        if (group) {
          await pool.query(
            `INSERT INTO contact_groups (contact_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [session.data.assign_contact_id, group.id]
          );
          twiml.say(`Added to ${group.name}.`, SAY_OPTS);
          await updateSession(callSid, 'main_menu');
          mainMenu(twiml);
        } else {
          broadcastGroupList(twiml, groupRows, true);
        }
      }
      break;
    }

    default: {
      say(twiml, 'Something went wrong. Returning to the main menu.');
      await updateSession(callSid, 'main_menu');
      mainMenu(twiml);
    }
  }

  res.type('text/xml').send(twiml.toString());
});

// Handles the case where <Gather> times out with no input - just repeats current prompt
router.post('/repeat', async (req, res) => {
  const callSid = req.body.CallSid;
  const session = await getSession(callSid);
  const twiml = livelyVoice(new VoiceResponse());
  // simplest approach: send caller back through /handle with no digits, which
  // re-prompts for most steps. Recording steps rely on Twilio's own timeout instead.
  twiml.redirect(`${BASE_URL}/voice/handle`);
  res.type('text/xml').send(twiml.toString());
});

// ---------- step prompt functions ----------

function mainMenu(twiml, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}Main menu. ` +
    `Press 1 to record a new message. ` +
    `Press 2 to review your saved messages. ` +
    `Press 3 to add a contact. ` +
    `Press 4 to change your PIN. ` +
    `Press 5 to hear your account status. ` +
    `Press 6 to send a message. ` +
    `Press 7 to assign a contact to a group.`
  );
}

function recordPrompt(twiml) {
  twiml.say('Record your message after the beep. Press pound when finished.', SAY_OPTS);
  twiml.record({
    action: `${BASE_URL}/voice/handle`,
    method: 'POST',
    finishOnKey: '#',
    maxLength: 120,
    playBeep: true,
  });
}

function recordReviewPrompt(twiml, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}Press 1 to save this message. Press 2 to hear it back. Press 3 to re-record. Press 4 to cancel.`,
    { numDigits: 1 }
  );
}

async function startReview(callSid, twiml) {
  const { rows } = await pool.query(`SELECT id FROM messages ORDER BY created_at DESC`);
  if (!rows.length) {
    twiml.say('You have no saved messages.', SAY_OPTS);
    await updateSession(callSid, 'main_menu');
    mainMenu(twiml);
    return;
  }
  const ids = rows.map(r => r.id);
  await updateSession(callSid, 'review_list', { message_ids: ids, review_index: 0 });
  twiml.say(`You have ${ids.length} saved messages.`, SAY_OPTS);
  await playReviewMessage(twiml, ids[0], 0, ids.length);
}

async function playReviewMessage(twiml, messageId, index, total) {
  const { rows } = await pool.query('SELECT * FROM messages WHERE id = $1', [messageId]);
  const msg = rows[0];
  const gather = livelyVoice(twiml.gather({
    numDigits: 1,
    action: `${BASE_URL}/voice/handle`,
    method: 'POST',
    timeout: 8,
  }));
  gather.say(`Message ${index + 1} of ${total}.`, SAY_OPTS);
  if (msg.audio_url) gather.play(msg.audio_url);
  gather.say('Press 1 to keep, press 2 to delete, press pound for the next message, press 0 to return to the main menu.', SAY_OPTS);
  twiml.redirect(`${BASE_URL}/voice/repeat`);
}

function pinChangeEntry(twiml, retry = false) {
  const prefix = retry ? "That PIN needs to be 4 to 8 digits. " : '';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}Enter your new PIN, 4 to 8 digits, followed by the pound sign.`,
    { finishOnKey: '#' }
  );
}

function confirmNewPin(twiml, digits) {
  const spaced = digits.split('').join(' ');
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `You entered ${spaced}. Press 1 to confirm, press 2 to re-enter.`,
    { numDigits: 1 }
  );
}

async function announceStatus(twiml) {
  const [contactsRes, groupsRes, messagesRes, sentTodayRes] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM contacts'),
    pool.query('SELECT COUNT(*) FROM groups'),
    pool.query('SELECT COUNT(*) FROM messages'),
    pool.query(`SELECT COUNT(*) FROM sends WHERE sent_at::date = CURRENT_DATE`),
  ]);
  const contactCount = contactsRes.rows[0].count;
  const groupCount = groupsRes.rows[0].count;
  const messageCount = messagesRes.rows[0].count;
  const sentToday = sentTodayRes.rows[0].count;

  twiml.say(
    `You have ${contactCount} contact${contactCount === '1' ? '' : 's'}, ` +
    `${groupCount} group${groupCount === '1' ? '' : 's'}, and ` +
    `${messageCount} saved message${messageCount === '1' ? '' : 's'}. ` +
    `${sentToday} message${sentToday === '1' ? '' : 's'} sent today.`
  , SAY_OPTS);
  mainMenu(twiml);
}

function gatherSingleKey(twiml, action, prompt) {
  const gather = livelyVoice(twiml.gather({ numDigits: 1, finishOnKey: '', action, method: 'POST', timeout: 5 }));
  if (prompt) gather.say(prompt, SAY_OPTS);
  twiml.redirect(action.replace('/handle', '/repeat'));
  return twiml;
}

function nameOffer(twiml) {
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    'Press 1 to enter a name using the keypad, or press 2 to skip.',
    { numDigits: 1 }
  );
}

function nameEntryPrompt(twiml) {
  twiml.say(
    'Spell the name using your keypad, like an old phone. ' +
    'Press a number key one or more times to choose a letter. ' +
    'Press a different key to move to the next letter. ' +
    'Press star to erase, 0 for space, and pound when you are finished.'
  , SAY_OPTS);
  gatherSingleKey(twiml, `${BASE_URL}/voice/handle`, 'Go ahead.');
}

// Processes one keypress in the multi-tap name entry flow.
// Returns { data: updatedSessionData, feedback: string to speak, finished: bool }
function processNameDigit(data, digit) {
  let name_buffer = data.name_buffer || '';
  let name_current_key = data.name_current_key || null;
  let name_cycle_count = data.name_cycle_count || 0;
  let feedback = '';
  let finished = false;

  function commitPending() {
    if (name_current_key && KEY_LETTERS[name_current_key]) {
      const letters = KEY_LETTERS[name_current_key];
      name_buffer += letters[(name_cycle_count - 1) % letters.length];
    }
    name_current_key = null;
    name_cycle_count = 0;
  }

  if (digit === '#') {
    commitPending();
    finished = true;
  } else if (digit === '*') {
    if (name_current_key) {
      name_current_key = null;
      name_cycle_count = 0;
      feedback = 'Cleared.';
    } else if (name_buffer.length) {
      name_buffer = name_buffer.slice(0, -1);
      feedback = 'Erased.';
    }
  } else if (digit === '0') {
    commitPending();
    name_buffer += ' ';
    feedback = 'Space.';
  } else if (digit === '1') {
    // no letters on 1 — ignored
  } else if (KEY_LETTERS[digit]) {
    if (digit === name_current_key) {
      name_cycle_count += 1;
    } else {
      commitPending();
      name_current_key = digit;
      name_cycle_count = 1;
    }
    const letters = KEY_LETTERS[digit];
    feedback = letters[(name_cycle_count - 1) % letters.length];
  }

  return { data: { name_buffer, name_current_key, name_cycle_count }, feedback, finished };
}

function contactPhoneEntry(twiml, retry = false) {
  const prefix = retry ? "That didn't look like a valid number. " : '';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}Enter the phone number followed by the pound sign.`,
    { finishOnKey: '#' }
  );
}

function confirmPhone(twiml, digits) {
  const spaced = digits.split('').join(' ');
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `You entered ${spaced}. Press 1 to confirm, press 2 to re-enter.`,
    { numDigits: 1 }
  );
}

function methodSelect(twiml, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}Press 1 for text message. Press 2 for phone call. Press 3 for voice note.`,
    { numDigits: 1 }
  );
}

function groupOffer(twiml) {
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    'Press 1 to assign this contact to a group, or press 2 to skip.',
    { numDigits: 1 }
  );
}

function groupList(twiml, groups, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  const names = groups.map((g, i) => `Group ${i + 1} is ${g.name}.`).join(' ');
  const namesPart = groups.length ? names + ' ' : 'You have no groups yet. ';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}${namesPart}Press the group number, or press 9 to create a new group, or press 0 to skip.`
  );
}

function newGroupRecordPrompt(twiml) {
  twiml.say("Record the new group's name after the beep, then press pound.", SAY_OPTS);
  twiml.record({
    action: `${BASE_URL}/voice/handle`,
    method: 'POST',
    finishOnKey: '#',
    maxLength: 15,
    playBeep: true,
  });
}

async function saveContact(callSid, twiml, groupId) {
  const session = await getSession(callSid);
  const phone = session.data.pending_phone;
  const method = session.data.pending_method;
  const name = session.data.pending_name || null;

  const { rows } = await pool.query(
    `INSERT INTO contacts (phone_number, preferred_method, name) VALUES ($1, $2, $3)
     ON CONFLICT (phone_number) DO UPDATE SET preferred_method = $2, name = COALESCE($3, contacts.name)
     RETURNING id`,
    [phone, method, name]
  );
  const contactId = rows[0].id;

  if (groupId) {
    await pool.query(
      `INSERT INTO contact_groups (contact_id, group_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [contactId, groupId]
    );
  }

  await updateSession(callSid, 'contact_saved_next');
  twiml.say('Contact saved.', SAY_OPTS);
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    'Press 1 to add another contact, press 2 to return to the main menu.',
    { numDigits: 1 }
  );
}

// ---------- send-a-broadcast helpers ----------

async function startBroadcastMessageSelect(callSid, twiml) {
  const { rows } = await pool.query('SELECT id, title, type FROM messages ORDER BY created_at DESC LIMIT 9');
  if (!rows.length) {
    twiml.say('You have no saved messages to send.', SAY_OPTS);
    await updateSession(callSid, 'main_menu');
    mainMenu(twiml);
    return;
  }
  await updateSession(callSid, 'broadcast_message_select', { broadcast_messages: rows });
  broadcastMessageList(twiml, rows);
}

function broadcastMessageList(twiml, messages, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  const list = messages.map((m, i) => `Message ${i + 1}: ${m.title || 'Untitled'}.`).join(' ');
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, `${prefix}${list} Press the message number, or 0 to cancel.`);
}

function broadcastTargetPrompt(twiml, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}Press 1 to send to one contact. Press 2 to send to a group. Press 3 to send to everyone.`,
    { numDigits: 1 }
  );
}

function broadcastContactPhoneEntry(twiml, retry = false) {
  const prefix = retry ? "No contact found with that number, or that wasn't valid. " : '';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}Enter the contact's phone number followed by the pound sign.`,
    { finishOnKey: '#' }
  );
}

function broadcastGroupList(twiml, groups, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  const names = groups.map((g, i) => `Group ${i + 1} is ${g.name}.`).join(' ');
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, `${prefix}${names} Press the group number, or 0 to cancel.`);
}

async function broadcastConfirmPrompt(callSid, twiml) {
  const session = await getSession(callSid);
  const target = session.data.broadcast_target;
  let targetDesc = '';

  if (target === 'contact') {
    targetDesc = session.data.broadcast_contact_name || 'that contact';
  } else if (target === 'group') {
    const { rows } = await pool.query('SELECT COUNT(*) FROM contact_groups WHERE group_id = $1', [session.data.broadcast_group_id]);
    const count = parseInt(rows[0].count, 10);
    targetDesc = `the group ${session.data.broadcast_group_name}, ${count} contact${count === 1 ? '' : 's'}`;
  } else {
    const { rows } = await pool.query('SELECT COUNT(*) FROM contacts');
    const count = parseInt(rows[0].count, 10);
    targetDesc = `everyone, ${count} contact${count === 1 ? '' : 's'}`;
  }

  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `You are about to send ${session.data.broadcast_message_title || 'this message'} to ${targetDesc}. Press 1 to send now, press 2 to cancel.`,
    { numDigits: 1 }
  );
}

async function executeBroadcast(callSid, twiml) {
  const session = await getSession(callSid);
  const { broadcast_message_id, broadcast_target, broadcast_contact_id, broadcast_group_id } = session.data;

  let contactIds = [];
  if (broadcast_target === 'contact') {
    contactIds = [broadcast_contact_id];
  } else if (broadcast_target === 'group') {
    const { rows } = await pool.query('SELECT contact_id FROM contact_groups WHERE group_id = $1', [broadcast_group_id]);
    contactIds = rows.map((r) => r.contact_id);
  } else {
    const { rows } = await pool.query('SELECT id FROM contacts');
    contactIds = rows.map((r) => r.id);
  }

  if (!contactIds.length) {
    twiml.say('No recipients found.', SAY_OPTS);
  } else {
    const recipients = contactIds.map((id) => ({ contact_id: id })); // uses each contact's own default method
    try {
      const result = await createSendBatch({ message_id: broadcast_message_id, recipients });
      twiml.say(`Sent to ${result.count} recipient${result.count === 1 ? '' : 's'}.`, SAY_OPTS);
    } catch (err) {
      console.error('IVR broadcast error:', err);
      twiml.say('Something went wrong sending the message.', SAY_OPTS);
    }
  }
  await updateSession(callSid, 'main_menu');
  mainMenu(twiml);
}

// ---------- assign-existing-contact-to-group helper ----------

function assignGroupPhoneEntry(twiml, retry = false) {
  const prefix = retry ? "That didn't look like a valid number. " : '';
  gatherDigits(
    twiml,
    `${BASE_URL}/voice/handle`,
    `${prefix}Enter the contact's phone number followed by the pound sign.`,
    { finishOnKey: '#' }
  );
}

// Twilio posts here when a text is sent TO your Wonder Solutions number.
// If it's from your own configured phone, it's saved as a new Text message —
// the SMS equivalent of calling in and pressing 1 to record a voice note.
router.post('/sms-incoming', async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body;
  const MessagingResponse = twilio.twiml.MessagingResponse;
  const twiml = new MessagingResponse();

  try {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE key = 'owner_phone_number'`);
    const ownerPhone = rows.length ? rows[0].value : null;

    if (ownerPhone && from === ownerPhone && body && body.trim()) {
      await pool.query(
        `INSERT INTO messages (title, type, text_content) VALUES ($1, 'sms', $2)`,
        [`Texted in`, body.trim()]
      );
      twiml.message('Saved to Wonder Solutions as a new text message.');
    }
    // If it's not from the owner's number, respond with nothing — don't
    // acknowledge or process messages from anyone else.
  } catch (err) {
    console.error('sms-incoming error:', err);
  }

  res.type('text/xml').send(twiml.toString());
});

module.exports = router;
