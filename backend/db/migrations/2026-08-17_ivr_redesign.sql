-- IVR redesign: PIN setup flow, per-number lockout, texted-back contact names

-- PIN nullable so first-time setup is detectable via IS NULL
ALTER TABLE users ALTER COLUMN call_in_pin DROP DEFAULT;
ALTER TABLE users ALTER COLUMN call_in_pin DROP NOT NULL;

-- Per-calling-number lockout after failed PIN attempts
ALTER TABLE trusted_phones ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE trusted_phones ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

-- Tracks a contact saved by phone and waiting on a name via SMS
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS name_requested_at TIMESTAMPTZ;