import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { api, audioUrl, imageUrl } from '../api.js';
import { groupSendsIntoBroadcasts } from '../broadcastUtils.js';
import { t, tf } from '../i18n.js';

function getDeliveryLabels() {
  return {
    queued: t('delivery_queued'), sending: t('delivery_sending'), sent: t('delivery_sent'),
    delivered: t('delivery_delivered'), undelivered: t('delivery_undelivered'), failed: t('delivery_failed'),
    initiated: t('delivery_initiated'), ringing: t('delivery_ringing'), 'in-progress': t('delivery_in_progress'),
    answered: t('delivery_answered'), completed: t('delivery_completed'), busy: t('delivery_busy'),
    'no-answer': t('delivery_no_answer'), canceled: t('delivery_canceled'),
  };
}

function getAnsweredByLabels() {
  return {
    human: t('answered_human'),
    machine_start: t('answered_machine'),
    machine_end_beep: t('answered_machine'),
    machine_end_silence: t('answered_machine'),
    machine_end_other: t('answered_machine'),
    fax: t('answered_fax'),
    unknown: t('answered_unknown'),
  };
}

function getMethodLabels() {
  return { sms: t('type_sms'), call: t('type_call'), voice_note: t('type_voice_note') };
}
const METHOD_ICONS = { sms: 'ti-message', call: 'ti-phone', voice_note: 'ti-microphone' };

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Column keys used by the picker, the table and the export.
// `cost` is admin-only and is filtered out for everyone else.
function getAllColumns() {
  return [
    { key: 'date', label: 'Date', default: true, sortable: true, adminOnly: false },
    { key: 'message', label: 'Message', default: true, sortable: true, adminOnly: false },
    { key: 'type', label: 'Type', default: true, sortable: true, adminOnly: false },
    { key: 'recipients', label: 'Recipients', default: true, sortable: true, adminOnly: false },
    { key: 'sent', label: 'Sent', default: true, sortable: true, adminOnly: false },
    { key: 'failed', label: 'Failed', default: true, sortable: true, adminOnly: false },
    { key: 'scheduled', label: 'Scheduled', default: false, sortable: true, adminOnly: false },
    { key: 'replies', label: 'Replies', default: false, sortable: true, adminOnly: false },
    { key: 'cost', label: 'Cost', default: true, sortable: true, adminOnly: true },
  ];
}

const STORAGE_KEY = 'wonder_history_columns';

function broadcastDate(b) {
  const raw = b.latestSentAt || b.scheduledAt;
  return raw ? new Date(raw) : null;
}

function replyCount(b) {
  return b.recipients.filter((r) => r.reply_text).length;
}

// Twilio returns price on a later status callback, so a just-sent broadcast
// can have rows with no cost yet. Track that so the total isn't read as final.
function costSummary(b) {
  let total = 0;
  let charged = 0;
  let pending = 0;
  b.recipients.forEach((r) => {
    const raw = r.cost;
    if (raw === null || raw === undefined || raw === '') {
      // Only count as pending if the send actually went out.
      if (r.status === 'sent') pending += 1;
      return;
    }
    const n = Math.abs(parseFloat(raw));
    if (Number.isNaN(n)) return;
    total += n;
    charged += 1;
  });
  return { total, charged, pending };
}

