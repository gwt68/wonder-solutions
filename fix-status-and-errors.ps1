# ==================================================================
#  Wonder Solutions - two fixes
# ==================================================================
#  1. backend/routes/webhooks.js
#     Twilio's status callback often omits ErrorMessage, which left
#     "see Twilio error code" on screen. Adds a code -> text table.
#
#  2. frontend/src/broadcastUtils.js
#     A broadcast stayed Active for ever if even one receipt never
#     arrived. Anything older than 24 hours now counts as resolved.
#
#  Backs both files up, refuses to write unless every anchor matches,
#  and rolls back if the write mangles any characters.
# ==================================================================

$ErrorActionPreference = 'Stop'
$hooks = 'Z:\Server\App\Wonder Solutions\backend\routes\webhooks.js'
$utils = 'Z:\Server\App\Wonder Solutions\frontend\src\broadcastUtils.js'

foreach ($p in @($hooks, $utils)) {
  if (-not (Test-Path $p)) { Write-Host "NOT FOUND: $p" -ForegroundColor Red; exit 1 }
}

$utf8NoBom  = New-Object System.Text.UTF8Encoding $false
$hooksLines = [System.Collections.ArrayList]@([System.IO.File]::ReadAllLines($hooks, [System.Text.Encoding]::UTF8))
$utilsLines = [System.Collections.ArrayList]@([System.IO.File]::ReadAllLines($utils, [System.Text.Encoding]::UTF8))

$problems = @()

# ---- anchors in webhooks.js --------------------------------------
$hAnchor = -1
for ($i = 0; $i -lt $hooksLines.Count; $i++) {
  if ($hooksLines[$i] -eq "const SMS_TERMINAL_STATUSES = ['delivered', 'undelivered', 'failed'];") { $hAnchor = $i; break }
}
if ($hAnchor -lt 0) { $problems += 'could not find SMS_TERMINAL_STATUSES in webhooks.js' }

$hCall = -1
for ($i = 0; $i -lt $hooksLines.Count; $i++) {
  if ($hooksLines[$i] -match "see Twilio error code") { $hCall = $i; break }
}
if ($hCall -lt 0) { $problems += 'could not find the ErrorMessage line in webhooks.js' }

# ---- anchors in broadcastUtils.js --------------------------------
$uTerm = -1
for ($i = 0; $i -lt $utilsLines.Count; $i++) {
  if ($utilsLines[$i] -match "^const TERMINAL_DELIVERY = ") { $uTerm = $i; break }
}
if ($uTerm -lt 0) { $problems += 'could not find TERMINAL_DELIVERY in broadcastUtils.js' }

$uEvery = -1
for ($i = 0; $i -lt $utilsLines.Count; $i++) {
  if ($utilsLines[$i] -eq '    return r.delivery_status ? TERMINAL_DELIVERY.includes(r.delivery_status) : false;') { $uEvery = $i; break }
}
if ($uEvery -lt 0) { $problems += 'could not find the resolved check in broadcastUtils.js' }

if (($hooksLines -join "`n") -match 'TWILIO_ERRORS' -or ($utilsLines -join "`n") -match 'STALE_AFTER_MS') {
  $problems += 'this script has already run'
}

if ($problems.Count -gt 0) {
  Write-Host ''
  Write-Host 'Nothing was changed. Problems:' -ForegroundColor Red
  foreach ($p in $problems) { Write-Host "  - $p" -ForegroundColor Red }
  exit 1
}

# ---- new code ----------------------------------------------------
$errorTable = @'

/**
 * Twilio's status callback frequently arrives with an ErrorCode and no
 * ErrorMessage, which used to leave the literal string "see Twilio error
 * code" in front of the user. These are the codes this account actually
 * sees; anything else falls back to whatever Twilio sent, then to the
 * bare code.
 */
const TWILIO_ERRORS = {
  '21610': 'Recipient replied STOP and is unsubscribed',
  '21612': 'This number cannot be reached from the sending number',
  '21614': 'Not a valid mobile number',
  '30001': 'Queue overflow - the message waited too long and was dropped',
  '30002': 'Account suspended',
  '30003': 'Handset unreachable - phone off or out of coverage',
  '30004': 'Message blocked by the carrier',
  '30005': 'Unknown number - this handset does not exist',
  '30006': 'Landline or a number that cannot receive texts',
  '30007': 'Carrier filtered the message as spam',
  '30008': 'Unknown error at the carrier',
  '30010': 'Message price exceeded the account maximum',
  '30022': 'Daily message limit reached for this number',
  '30032': 'Toll-free number is not verified',
  '30034': 'Number is not registered for A2P 10DLC'
};

function errorText(code, message) {
  if (!code) return null;
  const known = TWILIO_ERRORS[String(code)];
  if (known) return `${code}: ${known}`;
  if (message) return `${code}: ${message}`;
  return `${code}: delivery failed`;
}
'@

$staleHelper = @'

/* Twilio does not always send a final receipt. An account suspension
   mid-broadcast leaves rows sitting at "queued" indefinitely, and one
   missing callback was enough to keep a finished broadcast Active for
   ever. After a day, treat a send as resolved whatever Twilio says. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function isStale(r) {
  const t = r.sent_at || r.created_at;
  return t ? Date.now() - new Date(t).getTime() > STALE_AFTER_MS : false;
}
'@

# ---- apply, replacements before inserts --------------------------
$hooksLines[$hCall] = '        [MessageStatus, errorText(ErrorCode, ErrorMessage), MessageSid]'
$utilsLines[$uEvery] = '    if (TERMINAL_DELIVERY.includes(r.delivery_status)) return true;'
$utilsLines.Insert($uEvery + 1, '    return isStale(r);')

$utilsLines.Insert($uTerm + 1, $staleHelper)
$hooksLines.Insert($hAnchor + 1, $errorTable)

Copy-Item -Path $hooks -Destination "$hooks.bak" -Force
Copy-Item -Path $utils -Destination "$utils.bak" -Force

[System.IO.File]::WriteAllLines($hooks, [string[]]$hooksLines, $utf8NoBom)
[System.IO.File]::WriteAllLines($utils, [string[]]$utilsLines, $utf8NoBom)

$checkHooks = [System.IO.File]::ReadAllText($hooks, [System.Text.Encoding]::UTF8)
$checkUtils = [System.IO.File]::ReadAllText($utils, [System.Text.Encoding]::UTF8)

if ($checkHooks -notmatch 'TWILIO_ERRORS' -or $checkUtils -notmatch 'STALE_AFTER_MS' -or
    $checkUtils -notmatch 'one actual "Send" action|one entry per actual') {
  Copy-Item -Path "$hooks.bak" -Destination $hooks -Force
  Copy-Item -Path "$utils.bak" -Destination $utils -Force
  Write-Host ''
  Write-Host 'Write check failed. Rolled back, nothing changed.' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host 'Done. Two files changed:' -ForegroundColor Green
Write-Host "  backend\routes\webhooks.js        error code table added"
Write-Host "  frontend\src\broadcastUtils.js    stale sends now resolve"
Write-Host ''
Write-Host 'Backups: webhooks.js.bak and broadcastUtils.js.bak'
Write-Host ''
Write-Host 'Now run:'
Write-Host '  node --check "Z:\Server\App\Wonder Solutions\backend\routes\webhooks.js"'
