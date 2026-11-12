# Wonder Solutions — Twilio → Telnyx migration map

Written 2026-11-10 from a scan of `Z:\Server\App\Wonder Solutions\backend`.
Nothing here is built yet. This is the survey, not the plan of record.

---

## The one thing that makes this tractable

`twilio.twiml.VoiceResponse` is a **pure XML builder**. It makes no API calls
and needs no credentials — it just produces TwiML strings. Telnyx's TeXML
reads the same XML.

So the entire IVR in `backend/routes/voice.js` (2,700+ lines of
`gatherDigits`, `livelyVoice`, menus, PIN gate, scheduler) can stay exactly
as written. Keep the `twilio` npm package installed purely as an XML
generator, point the Telnyx numbers at the same webhook URLs, and Telnyx
interprets the output.

That turns a rewrite into a swap of the API-calling parts only.

---

## Files, by how much work each needs

### 1. `backend/routes/sends.js` — EASY, half a day

The core send path. Lines 4–15 (`twilioClient()`), 32–74 (the SMS / MMS /
call branches), plus `twilio_sid` on the result object.

What changes:
- `twilio(sid, token)` → Telnyx client or plain `fetch` to their API
- `messagingServiceSid` → Telnyx **Messaging Profile ID** (same idea,
  different name)
- `result.sid` → Telnyx returns `data.id`
- Outbound call creation (line 61–74) → Telnyx Call Control or TeXML
  application

Everything downstream already stores whatever ID you hand it, so the
`twilio_sid` column keeps working unchanged.

### 2. `backend/routes/webhooks.js` — MEDIUM, a day

Status callbacks and price backfill. Lines 15–130.

What changes:
- Payload field names. Twilio posts `MessageSid`, `MessageStatus`,
  `ErrorCode`, `CallSid`, `CallStatus`, `CallDuration` as form-encoded.
  Telnyx posts **JSON** with a different shape (`data.payload.id`,
  `data.event_type`, etc.). The whole parse layer is rewritten.
- `server.js` line 20 (`express.urlencoded`) — Telnyx needs `express.json()`
  on these routes. Both can coexist.
- `client.messages(sid).fetch()` and `client.calls(sid).fetch()` for pricing
  → Telnyx returns cost **on the webhook itself** in most cases, which means
  `retryMissingCosts` (server.js line 46) may become unnecessary. Check
  before deleting it.

### 3. `backend/routes/users.js` — MEDIUM, a day

Per-user number provisioning. Lines 16–17, 48–74, 116–140, 195–200.

What changes:
- Number search and purchase API
- "Attach to Messaging Service" → "attach to Messaging Profile"
- `incomingPhoneNumbers(sid).remove()` → Telnyx number delete
- `twilio_phone_sid` column now holds a Telnyx number ID. Leave the column
  name alone — renaming buys nothing and risks a lot.

### 4. `backend/routes/groups.js` — MEDIUM, half a day

Same provisioning pattern for group numbers (lines 9–74), plus fetching a
recording with Basic auth at lines 321–327.

### 5. `backend/routes/messages.js` — SMALL, an hour

Lines 276–286 fetch recordings from Twilio with Basic auth. Telnyx stores
recordings differently and the auth header changes to a Bearer token.

Also lines 9+ — the `rejectUnplayableAudio` middleware. Telnyx's `<Play>`
supports a slightly different codec list than Twilio's. Re-check it.

### 6. `backend/routes/voice.js` — MOSTLY UNCHANGED, but see the risks

The TwiML generation stays. What changes:
- Line 100 and 2669 — outbound SMS via the Twilio client
- Line 2703 — `backfillCallInPrices()` fetching call prices
- Lines 2078–2102 — conference webhooks (different payload shape)
- Line 2538 — `MessagingResponse` for inbound SMS replies; TeXML equivalent

### 7. No change needed

- `backend/routes/settings.js` (lines 150–157) — reads a DB column only
- `backend/routes/account.js` (line 15) — same
- `backend/routes/debug.js`, `backfill_cost.js`, `diag.js` — throwaway
  diagnostics, port last or not at all

---

## Risks worth knowing before you commit

**The voice.** You chose `Polly.Stephen-Generative` deliberately and said it
sounded very good. Telnyx TeXML supports `<Say>` with a voice attribute, but
their voice catalogue and naming are their own. There may be no exact match.
Test this early — if the IVR comes back sounding like a robot, that's a real
loss for a product people listen to on the phone.

**Answering machine detection.** `sends.js` and the broadcast flow rely on
AMD with a 4-second timeout you tuned. Telnyx supports AMD but the parameter
names and behaviour differ. Expect to re-tune.

**Recording storage.** Twilio recording URLs are fetched with Basic auth and
appear in `messages.audio_url`, `conferences.recording_url`,
`group_numbers.audio_label_url`. Telnyx stores recordings elsewhere. Existing
rows will still point at Twilio URLs — **do not release the Twilio account
until you have either migrated those files or accepted losing them.**

**The shared Twilio account.** `MGabcff5681e5f67d8e5fa1b5b7e8c73f8` and
`+18452445728` are shared with the textmymail project. Moving Wonder
Solutions off Twilio does not move textmymail. Plan for both to coexist, and
don't change service-level settings to suit one.

**Number porting takes weeks.** `+18454569404` is known to your community —
people call it to hear messages. Port it rather than replace it, and expect
the port to take longer than you want.

---

## Suggested order

1. A2P brand + campaign registered and **approved** at Telnyx (blocks all)
2. Add a provider switch in `sends.js` behind an env var, defaulting to
   Twilio — nothing breaks while you build
3. Buy ONE Telnyx number. Point it at a TeXML application aimed at your
   existing `/voice` webhooks. Call it. Listen to the voice.
4. If the voice is acceptable, port one low-stakes user's number and run
   real traffic for a week
5. Port the rest a few at a time
6. Keep Twilio funded and alive for at least a month after the last port

---

## Rough effort

Code: four to six days of actual work, spread across weeks.
Calendar: dominated by A2P approval and number porting, not by code.
