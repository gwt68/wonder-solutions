// Parses .vcf (vCard) text into contact rows. Handles 2.1/3.0/4.0, line
// folding, and the quoted-printable encoding Apple and Google use for
// non-ASCII names — without decoding it, Hebrew names come through as gibberish.

function decodeQuotedPrintable(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '=' && i + 2 < str.length) {
      const hex = str.substr(i + 1, 2);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(str.charCodeAt(i));
  }
  try {
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
  } catch {
    return str;
  }
}

// Joins folded lines (continuations start with a space or tab) and strips
// soft line breaks used by quoted-printable.
function unfold(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/=\n[ \t]?/g, '')
    .replace(/\n[ \t]/g, '');
}

function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const left = line.slice(0, colon);
  let value = line.slice(colon + 1);
  const parts = left.split(';');
  const name = parts[0].toUpperCase();
  const params = parts.slice(1);
  if (params.some((p) => /QUOTED-PRINTABLE/i.test(p))) value = decodeQuotedPrintable(value);
  return { name, params, value };
}

function phoneLabel(params) {
  const types = params
    .filter((p) => /^TYPE=/i.test(p) || !p.includes('='))
    .map((p) => p.replace(/^TYPE=/i, '').replace(/"/g, ''))
    .join(' ')
    .toUpperCase();
  if (types.includes('CELL') || types.includes('MOBILE')) return 'Cell';
  if (types.includes('HOME')) return 'Home';
  if (types.includes('WORK')) return 'Work';
  if (types.includes('MAIN')) return 'Main';
  if (types.includes('IPHONE')) return 'iPhone';
  return 'Other';
}

// Cell/mobile first, so the default pick is usually the right one.
function rankPhone(label) {
  const order = { Cell: 0, iPhone: 1, Mobile: 2, Main: 3, Home: 4, Work: 5, Other: 6 };
  return order[label] ?? 9;
}

export function parseVcf(text) {
  const cards = unfold(text).split(/BEGIN:VCARD/i).slice(1);
  const rows = [];

  for (const card of cards) {
    const body = card.split(/END:VCARD/i)[0];
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);

    let first_name = '';
    let last_name = '';
    let fullName = '';
    let email = '';
    let address = '';
    let city = '';
    let state = '';
    let zip = '';
    let country = '';
    const phones = [];

    for (const raw of lines) {
      const parsed = parseLine(raw);
      if (!parsed) continue;
      const { name, params, value } = parsed;

      if (name === 'N') {
        const n = value.split(';');
        last_name = (n[0] || '').trim();
        first_name = (n[1] || '').trim();
      } else if (name === 'FN') {
        fullName = value.trim();
      } else if (name === 'TEL') {
        const digits = value.replace(/[^\d+]/g, '');
        if (digits) phones.push({ value: digits, label: phoneLabel(params) });
      } else if (name === 'EMAIL' && !email) {
        email = value.trim();
      } else if (name === 'ADR' && !address) {
        const a = value.split(';');
        address = [a[1], a[2]].filter(Boolean).join(' ').trim();
        city = (a[3] || '').trim();
        state = (a[4] || '').trim();
        zip = (a[5] || '').trim();
        country = (a[6] || '').trim();
      }
    }

    if (!first_name && !last_name && fullName) {
      const parts = fullName.split(/\s+/).filter(Boolean);
      first_name = parts[0] || '';
      last_name = parts.slice(1).join(' ');
    }

    const seen = new Set();
    const uniquePhones = phones.filter((p) => {
      const key = p.value.replace(/\D/g, '').slice(-10);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    uniquePhones.sort((a, b) => rankPhone(a.label) - rankPhone(b.label));

    if (!uniquePhones.length && !first_name && !last_name) continue;

    rows.push({
      first_name,
      last_name,
      phones: uniquePhones,
      phone_number: uniquePhones[0]?.value || '',
      email, address, city, state, zip, country,
      include: uniquePhones.length > 0,
    });
  }

  return rows;
}