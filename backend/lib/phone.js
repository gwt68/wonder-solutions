// One place that decides what a stored phone number looks like.
// Everything that writes to contacts.phone_number goes through this so the
// unique index on (user_id, phone_number) actually catches duplicates.
function normalizePhone(raw) {
  const digits = (raw || '').toString().replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

module.exports = { normalizePhone };