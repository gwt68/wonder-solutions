import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

function fmtDuration(s) {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m ? `${m}m ${sec}s` : `${sec}s`;
}

export default function Conference() {
  const [tab, setTab] = useState('live');
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
          <p>Who is on the call, and who was on past ones</p>
        </div>
        {tab === 'live' && state.active && (
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

      <div className="chip-select" style={{ marginBottom: 14 }}>
        <button type="button" className={`chip-toggle ${tab === 'live' ? 'active' : ''}`} onClick={() => setTab('live')}>
          Happening now
        </button>
        <button type="button" className={`chip-toggle ${tab === 'past' ? 'active' : ''}`} onClick={() => setTab('past')}>
          Past calls
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {tab === 'past' ? <PastConferences /> : !loaded ? null : !state.active ? (
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

function PastConferences() {
  const [rows, setRows] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.conferences.history()
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const [audioUrls, setAudioUrls] = useState({});

  async function toggle(id) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    setAttendees([]);
    try {
      setAttendees(await api.conferences.attendees(id));
    } catch (e) {
      setError(e.message);
    }
    if (!audioUrls[id]) {
      try {
        const url = await api.conferences.recordingUrl(id);
        if (url) setAudioUrls((m) => ({ ...m, [id]: url }));
      } catch { /* no recording, or it could not be fetched */ }
    }
  }

  if (loading) return null;
  if (error) return <div className="banner error">{error}</div>;
  if (!rows.length) {
    return (
      <div className="card empty-state">
        <h3>No conferences yet</h3>
        <p>Once you run one, who attended and for how long shows up here.</p>
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Code</th>
            <th style={{ textAlign: 'right' }}>People</th>
            <th style={{ textAlign: 'right' }}>Total time</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <React.Fragment key={r.id}>
              <tr onClick={() => toggle(r.id)} style={{ cursor: 'pointer' }}>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString()}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{r.access_code}</td>
                <td style={{ textAlign: 'right' }}>{r.attendee_count}</td>
                <td style={{ textAlign: 'right' }}>{fmtDuration(r.total_seconds)}</td>
                <td><span className="pill">{r.status}</span></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                  {r.recording_url && (
                    <button
                      type="button"
                      className="icon-btn"
                      title="Download the recording"
                      onClick={() => api.conferences.downloadRecording(r.id).catch((e) => alert(e.message))}
                    >
                      <i className="ti ti-download" />
                    </button>
                  )}
                  {r.recording_url && (
                    <button type="button" className="icon-btn" title="Delete just the recording"
                      onClick={async () => {
                        if (!window.confirm('Delete the recording? The attendance record stays.')) return;
                        try { await api.conferences.deleteRecording(r.id); setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, recording_url: null } : x)); }
                        catch (e) { alert(e.message); }
                      }}>
                      <i className="ti ti-microphone-off" />
                    </button>
                  )}
                  <button type="button" className="icon-btn danger" title="Delete this conference"
                    onClick={async () => {
                      if (!window.confirm('Delete this conference and its recording? This cannot be undone.')) return;
                      try { await api.conferences.remove(r.id); setRows((rs) => rs.filter((x) => x.id !== r.id)); }
                      catch (e) { alert(e.message); }
                    }}>
                    <i className="ti ti-trash" />
                  </button>
                  <i className={`ti ti-chevron-${openId === r.id ? 'up' : 'down'}`} style={{ marginLeft: 8 }} onClick={() => toggle(r.id)} />
                </td>
              </tr>
              {openId === r.id && (
                <tr>
                  <td colSpan={6} style={{ background: 'var(--bg)' }}>
                    {audioUrls[r.id] && (
                      <audio controls src={audioUrls[r.id]} style={{ width: '100%', marginBottom: 10 }} />
                    )}
                    {!attendees.length ? (
                      <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>Nobody was recorded on this call.</p>
                    ) : (
                      <table className="data-table" style={{ fontSize: 13 }}>
                        <thead>
                          <tr>
                            <th>Caller</th>
                            <th>Joined</th>
                            <th>Left</th>
                            <th style={{ textAlign: 'right' }}>Time on call</th>
                          </tr>
                        </thead>
                        <tbody>
                          {attendees.map((a) => (
                            <tr key={a.call_sid}>
                              <td>
                                {a.contact_name || a.from_phone_number}
                                {a.is_host && <span className="pill signal" style={{ marginLeft: 6 }}>Host</span>}
                              </td>
                              <td style={{ whiteSpace: 'nowrap' }}>{a.started_at ? new Date(a.started_at).toLocaleTimeString() : '—'}</td>
                              <td style={{ whiteSpace: 'nowrap' }}>{a.ended_at ? new Date(a.ended_at).toLocaleTimeString() : '—'}</td>
                              <td style={{ textAlign: 'right' }}>{fmtDuration(a.duration_seconds)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}