import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { api } from '../api.js';

function fmtDuration(s) {
  if (s == null) return '—';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m ? `${m}m ${sec}s` : `${sec}s`;
}

export default function Conference() {
  const [tab, setTab] = useState('live');
  const [rooms, setRooms] = useState([]);
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef(null);

  async function load() {
    try {
      const r = await api.conferences.live();
      setRooms(r.conferences || []);
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    api.groups.list().then(setGroups).catch(() => {});
    timer.current = setInterval(load, 3000);
    return () => clearInterval(timer.current);
  }, []);

  async function run(key, fn) {
    setBusy(key);
    try { await fn(); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(null); }
  }

  async function endCall(id) {
    if (!window.confirm('Hang up on everyone and end this conference?')) return;
    run('end-' + id, () => api.conferences.end(id));
  }

  const small = { padding: '5px 12px', fontSize: 12.5 };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Conference</h1>
          <p>Who is on the call, and who was on past ones</p>
        </div>
      </div>

      <div className="chip-select" style={{ marginBottom: 14 }}>
        <button type="button" className={`chip-toggle ${tab === 'live' ? 'active' : ''}`} onClick={() => setTab('live')}>
          Happening now{rooms.length > 1 ? ` (${rooms.length})` : ''}
        </button>
        <button type="button" className={`chip-toggle ${tab === 'past' ? 'active' : ''}`} onClick={() => setTab('past')}>
          Past calls
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {tab === 'past' ? <PastConferences /> : !loaded ? null : !rooms.length ? (
        <div className="card empty-state">
          <h3>No conference running</h3>
          <p>Call your number, enter your PIN, then press 8 to start one.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {rooms.map((room) => {
            const id = room.conference_id;
            const others = room.participants.filter((p) => !p.is_host);
            return (
              <div key={id} className="card" style={{ padding: 0, maxWidth: 620 }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', fontWeight: 600 }}>{room.code}</span>
                    {room.name && <span style={{ fontSize: 14 }}>{room.name}</span>}
                    <span style={{ fontSize: 13, color: 'var(--ink-soft)', marginLeft: 'auto' }}>
                      {room.participants.length} on the call
                      {others.length > 0 && ` - ${others.filter((p) => p.muted).length} muted`}
                      {room.recording_on && ' - recording'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button type="button" className="btn secondary" style={small}
                      onClick={() => run('rec-' + id, () => api.conferences.setRecording(!room.recording_on, id))}
                      disabled={busy === 'rec-' + id}>
                      <i className={room.recording_on ? 'ti ti-player-stop' : 'ti ti-player-record'} />
                      {' '}{room.recording_on ? 'Stop recording' : 'Record'}
                    </button>
                    <button type="button" className="btn secondary" style={small}
                      onClick={() => run('mute-' + id, () => api.conferences.muteAll(true, id))}
                      disabled={busy === 'mute-' + id}>
                      <i className="ti ti-microphone-off" /> Mute everyone
                    </button>
                    <button type="button" className="btn secondary" style={small}
                      onClick={() => run('unmute-' + id, () => api.conferences.muteAll(false, id))}
                      disabled={busy === 'unmute-' + id}>
                      <i className="ti ti-microphone" /> Unmute everyone
                    </button>
                    <button type="button" className="btn" style={{ ...small, background: 'var(--danger)' }}
                      onClick={() => endCall(id)} disabled={busy === 'end-' + id}>
                      <i className="ti ti-phone-off" /> End call
                    </button>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-soft)', marginLeft: 'auto' }}>
                      Who can join
                      <select
                        value={room.whitelist_group_id == null ? '' : String(room.whitelist_group_id)}
                        disabled={busy === 'wl-' + id}
                        onChange={(e) => run('wl-' + id, () => api.conferences.setWhitelist(e.target.value === '' ? null : Number(e.target.value), id))}
                      >
                        <option value="">Anyone with the code</option>
                        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </label>
                  </div>
                </div>

                {room.participants.map((p) => (
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
                      <button type="button" className="btn secondary"
                        style={{ ...small, whiteSpace: 'nowrap' }}
                        onClick={() => run(p.call_sid, () => api.conferences.muteOne(p.call_sid, !p.muted, id))}
                        disabled={busy === p.call_sid}>
                        {p.muted ? 'Unmute' : 'Mute'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PastConferences() {
  const [rows, setRows] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [audioUrls, setAudioUrls] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.conferences.history()
      .then(setRows)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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

  // One sheet listing the calls, one listing everyone who was on them.
  async function exportAll() {
    setExporting(true);
    setError('');
    try {
      const summary = rows.map((r) => ({
        When: new Date(r.created_at).toLocaleString(),
        Code: r.access_code,
        People: r.attendee_count,
        'Total minutes': Math.round((r.total_seconds || 0) / 60 * 10) / 10,
        Status: r.status,
        Recording: r.recording_url ? 'Yes' : 'No',
      }));

      const detail = [];
      for (const r of rows) {
        let list = [];
        try { list = await api.conferences.attendees(r.id); } catch { /* skip */ }
        for (const a of list) {
          detail.push({
            Conference: new Date(r.created_at).toLocaleString(),
            Code: r.access_code,
            Caller: a.contact_name || a.from_phone_number || '',
            Phone: a.from_phone_number || '',
            Host: a.is_host ? 'Yes' : '',
            Joined: a.started_at ? new Date(a.started_at).toLocaleString() : '',
            Left: a.ended_at ? new Date(a.ended_at).toLocaleString() : '',
            'Minutes on call': a.duration_seconds == null ? '' : Math.round(a.duration_seconds / 60 * 10) / 10,
          });
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Conferences');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'Who attended');
      XLSX.writeFile(wb, `conferences-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }

  function exportOne(r, list) {
    const detail = list.map((a) => ({
      Caller: a.contact_name || a.from_phone_number || '',
      Phone: a.from_phone_number || '',
      Host: a.is_host ? 'Yes' : '',
      Joined: a.started_at ? new Date(a.started_at).toLocaleString() : '',
      Left: a.ended_at ? new Date(a.ended_at).toLocaleString() : '',
      'Minutes on call': a.duration_seconds == null ? '' : Math.round(a.duration_seconds / 60 * 10) / 10,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'Who attended');
    XLSX.writeFile(wb, `conference-${r.id}.xlsx`);
  }

  if (loading) return null;
  if (!rows.length) {
    return (
      <>
        {error && <div className="banner error">{error}</div>}
        <div className="card empty-state">
          <h3>No conferences yet</h3>
          <p>Once you run one, who attended and for how long shows up here.</p>
        </div>
      </>
    );
  }

  return (
    <>
      {error && <div className="banner error">{error}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button type="button" className="btn secondary" onClick={exportAll} disabled={exporting}>
          <i className="ti ti-file-spreadsheet" /> {exporting ? 'Building…' : 'Export to Excel'}
        </button>
      </div>

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
                          try {
                            await api.conferences.deleteRecording(r.id);
                            setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, recording_url: null } : x));
                          } catch (e) { alert(e.message); }
                        }}>
                        <i className="ti ti-microphone-off" />
                      </button>
                    )}
                    <button type="button" className="icon-btn danger" title="Delete this conference"
                      onClick={async () => {
                        if (!window.confirm('Delete this conference and its recording? This cannot be undone.')) return;
                        try {
                          await api.conferences.remove(r.id);
                          setRows((rs) => rs.filter((x) => x.id !== r.id));
                        } catch (e) { alert(e.message); }
                      }}>
                      <i className="ti ti-trash" />
                    </button>
                    <i
                      className={`ti ti-chevron-${openId === r.id ? 'up' : 'down'}`}
                      style={{ marginLeft: 8, cursor: 'pointer' }}
                      onClick={() => toggle(r.id)}
                    />
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
                        <>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                            <button type="button" className="btn secondary" style={{ padding: '4px 10px', fontSize: 12 }}
                              onClick={() => exportOne(r, attendees)}>
                              <i className="ti ti-file-spreadsheet" /> Export this call
                            </button>
                          </div>
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
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
