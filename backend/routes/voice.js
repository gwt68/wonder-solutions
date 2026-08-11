const express = require('express');
const router = express.Router();
const twilio = require('twilio');
const { DateTime } = require('luxon');
const pool = require('../db/pool');
const { createSendBatch } = require('./sends');

const VoiceResponse = twilio.twiml.VoiceResponse;
const BASE_URL = process.env.BASE_URL;

const SAY_OPTS = { voice: 'Polly.Matthew-Neural' };

function livelyVoice(node) {
  const originalSay = node.say.bind(node);
  node.say = (text, opts = {}) => {
    const sayNode = originalSay({ ...SAY_OPTS, ...opts });
    sayNode.prosody({ rate: '112%' }, text);
    return sayNode;
  };
  return node;
}

const KEY_LETTERS = {
  '2': ['A', 'B', 'C'], '3': ['D', 'E', 'F'], '4': ['G', 'H', 'I'],
  '5': ['J', 'K', 'L'], '6': ['M', 'N', 'O'], '7': ['P', 'Q', 'R', 'S'],
  '8': ['T', 'U', 'V'], '9': ['W', 'X', 'Y', 'Z'],
};

async function getUserByCalledNumber(calledNumber) {
  const { rows } = await pool.query('SELECT * FROM users WHERE twilio_phone_number = $1', [calledNumber]);
  return rows[0] || null;
}

async function getSession(callSid) {
  const { rows } = await pool.query('SELECT * FROM call_sessions WHERE call_sid = $1', [callSid]);
  return rows[0] || null;
}