export default function History({ onNavigateToConversation, isAdmin = false }) {
  const DELIVERY_LABELS = getDeliveryLabels();
  const ANSWERED_BY_LABELS = getAnsweredByLabels();
  const METHOD_LABELS = getMethodLabels();
  const ALL_COLUMNS = getAllColumns().filter((c) => !c.adminOnly || isAdmin);
  const DEFAULT_VISIBLE = ALL_COLUMNS.filter((c) => c.default).map((c) => c.key);

  const [sends, setSends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(new Set());
  const [expandedReplyId, setExpandedReplyId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('me');
  const [users, setUsers] = useState([]);
  const [cancelingBatch, setCancelingBatch] = useState(null);
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      return parsed || getAllColumns().filter((c) => c.default).map((c) => c.key);
    } catch {
      return getAllColumns().filter((c) => c.default).map((c) => c.key);
    }
  });

  // Never show a stored `cost` column to a non-admin.
  const shownCols = visibleCols.filter((k) => ALL_COLUMNS.some((c) => c.key === k));

  function toggleColumn(key) {
    setVisibleCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function handleSort(field) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'date' ? 'desc' : 'asc');
    }
  }

  function sortArrow(field) {
    if (sortField !== field) return null;
    return <span className="sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  function onOpenConversation(contactId) {
    if (onNavigateToConversation) onNavigateToConversation(contactId);
  }

  async function load() {
    setLoading(true);
    try {
      const userIdParam = userFilter === 'me' ? null : userFilter;
      setSends(await api.sends.list(userIdParam));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [userFilter]);

  useEffect(() => {
    if (isAdmin) {
      api.users.list().then(setUsers).catch(() => {});
    }
  }, [isAdmin]);

  async function handleDeleteRecipient(id) {
    if (!confirm(t('history_confirm_remove_recipient'))) return;
    try {
      await api.sends.remove(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCancelBatch(batchId) {
    if (!confirm('Cancel this scheduled broadcast? Recipients who have not been sent to yet will not receive it.')) return;
    setCancelingBatch(batchId);
    setError('');
    try {
      await api.sends.cancelBatch(batchId);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setCancelingBatch(null);
    }
  }

  function toggleExpand(batchId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId); else next.add(batchId);
      return next;
    });
  }

  const allBroadcasts = useMemo(() => groupSendsIntoBroadcasts(sends), [sends]);

  const visibleBroadcasts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let filtered = !q ? [...allBroadcasts] : allBroadcasts.filter((b) => {
      if ((b.messageTitle || '').toLowerCase().includes(q)) return true;
      if ((b.messageText || '').toLowerCase().includes(q)) return true;
      return b.recipients.some((r) =>
        (r.contact_name || '').toLowerCase().includes(q) ||
        (r.phone_number || '').toLowerCase().includes(q)
      );
    });
    if (statusFilter !== 'all') {
      filtered = filtered.filter((b) => b.overallStatus === statusFilter);
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    filtered.sort((a, b) => {
      let av;
      let bv;
      switch (sortField) {
        case 'message':
          av = (a.messageTitle || '').toLowerCase();
          bv = (b.messageTitle || '').toLowerCase();
          break;
        case 'type':
          av = a.singleMethod || 'zz';
          bv = b.singleMethod || 'zz';
          break;
        case 'recipients': av = a.total; bv = b.total; break;
        case 'sent': av = a.counts.sent; bv = b.counts.sent; break;
        case 'failed': av = a.counts.failed; bv = b.counts.failed; break;
        case 'scheduled': av = a.counts.scheduled; bv = b.counts.scheduled; break;
        case 'replies': av = replyCount(a); bv = replyCount(b); break;
        case 'cost': av = costSummary(a).total; bv = costSummary(b).total; break;
        case 'date':
        default: {
          const ad = broadcastDate(a);
          const bd = broadcastDate(b);
          av = ad ? ad.getTime() : 0;
          bv = bd ? bd.getTime() : 0;
          break;
        }
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return filtered;
  }, [allBroadcasts, searchQuery, sortField, sortDir, statusFilter]);

  const grandTotal = useMemo(
    () => visibleBroadcasts.reduce((sum, b) => sum + costSummary(b).total, 0),
    [visibleBroadcasts]
  );

  function cellValue(b, key) {
    const cs = costSummary(b);
    switch (key) {
      case 'date': {
        const d = broadcastDate(b);
        return d ? d.toLocaleString() : '';
      }
      case 'message': return b.messageTitle || t('label_untitled_message');
      case 'type': return b.singleMethod ? (METHOD_LABELS[b.singleMethod] || b.singleMethod) : t('history_mixed_methods');
      case 'recipients': return b.total;
      case 'sent': return b.counts.sent;
      case 'failed': return b.counts.failed;
      case 'scheduled': return b.counts.scheduled;
      case 'replies': return replyCount(b);
      case 'cost': return cs.total ? Number(cs.total.toFixed(4)) : 0;
      default: return '';
    }
  }

  function exportVisible() {
    const cols = ALL_COLUMNS.filter((c) => shownCols.includes(c.key));
    const rows = visibleBroadcasts.map((b) => {
      const row = {};
      cols.forEach((c) => { row[c.label] = cellValue(b, c.key); });
      return row;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Broadcasts');
    XLSX.writeFile(wb, `history-${new Date().toISOString().slice(0, 10)}.xlsx`);
    setExportOpen(false);
  }

  function exportEverything() {
    const cols = ALL_COLUMNS; // every column, admin-filtered
    const summary = allBroadcasts.map((b) => {
      const row = {};
      cols.forEach((c) => { row[c.label] = cellValue(b, c.key); });
      return row;
    });

    const detail = [];
    allBroadcasts.forEach((b) => {
      const d = broadcastDate(b);
      b.recipients.forEach((r) => {
        const row = {
          Date: d ? d.toLocaleString() : '',
          Message: b.messageTitle || t('label_untitled_message'),
          Contact: r.contact_name || '',
          Phone: r.phone_number,
          Type: METHOD_LABELS[r.effective_method] || r.effective_method || '',
          Status: r.status || '',
          Delivery: r.delivery_status ? (DELIVERY_LABELS[r.delivery_status] || r.delivery_status) : '',
          Duration: formatDuration(r.call_duration) || '',
          'Answered by': r.answered_by ? (ANSWERED_BY_LABELS[r.answered_by] || r.answered_by) : '',
          Reply: r.reply_text || '',
          Error: r.error_message || '',
        };
        if (isAdmin) {
          const n = r.cost === null || r.cost === undefined || r.cost === '' ? '' : Math.abs(parseFloat(r.cost));
          row.Cost = Number.isNaN(n) ? '' : n;
        }
        detail.push(row);
      });
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Broadcasts');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'Recipients');
    XLSX.writeFile(wb, `history-full-${new Date().toISOString().slice(0, 10)}.xlsx`);
    setExportOpen(false);
  }

  const colCount = shownCols.length + 1; // + chevron column

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1>{t('history_title')}</h1>
          <p>{t('history_subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <button className="btn secondary" onClick={() => { setColumnsOpen((o) => !o); setExportOpen(false); }}>
              <i className="ti ti-columns" /> {t('contacts_columns')}
            </button>
            {columnsOpen && (
              <div className="card" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, padding: 12, zIndex: 10, minWidth: 180 }}>
                {ALL_COLUMNS.map((col) => (
                  <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, padding: '5px 4px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={shownCols.includes(col.key)}
                      onChange={() => toggleColumn(col.key)}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button className="btn secondary" onClick={() => { setExportOpen((o) => !o); setColumnsOpen(false); }} disabled={allBroadcasts.length === 0}>
              <i className="ti ti-file-spreadsheet" /> Export
            </button>
            {exportOpen && (
              <div className="card" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, padding: 8, zIndex: 10, minWidth: 230 }}>
                <button
                  type="button"
                  onClick={exportVisible}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 10px', fontSize: 13.5, cursor: 'pointer', borderRadius: 6 }}
                >
                  This view
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)' }}>
                    {visibleBroadcasts.length} broadcast{visibleBroadcasts.length !== 1 ? 's' : ''}, columns as shown
                  </span>
                </button>
                <button
                  type="button"
                  onClick={exportEverything}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '8px 10px', fontSize: 13.5, cursor: 'pointer', borderRadius: 6 }}
                >
                  Everything
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-soft)' }}>
                    All {allBroadcasts.length} broadcasts + a row per recipient
                  </span>
                </button>
              </div>
            )}
          </div>
          <button className="btn secondary" onClick={load}><i className="ti ti-refresh" /> {t('history_refresh')}</button>
        </div>
      </div>

      <div style={{ flexShrink: 0 }}>
        {error && <div className="banner error">{error}</div>}

        {allBroadcasts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', flex: '1 1 auto' }}>
            <div className="field" style={{ maxWidth: 280, marginBottom: 0 }}>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by message or recipient"
              />
            </div>

            <div className="chip-select" style={{ marginBottom: 0 }}>
              {[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'scheduled', label: 'Scheduled' },
                { value: 'completed', label: 'Completed' },
                { value: 'canceled', label: 'Canceled' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`chip-toggle ${statusFilter === opt.value ? 'active' : ''}`}
                  onClick={() => setStatusFilter(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {isAdmin && (
              <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} style={{ maxWidth: 180 }}>
                <option value="me">My own</option>
                <option value="all">All users</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.username}</option>
                ))}
              </select>
            )}
          </div>

          {isAdmin && grandTotal > 0 && (
            <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
              {visibleBroadcasts.length} broadcast{visibleBroadcasts.length !== 1 ? 's' : ''} ·{' '}
              <strong style={{ color: 'var(--ink)' }}>${grandTotal.toFixed(4)}</strong> total
            </span>
          )}
        </div>
      )}
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>{t('send_loading')}</p>
        ) : allBroadcasts.length === 0 ? (
          <div className="card empty-state">
            <h3>{t('history_empty_title')}</h3>
            <p>{t('history_empty_body')}</p>
          </div>
        ) : visibleBroadcasts.length === 0 ? (
          <div className="card empty-state">
            <h3>No broadcasts match your search</h3>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  {ALL_COLUMNS.filter((c) => shownCols.includes(c.key)).map((col) => (
                    <th
                      key={col.key}
                      onClick={col.sortable ? () => handleSort(col.key) : undefined}
                      style={{
                        cursor: col.sortable ? 'pointer' : 'default',
                        textAlign: ['recipients', 'sent', 'failed', 'scheduled', 'replies', 'cost'].includes(col.key) ? 'right' : 'left',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {col.label}{sortArrow(col.key)}
                    </th>
                  ))}
                  <th style={{ width: 32 }} />
                </tr>
              </thead>
              <tbody>
                {visibleBroadcasts.map((b) => {
                  const isOpen = expanded.has(b.batchId);
                  const cs = costSummary(b);
                  return (
                    <React.Fragment key={b.batchId}>
                      <tr onClick={() => toggleExpand(b.batchId)} style={{ cursor: 'pointer' }}>
                        {shownCols.includes('date') && (
                  <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                    {(() => { const d = broadcastDate(b); return d ? d.toLocaleString() : '—'; })()}
                    <span
                      className="pill"
                      style={{
                        marginLeft: 6,
                        background: b.overallStatus === 'scheduled' ? 'var(--signal-soft)'
                          : b.overallStatus === 'active' ? 'var(--accent-soft)'
                          : b.overallStatus === 'canceled' ? 'var(--danger-soft)'
                          : undefined,
                        color: b.overallStatus === 'scheduled' ? '#8a6015'
                          : b.overallStatus === 'active' ? 'var(--accent)'
                          : b.overallStatus === 'canceled' ? 'var(--danger)'
                          : undefined,
                      }}
                    >
                      {b.overallStatus === 'scheduled' ? 'Scheduled'
                        : b.overallStatus === 'active' ? 'Active'
                        : b.overallStatus === 'canceled' ? 'Canceled'
                        : 'Completed'}
                    </span>
                  </td>
                )}
                        {shownCols.includes('message') && (
                          <td style={{ fontWeight: 500 }}>
                            <i className={`ti ${METHOD_ICONS[b.singleMethod] || 'ti-send'}`} style={{ marginRight: 6, color: 'var(--ink-faint)' }} />
                            {b.messageTitle || t('label_untitled_message')}
                          </td>
                        )}
                        {shownCols.includes('type') && (
                          <td style={{ fontSize: 13, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
                            {b.singleMethod ? (METHOD_LABELS[b.singleMethod] || b.singleMethod) : t('history_mixed_methods')}
                          </td>
                        )}
                        {shownCols.includes('recipients') && <td style={{ textAlign: 'right', fontSize: 13 }}>{b.total}</td>}
                        {shownCols.includes('sent') && <td style={{ textAlign: 'right', fontSize: 13 }}>{b.counts.sent || ''}</td>}
                        {shownCols.includes('failed') && (
                          <td style={{ textAlign: 'right', fontSize: 13, color: b.counts.failed ? 'var(--danger)' : undefined }}>
                            {b.counts.failed || ''}
                          </td>
                        )}
                        {shownCols.includes('scheduled') && <td style={{ textAlign: 'right', fontSize: 13 }}>{b.counts.scheduled || ''}</td>}
                        {shownCols.includes('replies') && <td style={{ textAlign: 'right', fontSize: 13 }}>{replyCount(b) || ''}</td>}
                        {shownCols.includes('cost') && (
                          <td style={{ textAlign: 'right', fontSize: 13, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                            {cs.total > 0 ? `$${cs.total.toFixed(4)}` : '—'}
                            {cs.pending > 0 && <span style={{ color: 'var(--ink-faint)' }} title={`${cs.pending} still pricing`}> *</span>}
                          </td>
                        )}
                        <td style={{ textAlign: 'right' }}>
                          <i className={`ti ${isOpen ? 'ti-chevron-up' : 'ti-chevron-down'}`} style={{ color: 'var(--ink-faint)' }} />
                        </td>
                      </tr>

                      {isOpen && (
                        <tr>
                          <td colSpan={colCount} style={{ background: 'var(--bg)', padding: 0 }}>
                            <div style={{ padding: '14px 18px', maxHeight: 420, overflowY: 'auto' }}>
                              {b.messageText && (
                                <p style={{ fontSize: 13.5, background: 'var(--surface, #fff)', border: '1px solid var(--line)', borderRadius: 7, padding: '10px 12px', marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                                  {b.messageText}
                                </p>
                              )}
                              {(b.messageAudioUrl || b.messageHasUploadedAudio) && (
                                <audio controls src={audioUrl(b.messageId)} style={{ width: '100%', marginBottom: 12 }} />
                              )}
                              {b.messageHasImage && (
                                <img src={imageUrl(b.messageId)} alt={b.messageTitle || t('type_image')} style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, marginBottom: 12, display: 'block' }} />
                              )}

                              {isAdmin && (cs.total > 0 || cs.pending > 0) && (
                            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
                              <strong style={{ color: 'var(--ink)' }}>${cs.total.toFixed(4)}</strong> across {cs.charged} recipient{cs.charged !== 1 ? 's' : ''}
                              {cs.charged > 0 && ` · avg $${(cs.total / cs.charged).toFixed(4)} each`}
                              {cs.pending > 0 && ` · ${cs.pending} still pricing`}
                            </div>
                          )}

                          {b.overallStatus === 'scheduled' && (
                            <button
                              type="button"
                              className="btn secondary"
                              style={{ marginBottom: 12, padding: '6px 12px', fontSize: 13, color: 'var(--danger)' }}
                              onClick={() => handleCancelBatch(b.batchId)}
                              disabled={cancelingBatch === b.batchId}
                            >
                              <i className="ti ti-x" /> {cancelingBatch === b.batchId ? 'Canceling...' : 'Cancel this broadcast'}
                            </button>
                          )}

                              <div className="list">
                                {b.recipients.map((s) => {
                                  const duration = formatDuration(s.call_duration);
                                  const isReplyOpen = expandedReplyId === s.id;
                                  return (
                                    <div className="row" key={s.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                                        <div
                                          className="row-main"
                                          style={s.reply_text ? { cursor: 'pointer' } : undefined}
                                          onClick={() => s.reply_text && setExpandedReplyId(isReplyOpen ? null : s.id)}
                                        >
                                          <span className="row-title">
                                            <i className={`ti ${METHOD_ICONS[s.effective_method] || 'ti-send'}`} style={{ marginRight: 6, color: 'var(--ink-faint)' }} />
                                            {s.contact_name || s.phone_number}
                                            <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}> · {METHOD_LABELS[s.effective_method] || s.effective_method}</span>
                                            {s.reply_text && <span className="pill signal" style={{ marginLeft: 8 }}>{t('history_replied_pill')}</span>}
                                          </span>
                                          <span className="row-sub">
                                            {s.phone_number}
                                            {s.delivery_status && ` · ${DELIVERY_LABELS[s.delivery_status] || s.delivery_status}`}
                                            {duration && ` · ${duration}`}
                                            {s.answered_by && ` · ${ANSWERED_BY_LABELS[s.answered_by] || s.answered_by}`}
                                            {isAdmin && s.cost && ` · $${Math.abs(parseFloat(s.cost)).toFixed(4)}`}
                                          </span>
                                          {s.error_message && <span className="row-sub" style={{ color: 'var(--danger)' }}>{s.error_message}</span>}
                                        </div>
                                        <div className="row-actions">
                                          <span className="pill" style={s.status === 'failed' ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : undefined}>
                                            {s.status === 'sent' ? t('status_sent') : s.status}
                                          </span>
                                          <button className="icon-btn danger" onClick={() => handleDeleteRecipient(s.id)} aria-label={t('aria_delete_record')}><i className="ti ti-trash" /></button>
                                        </div>
                                      </div>
                                      {isReplyOpen && (
                                        <div
                                          style={{ fontSize: 12.5, background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 6, padding: '8px 10px', margin: '8px 0 0', cursor: 'pointer' }}
                                          onClick={() => onOpenConversation(s.contact_id)}
                                        >
                                          <strong>{s.contact_name || s.phone_number} {t('history_replied_pill').toLowerCase()}:</strong> {s.reply_text.split(' ').slice(0, 12).join(' ')}{s.reply_text.split(' ').length > 12 ? '…' : ''}
                                          <span style={{ display: 'block', marginTop: 4, textDecoration: 'underline' }}>{t('history_continue_conversation')}</span>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
