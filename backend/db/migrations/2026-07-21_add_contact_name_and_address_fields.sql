-- Adds first/last name and city/state/zip/country to contacts.
-- Existing rows keep their legacy `name` value untouched (not split) --
-- the app falls back to it for display until a contact is re-saved with
-- first_name/last_name filled in.
--
-- Run this once against the production database (Railway Postgres query
-- console, or `psql "$DATABASE_URL" -f this_file.sql`).

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS city VARCHAR(255),
  ADD COLUMN IF NOT EXISTS state VARCHAR(255),
  ADD COLUMN IF NOT EXISTS zip VARCHAR(20),
  ADD COLUMN IF NOT EXISTS country VARCHAR(255);
