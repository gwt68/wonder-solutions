// Smart quotes, dashes and ellipses are not in the GSM-7 alphabet, so one of
// them flips a whole SMS to UCS-2: 67 characters per segment instead of 153,
// roughly doubling the cost. Swap them for plain equivalents before sending.
const GSM_SWAPS = [
  [/[\u2018\u2019\u201A\u201B]/g, "'"],
  [/[\u201C\u201D\u201E\u201F]/g, '"'],
  [/[\u2013\u2014\u2015]/g, '-'],
  [/\u2026/g, '...'],
  [/[\u00A0\u2007\u202F]/g, ' '],
  [/\u2022/g, '*'],
  [/\u2122/g, 'TM'],
  [/[\u00AB\u00BB]/g, '"'],
];

function toGsmSafe(text) {
  if (!text) return text;
  let out = text;
  for (const [re, rep] of GSM_SWAPS) out = out.replace(re, rep);
  return out;
}

module.exports = { toGsmSafe };