import React from 'react';

export const DATE_PRESETS = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'custom', label: 'Custom' },
];

// Turns the picker state into { from, to } Date bounds. Either can be null.
export function resolveDateRange(preset, customFrom, customTo) {
  if (preset === 'all') return { from: null, to: null };

  if (preset === 'custom') {
    const from = customFrom ? new Date(`${customFrom}T00:00:00`) : null;
    const to = customTo ? new Date(`${customTo}T23:59:59.999`) : null;
    return { from, to };
  }

  if (preset === 'today') {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    return { from, to: null };
  }

  const days = parseInt(preset, 10);
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return { from, to: null };
}

export function inDateRange(date, range) {
  if (!range.from && !range.to) return true;
  if (!date) return false;
  const d = date instanceof Date ? date : new Date(date);
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

export default function DateRangeFilter({
  preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo,
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div className="chip-select" style={{ marginBottom: 0 }}>
        {DATE_PRESETS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`chip-toggle ${preset === opt.value ? 'active' : ''}`}
            onClick={() => setPreset(opt.value)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {preset === 'custom' && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            style={{ padding: '5px 8px', fontSize: 13 }}
          />
          <span style={{ color: 'var(--ink-faint)', fontSize: 13 }}>to</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            style={{ padding: '5px 8px', fontSize: 13 }}
          />
        </div>
      )}
    </div>
  );
}