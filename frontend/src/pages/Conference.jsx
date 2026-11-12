import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

export default function Conference() {
  const [state, setState] = useState({ active: false, participants: [] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef(null);

  async function load() {
    try {
      const r = await api.conferences.live();
      setState(r);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    timer.current = setInterval(load, 3000);
    return () => clearInterval(timer.current);
  }, []);

  async function muteAll(muted) {
    setBusy(muted ? 'mute-all' : 'unmute-all');
    try { await api.conferences.muteAll(muted); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  async function muteOne(callSid, muted) {
    setBusy(callSid);
    try { await api.conferences.muteOne(callSid, muted); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  async function endCall() {
    if (!window.confirm('Hang up on everyone and end the conference?')) return;
    setBusy('end');
    try { await api.conferences.end(); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  const others = state.participants.filter((p) => !p.is_host);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Conference</h1>
          <p>Who is on the call, and who can speak</p>
        </div>
        {state.active && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn secondary" onClick={() => muteAll(true)} disabled={busy === 'mute-all'}>
              <i className="ti ti-microphone-off" /> Mute everyone
            </button>
            <button type="button" className="btn secondary" onClick={() => muteAll(false)} disabled={busy === 'unmute-all'}>
              <i className="ti ti-microphone" /> Unmute everyone
            </button>
            <button type="button" className="btn" style={{ background: 'var(--danger)' }} onClick={endCall} disabled={busy === 'end'}>
              <i className="ti ti-phone-off" /> End call
            </button>
          </div>
        )}
      </div>

      {error && <div className="banner error">{error}</div>}

      {!loaded ? null : !state.active ? (
        <div className="card empty-state">
          <h3>No conference running</h3>
          <p>Call your number, enter your PIN, then press 8 to start one.</p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, maxWidth: 620 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontSize: 13, color: 'var(--ink-soft)' }}>
            {state.participants.length} on the call
            {others.length > 0 && ` - ${others.filter((p) => p.muted).length} muted`}
          </div>
          {state.participants.map((p) => (
            <div key={p.call_sid} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 14 }}>
                  {p.name || p.phone_number || 'Unknown caller'}
                  {p.is_host && <span className="pill signal" style={{ marginLeft: 8 }}>Host</span>}
                </div>
                {p.name && p.phone_number && (
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)', fontFamily: 'var(--font-mono)' }}>{p.phone_number}</div>
                )}
              </div>
              {p.is_host ? (
                <span style={{ fontSize: 12.5, color: 'var(--ink-faint)' }}>You</span>
              ) : (
                <button
                  type="button"
                  className="btn secondary"
                  style={{ padding: '5px 12px', fontSize: 12.5, whiteSpace: 'nowrap' }}
                  onClick={() => muteOne(p.call_sid, !p.muted)}
                  disabled={busy === p.call_sid}
                >
                  {p.muted ? 'Unmute' : 'Mute'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}