async function updateSession(callSid, step, dataPatch = {}, attempts = null) {
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

async function getPin(userId) {
  const { rows } = await pool.query('SELECT call_in_pin FROM users WHERE id = $1', [userId]);
  return rows[0]?.call_in_pin || '0000';
}

function gatherDigits(twiml, action, prompt, opts = {}) {
  const gather = livelyVoice(twiml.gather({
    numDigits: opts.numDigits, finishOnKey: opts.finishOnKey ?? '#',
    action, method: 'POST', timeout: opts.timeout ?? 8,
  }));
  gather.say(prompt, SAY_OPTS);
  twiml.redirect(action.replace('/handle', '/repeat'));
  return twiml;
}

// Gathers digits with no spoken prompt, optionally playing an audio clip
// that the caller can interrupt at any moment by pressing digits.
function silentPinGather(twiml, playUrl) {
  const gather = twiml.gather({
    finishOnKey: '#',
    action: `${BASE_URL}/voice/handle`,
    method: 'POST',
    timeout: 30,
  });
  if (playUrl) gather.play(playUrl);
  twiml.redirect(`${BASE_URL}/voice/repeat`);
  return twiml;
}

function say(twiml, text) {
  twiml.say(text, SAY_OPTS);
  return twiml;
}

async function getMatchingContactId(userId, callerNumber) {
  const { rows } = await pool.query(
    `SELECT id FROM contacts WHERE user_id = $2 AND regexp_replace(phone_number, '\\D', '', 'g') LIKE '%' || right(regexp_replace($1, '\\D', '', 'g'), 10)`,
    [callerNumber, userId]
  );
  return rows[0]?.id || null;
}

// Looks up the caller's own contact record and returns the audio URL for
// their most recent phone-based send, if any. Returns null if there's
// nothing on file for this caller.
async function getLastMessageAudioForCaller(userId, callerNumber) {
  const { rows: contactRows } = await pool.query(
    `SELECT id FROM contacts WHERE user_id = $2 AND regexp_replace(phone_number, '\\D', '', 'g') LIKE '%' || right(regexp_replace($1, '\\D', '', 'g'), 10)`,
    [callerNumber, userId]
  );
  if (!contactRows.length) return null;

  const { rows } = await pool.query(
    `SELECT m.id, m.audio_url, (m.audio_data IS NOT NULL) AS has_uploaded_audio
     FROM sends s JOIN messages m ON m.id = s.message_id
     WHERE s.contact_id = $1 AND s.method IN ('call', 'voice_note')
     ORDER BY s.sent_at DESC LIMIT 1`,
    [contactRows[0].id]
  );

  if (!rows.length || (!rows[0].audio_url && !rows[0].has_uploaded_audio)) return null;
  return { messageId: rows[0].id, url: `${BASE_URL}/api/messages/${rows[0].id}/audio` };
}

router.post('/incoming', async (req, res) => {
  const callSid = req.body.CallSid;
  const calledNumber = req.body.To;
  const callerNumber = req.body.From;
  const user = await getUserByCalledNumber(calledNumber);

  const twiml = livelyVoice(new VoiceResponse());

  if (!user) {
    say(twiml, 'This number is not configured. Goodbye.');
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }

  await clearSession(callSid);

  const { rows: trustedRows } = await pool.query(
    'SELECT 1 FROM trusted_phones WHERE phone_number = $1 AND user_id = $2', [callerNumber, user.id]
  );
  const isTrusted = trustedRows.length > 0;

  const matchedContactId = await getMatchingContactId(user.id, callerNumber);

  if (isTrusted) {
    await pool.query(
      `INSERT INTO call_ins (user_id, call_sid, from_phone_number, contact_id, is_trusted, reached)
       VALUES ($1, $2, $3, $4, TRUE, 'admin_menu')`,
      [user.id, callSid, callerNumber, matchedContactId]
    );
    await pool.query(
      `INSERT INTO call_sessions (call_sid, step, attempts, data, user_id) VALUES ($1, 'main_menu', 0, '{}', $2)`,
      [callSid, user.id]
    );
    mainMenu(twiml);
    return res.type('text/xml').send(twiml.toString());
  }

  const lastAudio = await getLastMessageAudioForCaller(user.id, callerNumber);

  await pool.query(
    `INSERT INTO call_ins (user_id, call_sid, from_phone_number, contact_id, is_trusted, played_message_id)
     VALUES ($1, $2, $3, $4, FALSE, $5)`,
    [user.id, callSid, callerNumber, matchedContactId, lastAudio ? lastAudio.messageId : null]
  );

  await pool.query(
    `INSERT INTO call_sessions (call_sid, step, attempts, data, user_id) VALUES ($1, 'pin_gate', 0, '{}', $2)`,
    [callSid, user.id]
  );

  silentPinGather(twiml, lastAudio ? lastAudio.url : null);

  res.type('text/xml').send(twiml.toString());
});

router.post('/handle', async (req, res) => {
  const callSid = req.body.CallSid;
  const digits = req.body.Digits;
  const recordingUrl = req.body.RecordingUrl ? `${req.body.RecordingUrl}.mp3` : null;
  const session = await getSession(callSid);
  const twiml = livelyVoice(new VoiceResponse());

  if (!session) {
    say(twiml, 'Your session has expired. Goodbye.');
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
  const userId = session.user_id;

  switch (session.step) {
    case 'pin_gate': {
      if (!digits) {
        silentPinGather(twiml, null);
        break;
      }
      const correctPin = await getPin(userId);
      if (digits === correctPin) {
        await pool.query(
          `UPDATE call_ins SET interrupted_with = 'pin', reached = 'admin_menu' WHERE call_sid = $1`,
          [callSid]
        );
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
        break;
      }
      const { rows: confRows } = await pool.query(
        `SELECT id FROM conferences WHERE access_code = $1 AND status != 'ended' AND user_id = $2`,
        [digits, userId]
      );
      if (confRows.length) {
        await pool.query(
          `UPDATE call_ins SET interrupted_with = 'conference_code', reached = 'conference' WHERE call_sid = $1`,
          [callSid]
        );
        joinConference(twiml, confRows[0].id);
        break;
      }
      silentPinGather(twiml, null);
      break;
    }

    case 'conference_created_join': {
      if (digits === '1') {
        joinConference(twiml, session.data.pending_conference_id);
      } else {
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
      }
      break;
    }

    case 'main_menu': {
      if (digits === '1') { await updateSession(callSid, 'record_prompt'); recordPrompt(twiml); }
      else if (digits === '2') { await startReview(callSid, twiml, userId); }
      else if (digits === '3') { await updateSession(callSid, 'contact_phone_entry'); contactPhoneEntry(twiml); }
      else if (digits === '4') { await updateSession(callSid, 'pin_change_entry'); pinChangeEntry(twiml); }
      else if (digits === '5') { await announceStatus(twiml, userId); }
      else if (digits === '6') { await startBroadcastCategorySelect(callSid, twiml); }
      else if (digits === '7') { await updateSession(callSid, 'assign_group_phone_entry'); assignGroupPhoneEntry(twiml); }
      else if (digits === '8') { await startConferenceCreate(callSid, twiml, userId); }
      else { mainMenu(twiml, true); }
      break;
    }

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
        await pool.query('UPDATE users SET call_in_pin = $1 WHERE id = $2', [session.data.pending_new_pin, userId]);
        await updateSession(callSid, 'main_menu');
        say(twiml, 'Your PIN has been updated.');
        mainMenu(twiml);
      } else {
        await updateSession(callSid, 'pin_change_entry');
        pinChangeEntry(twiml);
      }
      break;
    }

    case 'record_prompt': {
      if (recordingUrl) {
        await updateSession(callSid, 'record_review', { pending_recording_url: recordingUrl });
        recordReviewPrompt(twiml);
      } else {
        recordPrompt(twiml);
      }
      break;
    }

    case 'record_review': {
      if (digits === '1') {
        const { rows } = await pool.query(
          `INSERT INTO messages (title, type, audio_url, user_id) VALUES ($1, 'voice_note', $2, $3) RETURNING id`,
          [`Recorded by phone`, session.data.pending_recording_url, userId]
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

    case 'review_list': {
      const ids = session.data.message_ids || [];
      let index = session.data.review_index || 0;

      if (digits === '0') { await updateSession(callSid, 'main_menu'); mainMenu(twiml); break; }
      if (digits === '2') {
        const currentId = ids[index];
        await pool.query('DELETE FROM messages WHERE id = $1 AND user_id = $2', [currentId, userId]);
      }
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
      if (digits === '1') { await updateSession(callSid, 'contact_name_offer'); nameOffer(twiml); }
      else { await updateSession(callSid, 'contact_phone_entry'); contactPhoneEntry(twiml); }
      break;
    }

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
        const k = session.data.name_current_key;
        const currentLetter = k ? KEY_LETTERS[k][(session.data.name_cycle_count - 1) % KEY_LETTERS[k].length] : '';
        gatherSingleKey(twiml, `${BASE_URL}/voice/handle`,
          currentLetter
            ? `Current letter ${currentLetter}. Press another key, star to erase, 0 for space, or pound to finish.`
            : 'Press a key to continue, or pound to finish.');
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
      if (method) { await updateSession(callSid, 'contact_group_offer', { pending_method: method }); groupOffer(twiml); }
      else { methodSelect(twiml, true); }
      break;
    }

    case 'contact_group_offer': {
      if (digits === '1') {
        const groups = await pool.query('SELECT id, name FROM groups WHERE user_id = $1 ORDER BY id', [userId]);
        await updateSession(callSid, 'contact_group_list', { group_page: groups.rows });
        groupList(twiml, groups.rows);
      } else {
        await saveContact(callSid, twiml, null, userId);
      }
      break;
    }

    case 'contact_group_list': {
      const groupRows = session.data.group_page || [];
      if (digits === '9') { await updateSession(callSid, 'contact_group_new_record'); newGroupRecordPrompt(twiml); }
      else if (digits === '0') { await saveContact(callSid, twiml, null, userId); }
      else {
        const idx = parseInt(digits, 10) - 1;
        const group = groupRows[idx];
        if (group) await saveContact(callSid, twiml, group.id, userId);
        else groupList(twiml, groupRows, true);
      }
      break;
    }

    case 'contact_group_new_record': {
      if (recordingUrl) {
        const { rows } = await pool.query(
          `INSERT INTO groups (name, source, audio_label_url, user_id) VALUES ($1, 'phone_placeholder', $2, $3) RETURNING id`,
          [`New group`, recordingUrl, userId]
        );
        await saveContact(callSid, twiml, rows[0].id, userId);
      } else {
        newGroupRecordPrompt(twiml);
      }
      break;
    }

    case 'contact_saved_next': {
      if (digits === '1') { await updateSession(callSid, 'contact_phone_entry'); contactPhoneEntry(twiml); }
      else { await updateSession(callSid, 'main_menu'); mainMenu(twiml); }
      break;
    }

    case 'broadcast_category_select': {
      const types = BROADCAST_CATEGORY_TYPES[digits];
      if (types) await startBroadcastMessageSelect(callSid, twiml, types, userId);
      else broadcastCategoryPrompt(twiml, true);
      break;
    }

    case 'broadcast_message_select': {
      const messages = session.data.broadcast_messages || [];
      if (digits === '0') { await updateSession(callSid, 'main_menu'); mainMenu(twiml); break; }

      if (digits && digits.length === 1) {
        const idx = parseInt(digits, 10) - 1;
        const message = messages[idx];
        if (message) {
          await updateSession(callSid, 'broadcast_target_select', { broadcast_message_id: message.id, broadcast_message_title: message.title });
          broadcastTargetPrompt(twiml);
          break;
        }
      }

      if (digits) {
        const { rows } = await pool.query(
          'SELECT id, title FROM messages WHERE id = $1 AND user_id = $2', [parseInt(digits, 10), userId]
        );
        if (rows.length) {
          await updateSession(callSid, 'broadcast_target_select', { broadcast_message_id: rows[0].id, broadcast_message_title: rows[0].title });
          broadcastTargetPrompt(twiml);
          break;
        }
      }

      broadcastMessageList(twiml, messages, true);
      break;
    }

    case 'broadcast_target_select': {
      if (digits === '1') { await updateSession(callSid, 'broadcast_contact_phone_entry'); broadcastContactPhoneEntry(twiml); }
      else if (digits === '2') {
        const groups = await pool.query('SELECT id, name FROM groups WHERE user_id = $1 ORDER BY id', [userId]);
        if (!groups.rows.length) { twiml.say('You have no groups yet.', SAY_OPTS); broadcastTargetPrompt(twiml); }
        else { await updateSession(callSid, 'broadcast_group_pick', { group_page: groups.rows }); broadcastGroupList(twiml, groups.rows); }
      } else if (digits === '3') {
        await updateSession(callSid, 'broadcast_confirm', { broadcast_target: 'all' });
        await broadcastConfirmPrompt(callSid, twiml, userId);
      } else {
        broadcastTargetPrompt(twiml, true);
      }
      break;
    }

    case 'broadcast_contact_phone_entry': {
      if (digits && digits.length >= 10) {
        const { rows } = await pool.query(
          'SELECT id, name FROM contacts WHERE phone_number = $1 AND user_id = $2', [digits, userId]
        );
        if (rows.length) {
          await updateSession(callSid, 'broadcast_confirm', {
            broadcast_target: 'contact', broadcast_contact_id: rows[0].id, broadcast_contact_name: rows[0].name,
          });
          await broadcastConfirmPrompt(callSid, twiml, userId);
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
      if (digits === '0') { await updateSession(callSid, 'main_menu'); mainMenu(twiml); }
      else {
        const idx = parseInt(digits, 10) - 1;
        const group = groupRows[idx];
        if (group) {
          await updateSession(callSid, 'broadcast_confirm', {
            broadcast_target: 'group', broadcast_group_id: group.id, broadcast_group_name: group.name,
          });
          await broadcastConfirmPrompt(callSid, twiml, userId);
        } else {
          broadcastGroupList(twiml, groupRows, true);
        }
      }
      break;
    }

    case 'broadcast_prefix_ask': {
      if (digits === '1' || digits === '2') {
        await updateSession(callSid, 'broadcast_confirm', { broadcast_include_prefix: digits === '1' });
        await broadcastConfirmPromptFinal(callSid, twiml, userId);
      } else {
        twiml.say(`Should this message start with "${session.data.broadcast_group_name}"? Press 1 for yes, press 2 for no.`, SAY_OPTS);
        gatherDigits(twiml, `${BASE_URL}/voice/handle`, '', { numDigits: 1 });
      }
      break;
    }

    case 'broadcast_confirm': {
      if (digits === '1') await executeBroadcast(callSid, twiml, userId);
      else {
        twiml.say('Cancelled.', SAY_OPTS);
        await updateSession(callSid, 'main_menu');
        mainMenu(twiml);
      }
      break;
    }

    case 'assign_group_phone_entry': {
      if (digits && digits.length >= 10) {
        const { rows } = await pool.query(
          'SELECT id, name FROM contacts WHERE phone_number = $1 AND user_id = $2', [digits, userId]
        );
        if (rows.length) {
          const groups = await pool.query('SELECT id, name FROM groups WHERE user_id = $1 ORDER BY id', [userId]);
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
      if (digits === '0') { await updateSession(callSid, 'main_menu'); mainMenu(twiml); }
      else {
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

router.post('/repeat', async (req, res) => {
  const twiml = livelyVoice(new VoiceResponse());
  twiml.redirect(`${BASE_URL}/voice/handle`);
  res.type('text/xml').send(twiml.toString());
});

function mainMenu(twiml, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  gatherDigits(twiml, `${BASE_URL}/voice/handle`,
    `${prefix}Main menu. Press 1 to record a new message. Press 2 to review your saved messages. ` +
    `Press 3 to add a contact. Press 4 to change your PIN. Press 5 to hear your account status. ` +
    `Press 6 to send a message. Press 7 to assign a contact to a group. Press 8 to start a conference call.`);
}

function recordPrompt(twiml) {
  twiml.say('Record your message after the beep. Press pound when finished.', SAY_OPTS);
  twiml.record({ action: `${BASE_URL}/voice/handle`, method: 'POST', finishOnKey: '#', maxLength: 120, playBeep: true });
}

function recordReviewPrompt(twiml, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  gatherDigits(twiml, `${BASE_URL}/voice/handle`,
    `${prefix}Press 1 to save this message. Press 2 to hear it back. Press 3 to re-record. Press 4 to cancel.`, { numDigits: 1 });
}

async function startReview(callSid, twiml, userId) {
  const { rows } = await pool.query('SELECT id FROM messages WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
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
  const gather = livelyVoice(twiml.gather({ numDigits: 1, action: `${BASE_URL}/voice/handle`, method: 'POST', timeout: 8 }));
  gather.say(`Message ${index + 1} of ${total}.`, SAY_OPTS);
  if (msg.audio_url) gather.play(msg.audio_url);
  gather.say('Press 1 to keep, press 2 to delete, press pound for the next message, press 0 to return to the main menu.', SAY_OPTS);
  twiml.redirect(`${BASE_URL}/voice/repeat`);
}

function pinChangeEntry(twiml, retry = false) {
  const prefix = retry ? "That PIN needs to be 4 to 8 digits. " : '';
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, `${prefix}Enter your new PIN, 4 to 8 digits, followed by the pound sign.`, { finishOnKey: '#' });
}

function confirmNewPin(twiml, digits) {
  const spaced = digits.split('').join(' ');
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, `You entered ${spaced}. Press 1 to confirm, press 2 to re-enter.`, { numDigits: 1 });
}

async function announceStatus(twiml, userId) {
  const [contactsRes, groupsRes, messagesRes, sentTodayRes] = await Promise.all([
    pool.query('SELECT COUNT(*) FROM contacts WHERE user_id = $1', [userId]),
    pool.query('SELECT COUNT(*) FROM groups WHERE user_id = $1', [userId]),
    pool.query('SELECT COUNT(*) FROM messages WHERE user_id = $1', [userId]),
    pool.query(`SELECT COUNT(*) FROM sends WHERE user_id = $1 AND sent_at::date = CURRENT_DATE`, [userId]),
  ]);
  const contactCount = contactsRes.rows[0].count;
  const groupCount = groupsRes.rows[0].count;
  const messageCount = messagesRes.rows[0].count;
  const sentToday = sentTodayRes.rows[0].count;

  twiml.say(
    `You have ${contactCount} contact${contactCount === '1' ? '' : 's'}, ` +
    `${groupCount} group${groupCount === '1' ? '' : 's'}, and ` +
    `${messageCount} saved message${messageCount === '1' ? '' : 's'}. ` +
    `${sentToday} message${sentToday === '1' ? '' : 's'} sent today.`, SAY_OPTS);
  mainMenu(twiml);
}

function gatherSingleKey(twiml, action, prompt) {
  const gather = livelyVoice(twiml.gather({ numDigits: 1, finishOnKey: '', action, method: 'POST', timeout: 5 }));
  if (prompt) gather.say(prompt, SAY_OPTS);
  twiml.redirect(action.replace('/handle', '/repeat'));
  return twiml;
}

function nameOffer(twiml) {
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, 'Press 1 to enter a name using the keypad, or press 2 to skip.', { numDigits: 1 });
}

function nameEntryPrompt(twiml) {
  twiml.say(
    'Spell the name using your keypad, like an old phone. Press a number key one or more times to choose a letter. ' +
    'Press a different key to move to the next letter. Press star to erase, 0 for space, and pound when you are finished.', SAY_OPTS);
  gatherSingleKey(twiml, `${BASE_URL}/voice/handle`, 'Go ahead.');
}

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

  if (digit === '#') { commitPending(); finished = true; }
  else if (digit === '*') {
    if (name_current_key) { name_current_key = null; name_cycle_count = 0; feedback = 'Cleared.'; }
    else if (name_buffer.length) { name_buffer = name_buffer.slice(0, -1); feedback = 'Erased.'; }
  } else if (digit === '0') { commitPending(); name_buffer += ' '; feedback = 'Space.'; }
  else if (digit === '1') { /* no letters on 1 */ }
  else if (KEY_LETTERS[digit]) {
    if (digit === name_current_key) name_cycle_count += 1;
    else { commitPending(); name_current_key = digit; name_cycle_count = 1; }
    const letters = KEY_LETTERS[digit];
    feedback = letters[(name_cycle_count - 1) % letters.length];
  }

  return { data: { name_buffer, name_current_key, name_cycle_count }, feedback, finished };
}

function contactPhoneEntry(twiml, retry = false) {
  const prefix = retry ? "That didn't look like a valid number. " : '';
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, `${prefix}Enter the phone number followed by the pound sign.`, { finishOnKey: '#' });
}

function confirmPhone(twiml, digits) {
  const spaced = digits.split('').join(' ');
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, `You entered ${spaced}. Press 1 to confirm, press 2 to re-enter.`, { numDigits: 1 });
}

function methodSelect(twiml, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, `${prefix}Press 1 for text message. Press 2 for phone call. Press 3 for voice note.`, { numDigits: 1 });
}

function groupOffer(twiml) {
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, 'Press 1 to assign this contact to a group, or press 2 to skip.', { numDigits: 1 });
}

function groupList(twiml, groups, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  const names = groups.map((g, i) => `Group ${i + 1} is ${g.name}.`).join(' ');
  const namesPart = groups.length ? names + ' ' : 'You have no groups yet. ';
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, `${prefix}${namesPart}Press the group number, or press 9 to create a new group, or press 0 to skip.`);
}

function newGroupRecordPrompt(twiml) {
  twiml.say("Record the new group's name after the beep, then press pound.", SAY_OPTS);
  twiml.record({ action: `${BASE_URL}/voice/handle`, method: 'POST', finishOnKey: '#', maxLength: 15, playBeep: true });
}

async function saveContact(callSid, twiml, groupId, userId) {
  const session = await getSession(callSid);
  const phone = session.data.pending_phone;
  const method = session.data.pending_method;
  const name = session.data.pending_name || null;

  const { rows } = await pool.query(
    `INSERT INTO contacts (phone_number, preferred_method, name, user_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, phone_number) DO UPDATE SET preferred_method = $2, name = COALESCE($3, contacts.name)
     RETURNING id`,
    [phone, method, name, userId]
  );
  const contactId = rows[0].id;

  if (groupId) {
    await pool.query(
      `INSERT INTO contact_groups (contact_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [contactId, groupId]
    );
  }

  await updateSession(callSid, 'contact_saved_next');
  twiml.say('Contact saved.', SAY_OPTS);
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, 'Press 1 to add another contact, press 2 to return to the main menu.', { numDigits: 1 });
}

async function startBroadcastCategorySelect(callSid, twiml) {
  await updateSession(callSid, 'broadcast_category_select');
  broadcastCategoryPrompt(twiml);
}

function broadcastCategoryPrompt(twiml, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, `${prefix}Press 1 for texts. Press 2 for recordings. Press 3 for photos.`, { numDigits: 1 });
}

const BROADCAST_CATEGORY_TYPES = { '1': ['sms'], '2': ['voice_note', 'call'], '3': ['image'] };

async function startBroadcastMessageSelect(callSid, twiml, types, userId) {
  const { rows } = await pool.query(
    'SELECT id, title, type FROM messages WHERE type = ANY($1::text[]) AND user_id = $2 ORDER BY created_at DESC LIMIT 9',
    [types, userId]
  );
  if (!rows.length) {
    twiml.say('You have no saved messages of that kind yet.', SAY_OPTS);
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
  gatherDigits(twiml, `${BASE_URL}/voice/handle`,
    `${prefix}${list} Press the message number, or enter a message I D followed by pound to pick any saved message, or 0 to cancel.`,
    { finishOnKey: '#' });
}

function broadcastTargetPrompt(twiml, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, `${prefix}Press 1 to send to one contact. Press 2 to send to a group. Press 3 to send to everyone.`, { numDigits: 1 });
}

function broadcastContactPhoneEntry(twiml, retry = false) {
  const prefix = retry ? "No contact found with that number, or that wasn't valid. " : '';
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, `${prefix}Enter the contact's phone number followed by the pound sign.`, { finishOnKey: '#' });
}

function broadcastGroupList(twiml, groups, retry = false) {
  const prefix = retry ? "Sorry, I didn't get that. " : '';
  const names = groups.map((g, i) => `Group ${i + 1} is ${g.name}.`).join(' ');
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, `${prefix}${names} Press the group number, or 0 to cancel.`);
}

async function broadcastConfirmPrompt(callSid, twiml, userId) {
  const session = await getSession(callSid);
  const target = session.data.broadcast_target;
  let targetDesc = '';

  if (target === 'contact') {
    targetDesc = session.data.broadcast_contact_name || 'that contact';
  } else if (target === 'group') {
    const { rows } = await pool.query('SELECT COUNT(*) FROM contact_groups WHERE group_id = $1', [session.data.broadcast_group_id]);
    const count = parseInt(rows[0].count, 10);
    targetDesc = `the group ${session.data.broadcast_group_name}, ${count} contact${count === 1 ? '' : 's'}`;

    const prefixMode = await getGroupPrefixMode(userId);
    if (prefixMode === 'always') {
      await updateSession(callSid, 'broadcast_confirm', { broadcast_include_prefix: true });
    } else if (prefixMode === 'ask') {
      twiml.say(`Should this message start with "${session.data.broadcast_group_name}"?`, SAY_OPTS);
      gatherDigits(twiml, `${BASE_URL}/voice/handle`, 'Press 1 for yes, press 2 for no.', { numDigits: 1 });
      await updateSession(callSid, 'broadcast_prefix_ask');
      return;
    }
  } else {
    const { rows } = await pool.query('SELECT COUNT(*) FROM contacts WHERE user_id = $1', [userId]);
    const count = parseInt(rows[0].count, 10);
    targetDesc = `everyone, ${count} contact${count === 1 ? '' : 's'}`;
  }

  gatherDigits(twiml, `${BASE_URL}/voice/handle`,
    `You are about to send ${session.data.broadcast_message_title || 'this message'} to ${targetDesc}. Press 1 to send now, press 2 to cancel.`,
    { numDigits: 1 });
}

// Re-renders the "you're about to send X to Y" confirmation without the
// prefix-mode branching, used after the prefix-ask step has already run.
async function broadcastConfirmPromptFinal(callSid, twiml, userId) {
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
    const { rows } = await pool.query('SELECT COUNT(*) FROM contacts WHERE user_id = $1', [userId]);
    const count = parseInt(rows[0].count, 10);
    targetDesc = `everyone, ${count} contact${count === 1 ? '' : 's'}`;
  }

  gatherDigits(twiml, `${BASE_URL}/voice/handle`,
    `You are about to send ${session.data.broadcast_message_title || 'this message'} to ${targetDesc}. Press 1 to send now, press 2 to cancel.`,
    { numDigits: 1 });
}

async function executeBroadcast(callSid, twiml, userId) {
  const session = await getSession(callSid);
  const { broadcast_message_id, broadcast_target, broadcast_contact_id, broadcast_group_id, broadcast_group_name, broadcast_include_prefix } = session.data;

  let contactIds = [];
  if (broadcast_target === 'contact') {
    contactIds = [broadcast_contact_id];
  } else if (broadcast_target === 'group') {
    const { rows } = await pool.query('SELECT contact_id FROM contact_groups WHERE group_id = $1', [broadcast_group_id]);
    contactIds = rows.map((r) => r.contact_id);
  } else {
    const { rows } = await pool.query('SELECT id FROM contacts WHERE user_id = $1', [userId]);
    contactIds = rows.map((r) => r.id);
  }

  if (!contactIds.length) {
    twiml.say('No recipients found.', SAY_OPTS);
  } else {
    let effectiveMessageId = broadcast_message_id;
    if (broadcast_target === 'group' && broadcast_include_prefix && broadcast_group_name) {
      effectiveMessageId = await cloneMessageWithGroupPrefix(broadcast_message_id, broadcast_group_name, userId);
    }
    const recipients = contactIds.map((id) => ({ contact_id: id }));
    try {
      const result = await createSendBatch({ message_id: effectiveMessageId, recipients, userId });
      twiml.say(`Sent to ${result.count} recipient${result.count === 1 ? '' : 's'}.`, SAY_OPTS);
    } catch (err) {
      console.error('IVR broadcast error:', err);
      twiml.say('Something went wrong sending the message.', SAY_OPTS);
    }
  }
  await updateSession(callSid, 'main_menu');
  mainMenu(twiml);
}

function assignGroupPhoneEntry(twiml, retry = false) {
  const prefix = retry ? "That didn't look like a valid number. " : '';
  gatherDigits(twiml, `${BASE_URL}/voice/handle`, `${prefix}Enter the contact's phone number followed by the pound sign.`, { finishOnKey: '#' });
}

function conferenceRoomName(conferenceId) {
  return `wonder-conf-${conferenceId}`;
}

function joinConference(twiml, conferenceId) {
  say(twiml, 'Joining the conference now.');
  const dial = twiml.dial();
  dial.conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: false,
      record: 'record-from-start',
      recordingStatusCallback: `${BASE_URL}/voice/conference-recording`,
      statusCallback: `${BASE_URL}/voice/conference-status`,
      statusCallbackEvent: 'start end join leave',
    },
    conferenceRoomName(conferenceId)
  );
}

// Generates a random 6-digit code, retrying on the rare collision with an
// existing non-ended conference.
async function generateConferenceCode() {
  for (let i = 0; i < 5; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const { rows } = await pool.query(`SELECT 1 FROM conferences WHERE access_code = $1 AND status != 'ended'`, [code]);
    if (!rows.length) return code;
  }
  throw new Error('Could not generate a unique conference code');
}

async function startConferenceCreate(callSid, twiml, userId) {
  const code = await generateConferenceCode();
  const { rows } = await pool.query(
    `INSERT INTO conferences (user_id, access_code, status) VALUES ($1, $2, 'scheduled') RETURNING id`,
    [userId, code]
  );
  const conferenceId = rows[0].id;
  await updateSession(callSid, 'conference_created_join', { pending_conference_id: conferenceId });

  const spaced = code.split('').join(' ');
  gatherDigits(twiml, `${BASE_URL}/voice/handle`,
    `Your conference code is ${spaced}. Share this with participants — they can call this number and enter the code. ` +
    `Press 1 to join the conference now, or press 2 to return to the main menu.`,
    { numDigits: 1 });
}

// ---------- conference webhooks (Twilio -> us) ----------

router.post('/conference-status', async (req, res) => {
  const { StatusCallbackEvent, ConferenceSid, FriendlyName } = req.body;
  try {
    const match = /^wonder-conf-(\d+)$/.exec(FriendlyName || '');
    if (match) {
      const conferenceId = match[1];
      if (StatusCallbackEvent === 'conference-start') {
        await pool.query(`UPDATE conferences SET twilio_conference_sid = $1, status = 'active' WHERE id = $2`, [ConferenceSid, conferenceId]);
      } else if (StatusCallbackEvent === 'conference-end') {
        await pool.query(`UPDATE conferences SET status = 'ended' WHERE id = $1`, [conferenceId]);
      }
    }
  } catch (err) {
    console.error('conference-status webhook error:', err);
  }
  res.status(200).end();
});

router.post('/conference-recording', async (req, res) => {
  const { RecordingUrl, ConferenceSid } = req.body;
  try {
    if (RecordingUrl && ConferenceSid) {
      await pool.query(`UPDATE conferences SET recording_url = $1 WHERE twilio_conference_sid = $2`, [`${RecordingUrl}.mp3`, ConferenceSid]);
    }
  } catch (err) {
    console.error('conference-recording webhook error:', err);
  }
  res.status(200).end();
});

async function getUserTimezone(userId) {
  const { rows } = await pool.query('SELECT timezone FROM users WHERE id = $1', [userId]);
  return rows[0]?.timezone || 'America/New_York';
}

async function getGroupPrefixMode(userId) {
  const { rows } = await pool.query('SELECT group_prefix_mode FROM users WHERE id = $1', [userId]);
  return rows[0]?.group_prefix_mode || 'never';
}

// Parses "M/d h:mm AM/PM" (e.g. "8/10 3:00 PM") in the given IANA timezone,
// assuming the current year, rolling to next year if that date already passed.
function parseScheduleDateTime(input, zone) {
  const match = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(input.trim());
  if (!match) return null;
  const [, month, day, hour12raw, minute, ampm] = match;
  let hour = parseInt(hour12raw, 10) % 12;
  if (/pm/i.test(ampm)) hour += 12;

  const now = DateTime.now().setZone(zone);
  let dt = DateTime.fromObject(
    { year: now.year, month: parseInt(month, 10), day: parseInt(day, 10), hour, minute: parseInt(minute, 10) },
    { zone }
  );
  if (!dt.isValid) return null;
  if (dt < now) dt = dt.plus({ years: 1 });
  return dt;
}

// Creates a new message that reuses another message's audio/image, but with
// a group-name prefix added to its text — without altering the original.
async function cloneMessageWithGroupPrefix(messageId, groupName, userId) {
  const { rows } = await pool.query('SELECT title, text_content FROM messages WHERE id = $1', [messageId]);
  if (!rows.length) return messageId;
  const prefixed = `${groupName}: ${rows[0].text_content || ''}`.trim();
  const { rows: created } = await pool.query(
    `INSERT INTO messages (title, type, text_content, audio_data, audio_mime_type, image_data, image_mime_type, audio_url, user_id)
     SELECT title, type, $1, audio_data, audio_mime_type, image_data, image_mime_type, audio_url, $2
     FROM messages WHERE id = $3
     RETURNING id`,
    [prefixed, userId, messageId]
  );
  return created[0]?.id || messageId;
}

// ---------- #send SMS command flow ----------

async function clearSmsSendSession(userId, fromPhone) {
  await pool.query('DELETE FROM sms_send_sessions WHERE user_id = $1 AND from_phone_number = $2', [userId, fromPhone]);
}

async function updateSmsSendSession(userId, fromPhone, step, dataPatch) {
  const { rows } = await pool.query('SELECT data FROM sms_send_sessions WHERE user_id = $1 AND from_phone_number = $2', [userId, fromPhone]);
  const merged = { ...(rows[0]?.data || {}), ...dataPatch };
  await pool.query(
    `UPDATE sms_send_sessions SET step = $1, data = $2, updated_at = NOW() WHERE user_id = $3 AND from_phone_number = $4`,
    [step, JSON.stringify(merged), userId, fromPhone]
  );
  return merged;
}

function navFooter(isFirstStep) {
  return isFirstStep ? '\nReply CANCEL to stop.' : '\nReply BACK to go to the previous step, or CANCEL to stop.';
}

function targetTypePrompt(retry = false) {
  const prefix = retry ? "Sorry, reply with 1, 2, or 3.\n" : '';
  return `${prefix}Who do you want to send this to?\n1. All contacts\n2. Individual\n3. Groups${navFooter(true)}`;
}

function individualNumberPrompt(retry = false) {
  const prefix = retry ? "No contact found with that number. Try again, or reply with the full number including area code.\n" : '';
  return `${prefix}Enter the phone number to send to.${navFooter(false)}`;
}

function groupPickPrompt(groups, retry = false) {
  const prefix = retry ? "Sorry, reply with the number of the group.\n" : '';
  const list = groups.map((g, i) => `${i + 1}. ${g.name}`).join('\n');
  return `${prefix}Here are your groups, please select which to send this message to:\n${list}${navFooter(false)}`;
}

function methodPrompt(retry = false) {
  const prefix = retry ? "Sorry, reply with 1, 2, 3, or 4.\n" : '';
  return `${prefix}How would you like to send?\n1. Each contact's assigned method\n2. Call\n3. Text\n4. Voice note${navFooter(false)}`;
}

function schedulePrompt(retry = false) {
  const prefix = retry ? "Sorry, reply with 1 or 2.\n" : '';
  return `${prefix}Send now, or schedule for later?\n1. Send now\n2. Schedule${navFooter(false)}`;
}

function scheduleDatetimePrompt(retry = false) {
  const prefix = retry ? "Sorry, that date and time wasn't understood, or is in the past.\n" : '';
  return `${prefix}Reply with the date and time to send, in this format: month/day time, like 8/10 3:00 PM or 8/10 3:00 AM.${navFooter(false)}`;
}

// "target_detail" isn't a real step name on its own — it's either
// individual_number or group_pick depending on what was chosen. This maps
// the actual prior step so "back" from method_select lands in the right place.
function stepBefore(currentStep, data) {
  if (currentStep === 'individual_number' || currentStep === 'group_pick') return 'target_type';
  if (currentStep === 'group_prefix_confirm') return 'group_pick';
  if (currentStep === 'method_select') return data.prev_before_method || 'target_type';
  if (currentStep === 'schedule') return 'method_select';
  if (currentStep === 'schedule_datetime') return 'schedule';
  return null;
}

async function promptForStep(step, data, userId) {
  switch (step) {
    case 'target_type': return targetTypePrompt();
    case 'individual_number': return individualNumberPrompt();
    case 'group_pick': {
      const { rows: groups } = await pool.query('SELECT id, name FROM groups WHERE user_id = $1 ORDER BY id', [userId]);
      return groupPickPrompt(groups);
    }
    case 'group_prefix_confirm': return `Include "${data.group_name}:" at the start of the message?\n1. Yes\n2. No${navFooter(false)}`;
    case 'method_select': return methodPrompt();
    case 'schedule': return schedulePrompt();
    case 'schedule_datetime': return scheduleDatetimePrompt();
    default: return targetTypePrompt();
  }
}

async function handleSmsSendStep(session, body, userId, fromPhone) {
  const raw = body.trim();
  const lower = raw.toLowerCase();

  if (lower === 'cancel') {
    await clearSmsSendSession(userId, fromPhone);
    return 'Cancelled.';
  }

  if (lower === 'back') {
    const target = stepBefore(session.step, session.data);
    if (!target) return targetTypePrompt(); // already at the first step
    // Clear anything selected at or after the step we're returning to,
    // so re-choosing doesn't leave stale data behind.
    const clearedFields = {};
    if (target === 'target_type') Object.assign(clearedFields, { target: null, contact_id: null, group_id: null, method: null });
    if (target === 'method_select') Object.assign(clearedFields, { method: null });
    await updateSmsSendSession(userId, fromPhone, target, clearedFields);
    return await promptForStep(target, session.data, userId);
  }

  const digits = raw;

  switch (session.step) {
    case 'target_type': {
      if (digits === '1') {
        await updateSmsSendSession(userId, fromPhone, 'method_select', { target: 'all', prev_before_method: 'target_type' });
        return methodPrompt();
      }
      if (digits === '2') {
        await updateSmsSendSession(userId, fromPhone, 'individual_number', {});
        return individualNumberPrompt();
      }
      if (digits === '3') {
        const { rows: groups } = await pool.query('SELECT id, name FROM groups WHERE user_id = $1 ORDER BY id', [userId]);
        if (!groups.length) {
          await clearSmsSendSession(userId, fromPhone);
          return "You don't have any groups yet.";
        }
        await updateSmsSendSession(userId, fromPhone, 'group_pick', { group_page: groups });
        return groupPickPrompt(groups);
      }
      return targetTypePrompt(true);
    }

    case 'individual_number': {
      const { rows: contactRows } = await pool.query(
        'SELECT id, first_name, last_name, name FROM contacts WHERE user_id = $1 AND phone_number = $2', [userId, digits]
      );
      if (!contactRows.length) {
        return individualNumberPrompt(true);
      }
      await updateSmsSendSession(userId, fromPhone, 'method_select', { target: 'contact', contact_id: contactRows[0].id, prev_before_method: 'individual_number' });
      return methodPrompt();
    }

    case 'group_pick': {
      const idx = parseInt(digits, 10) - 1;
      const group = (session.data.group_page || [])[idx];
      if (!group) return groupPickPrompt(session.data.group_page || [], true);

      const prefixMode = await getGroupPrefixMode(userId);
      if (prefixMode === 'always') {
        await updateSmsSendSession(userId, fromPhone, 'method_select', {
          target: 'group', group_id: group.id, group_name: group.name,
          include_group_prefix: true, prev_before_method: 'group_pick',
        });
        return methodPrompt();
      }
      if (prefixMode === 'never') {
        await updateSmsSendSession(userId, fromPhone, 'method_select', {
          target: 'group', group_id: group.id, group_name: group.name,
          include_group_prefix: false, prev_before_method: 'group_pick',
        });
        return methodPrompt();
      }
      await updateSmsSendSession(userId, fromPhone, 'group_prefix_confirm', {
        target: 'group', group_id: group.id, group_name: group.name,
      });
      return `Include "${group.name}:" at the start of the message?\n1. Yes\n2. No${navFooter(false)}`;
    }

    case 'group_prefix_confirm': {
      if (digits === '1' || digits === '2') {
        await updateSmsSendSession(userId, fromPhone, 'method_select', {
          include_group_prefix: digits === '1', prev_before_method: 'group_pick',
        });
        return methodPrompt();
      }
      return `Sorry, reply with 1 or 2.\nInclude "${session.data.group_name}:" at the start of the message?\n1. Yes\n2. No${navFooter(false)}`;
    }

    case 'method_select': {
      const methodMap = { '1': 'assigned', '2': 'call', '3': 'sms', '4': 'voice_note' };
      const method = methodMap[digits];
      if (!method) return methodPrompt(true);
      await updateSmsSendSession(userId, fromPhone, 'schedule', { method });
      return schedulePrompt();
    }

    case 'schedule': {
      if (digits === '1') {
        return await executeSmsSend(session, userId, fromPhone, null);
      }
      if (digits === '2') {
        await updateSmsSendSession(userId, fromPhone, 'schedule_datetime', {});
        return scheduleDatetimePrompt();
      }
      return schedulePrompt(true);
    }

    case 'schedule_datetime': {
      const zone = await getUserTimezone(userId);
      const dt = parseScheduleDateTime(digits, zone);
      if (!dt) {
        return scheduleDatetimePrompt(true);
      }
      return await executeSmsSend(session, userId, fromPhone, dt.toJSDate());
    }

    default: {
      await clearSmsSendSession(userId, fromPhone);
      return "Something went wrong. Text #send to start again.";
    }
  }
}

async function executeSmsSend(session, userId, fromPhone, scheduledAt) {
  const { message_id, target, contact_id, group_id, group_name, include_group_prefix, method } = session.data;
  await clearSmsSendSession(userId, fromPhone);
  const zone = await getUserTimezone(userId);

  let contactIds = [];
  if (target === 'contact') {
    contactIds = [contact_id];
  } else if (target === 'group') {
    const { rows } = await pool.query('SELECT contact_id FROM contact_groups WHERE group_id = $1', [group_id]);
    contactIds = rows.map((r) => r.contact_id);
  } else {
    const { rows } = await pool.query('SELECT id FROM contacts WHERE user_id = $1', [userId]);
    contactIds = rows.map((r) => r.id);
  }

  if (!contactIds.length) return 'No recipients found for that selection.';

  let effectiveMessageId = message_id;
  if (target === 'group' && include_group_prefix && group_name) {
    effectiveMessageId = await cloneMessageWithGroupPrefix(message_id, group_name, userId);
  }

  const useSpecificMethod = method && method !== 'assigned';
  const recipients = contactIds.map((id) => useSpecificMethod ? { contact_id: id, methods: [method] } : { contact_id: id });
  try {
    const result = await createSendBatch({
      message_id: effectiveMessageId, recipients, userId,
      scheduled_at: scheduledAt ? scheduledAt.toISOString() : null,
    });
    if (scheduledAt) {
      const formatted = DateTime.fromJSDate(scheduledAt, { zone: 'utc' }).setZone(zone).toFormat('M/d/yyyy h:mm a');
      return `Scheduled for ${result.count} contact${result.count === 1 ? '' : 's'} at ${formatted}.`;
    }
    return `Message sent to ${result.count} contact${result.count === 1 ? '' : 's'}.`;
  } catch (err) {
    console.error('executeSmsSend error:', err);
    return 'Something went wrong sending the message.';
  }
}

router.post('/sms-incoming', async (req, res) => {
  const to = req.body.To;
  const from = req.body.From;
  const body = (req.body.Body || '').trim();
  const MessagingResponse = twilio.twiml.MessagingResponse;
  const twiml = new MessagingResponse();

  try {
    const user = await getUserByCalledNumber(to);
    if (user && body) {
      const { rows: trustedRows } = await pool.query(
        'SELECT 1 FROM trusted_phones WHERE phone_number = $1 AND user_id = $2', [from, user.id]
      );
      const isTrusted = trustedRows.length > 0;

      const { rows: sessionRows } = await pool.query(
        'SELECT * FROM sms_send_sessions WHERE user_id = $1 AND from_phone_number = $2', [user.id, from]
      );
      if (isTrusted && sessionRows.length) {
        const reply = await handleSmsSendStep(sessionRows[0], body, user.id, from);
        twiml.message(reply);
        return res.type('text/xml').send(twiml.toString());
      }

      if (isTrusted && /^#send\b/i.test(body)) {
        const cleanBody = body.replace(/^#send\b/i, '').trim();
        const { rows: msgRows } = await pool.query(
          `INSERT INTO messages (title, type, text_content, user_id) VALUES ($1, 'sms', $2, $3) RETURNING id`,
          [`Texted in`, cleanBody || '(no text)', user.id]
        );
        await pool.query(
          `INSERT INTO sms_send_sessions (user_id, from_phone_number, step, data)
           VALUES ($1, $2, 'target_type', $3)
           ON CONFLICT (user_id, from_phone_number) DO UPDATE SET step = $4, data = $5, updated_at = NOW()`,
          [user.id, from, JSON.stringify({ message_id: msgRows[0].id }), 'target_type', JSON.stringify({ message_id: msgRows[0].id })]
        );
        twiml.message(targetTypePrompt());
        return res.type('text/xml').send(twiml.toString());
      }

      if (isTrusted) {
        await pool.query(
          `INSERT INTO messages (title, type, text_content, user_id) VALUES ($1, 'sms', $2, $3)`,
          [`Texted in`, body, user.id]
        );
        twiml.message('Saved to Wonder Solutions as a new text message.');
      } else {
        const { rows: contactRows } = await pool.query(
          `SELECT id FROM contacts WHERE user_id = $2 AND regexp_replace(phone_number, '\\D', '', 'g') LIKE '%' || right(regexp_replace($1, '\\D', '', 'g'), 10)`,
          [from, user.id]
        );
        const contactId = contactRows[0]?.id || null;
        await pool.query(
          `INSERT INTO messages (title, type, text_content, user_id, is_reply, from_phone_number, reply_contact_id)
           VALUES ($1, 'sms', $2, $3, TRUE, $4, $5)`,
          [`Reply`, body, user.id, from, contactId]
        );
      }
    }
  } catch (err) {
    console.error('sms-incoming error:', err);
  }

  res.type('text/xml').send(twiml.toString());
});

router.post('/incoming-status', async (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  try {
    let cost = null;
    if (CallStatus === 'completed') {
      const { rows: callInRows } = await pool.query('SELECT user_id FROM call_ins WHERE call_sid = $1', [CallSid]);
      if (callInRows.length) {
        try {
          const client = twilio((process.env.TWILIO_ACCOUNT_SID || '').trim(), (process.env.TWILIO_AUTH_TOKEN || '').trim());
          const callResource = await client.calls(CallSid).fetch();
          cost = callResource.price ? Math.abs(parseFloat(callResource.price)) : null;
        } catch (fetchErr) {
          console.error('Could not fetch call-in price:', fetchErr.message);
        }
      }
    }
    await pool.query(
      `UPDATE call_ins SET status = $1, duration_seconds = $2, cost = COALESCE($3, cost), ended_at = NOW() WHERE call_sid = $4`,
      [CallStatus, CallDuration ? parseInt(CallDuration, 10) : null, cost, CallSid]
    );
  } catch (err) {
    console.error('incoming-status webhook error:', err);
  }
  res.status(200).end();
});

module.exports = router;