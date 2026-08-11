import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { t } from '../i18n.js';

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
  const [totals, setTotals] = useState({ totalCost: 0, totalSeconds: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const data = await api.callIns.list(userFilter === 'me' ? null : userFilter);
      setRows(data.callIns || []);
      setTotals({
        totalCost: data.totalCost || 0,
        totalSeconds: data.totalSeconds || 0,
        count: data.count || 0,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [userFilter]);

  if (error) return <div className="banner error">{error}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ flexShrink: 0, padding: '4px 0 12px', color: 'var(--ink-soft)', fontSize: 13.5 }}>
        {totals.count} {totals.count === 1 ? 'call' : 'calls'} · {fmtDuration(totals.totalSeconds)} ·{' '}
        <strong style={{ color: 'var(--ink)' }}>${Number(totals.totalCost).toFixed(4)}</strong>
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
        ) : rows.length === 0 ? (
          <div className="card empty-state">
            <h3>No call-ins yet</h3>
            <p>When someone calls your number, it will show up here.</p>
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
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {new Date(r.started_at).toLocaleString()}
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>
                        {r.contact_name || r.from_phone_number}
                      </div>
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