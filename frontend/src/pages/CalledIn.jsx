import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import DateRangeFilter, { resolveDateRange, inDateRange } from '../DateRangeFilter.jsx';

function fmtDuration(s) {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  return m ? `${m}m ${s % 60}s` : `${s}s`;
}

function outcomeLabel(r) {
  if (r.reached === 'admin_menu') return 'Admin menu';
  if (r.reached === 'conference') return 'Joined conference';
  if (r.played_message_name) return r.played_message_name;
  return 'Nothing on file';
}

export default function CalledIn({ userFilter = 'me', isAdmin = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [datePreset, setDatePreset] = useState('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  async function load() {
    setLoading(true);
    try {
      const data = await api.callIns.list(userFilter === 'me' ? null : userFilter);
      setRows(data.callIns || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [userFilter]);

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const range = resolveDateRange(datePreset, customFrom, customTo);
    return rows.filter((r) => {
      if (!inDateRange(r.started_at, range)) return false;
      if (!q) return true;
      return (
        (r.contact_name || '').toLowerCase().includes(q) ||
        (r.from_phone_number || '').toLowerCase().includes(q) ||
        (r.played_message_name || '').toLowerCase().includes(q) ||
        (r.user_name || '').toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery, datePreset, customFrom, customTo]);

  const totals = useMemo(() => ({
    count: visibleRows.length,
    cost: visibleRows.reduce((s, r) => s + (parseFloat(r.cost) || 0), 0),
    seconds: visibleRows.reduce((s, r) => s + (r.duration_seconds || 0), 0),
  }), [visibleRows]);

  if (error) return <div className="banner error">{error}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flexShrink: 0, marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <div className="field" style={{ maxWidth: 280, marginBottom: 0 }}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by caller or message"
            />
          </div>
          <DateRangeFilter
            preset={datePreset}
            setPreset={setDatePreset}
            customFrom={customFrom}
            setCustomFrom={setCustomFrom}
            customTo={customTo}
            setCustomTo={setCustomTo}
          />
        </div>
        <div style={{ color: 'var(--ink-soft)', fontSize: 13.5 }}>
          {totals.count} {totals.count === 1 ? 'call' : 'calls'} · {fmtDuration(totals.seconds)} ·{' '}
          <strong style={{ color: 'var(--ink)' }}>${totals.cost.toFixed(4)}</strong>
        </div>
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
        ) : rows.length === 0 ? (
          <div className="card empty-state">
            <h3>No call-ins yet</h3>
            <p>When someone calls your number, it will show up here.</p>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="card empty-state">
            <h3>Nothing matches</h3>
            <p>Try a different search or date range.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Caller</th>
                  <th>Listened to</th>
                  <th>Duration</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.started_at).toLocaleString()}</td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{r.contact_name || r.from_phone_number}</div>
                      {r.is_trusted && (
                        <div className="row-sub" style={{ color: 'var(--ink-faint)' }}>trusted</div>
                      )}
                    </td>
                    <td>{outcomeLabel(r)}</td>
                    <td>{fmtDuration(r.duration_seconds)}</td>
                    <td style={{ fontFamily: 'var(--font-mono)' }}>
                      {r.cost != null ? `$${Number(r.cost).toFixed(4)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}