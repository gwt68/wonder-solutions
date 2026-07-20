import React, { useEffect, useState } from 'react';
import { api, audioUrl, imageUrl } from '../api.js';
import { groupSendsIntoBroadcasts } from '../broadcastUtils.js';

const DELIVERY_LABELS = {
  queued: 'Queued', sending: 'Sending', sent: 'Sent', delivered: 'Delivered', undelivered: 'Undelivered', failed: 'Failed',
  initiated: 'Calling', ringing: 'Ringing', 'in-progress': 'In progress', answered: 'Answered',
  completed: 'Completed', busy: 'Busy', 'no-answer': 'No answer', canceled: 'Canceled',
};

const ANSWERED_BY_LABELS = {
  human: 'Person answered',
  machine_start: 'Voicemail',
  machine_end_beep: 'Voicemail',
  machine_end_silence: 'Voicemail',
  machine_end_other: 'Voicemail',
  fax: 'Fax machine',
  unknown: 'Unknown',
};

const METHOD_LABELS = { sms: 'Text', call: 'Phone call', voice_note: 'Voice note' };
const METHOD_ICONS = { sms: 'ti-message', call: 'ti-phone', voice_note: 'ti-microphone' };


function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function History() {
  const [sends, setSends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(new Set());

  async function load() {
    setLoading(true);
    try {
      setSends(await api.sends.list());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDeleteRecipient(id) {
    if (!confirm('Remove this recipient from the record?')) return;
    try {
      await api.sends.remove(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleExpand(batchId) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(batchId)) next.delete(batchId); else next.add(batchId);
      return next;
    });
  }

  const broadcasts = groupSendsIntoBroadcasts(sends);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>History</h1>
          <p>What's been sent and scheduled, grouped by broadcast</p>
        </div>
        <button className="btn secondary" onClick={load}><i className="ti ti-refresh" /> Refresh</button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {loading ? (
        <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
      ) : broadcasts.length === 0 ? (
        <div className="card empty-state">
          <h3>Nothing sent yet</h3>
          <p>Once you send or schedule a message, it'll show up here.</p>
        </div>
      ) : (
        <div className="list">
          {broadcasts.map((b) => {
            const isOpen = expanded.has(b.batchId);
            const isScheduled = b.counts.scheduled > 0 && !b.counts.sent && !b.counts.failed;
            return (
              <div className="card" key={b.batchId}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', cursor: 'pointer' }}
                  onClick={() => toggleExpand(b.batchId)}
                >
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 14.5 }}>
                      {b.messageTitle || 'Untitled message'}
                      <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}> · {b.singleMethod ? (METHOD_LABELS[b.singleMethod] || b.singleMethod) : 'Mixed methods'}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                      To {b.total} recipient{b.total !== 1 ? 's' : ''}
                      {isScheduled && b.scheduledAt && ` · scheduled for ${new Date(b.scheduledAt).toLocaleString()}`}
                      {!isScheduled && b.latestSentAt && ` · ${new Date(b.latestSentAt).toLocaleString()}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {b.totalCost > 0 && <span className="pill signal">${b.totalCost.toFixed(4)}</span>}
                    {b.counts.sent > 0 && <span className="pill">{b.counts.sent} sent</span>}
                    {b.counts.failed > 0 && <span className="pill" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>{b.counts.failed} failed</span>}
                    {b.counts.scheduled > 0 && <span className="pill signal">{b.counts.scheduled} scheduled</span>}
                    <i className={`ti ${isOpen ? 'ti-chevron-up' : 'ti-chevron-down'}`} style={{ color: 'var(--ink-faint)' }} />
                  </div>
                </div>

                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--line)', padding: '14px 18px' }}>
                    {b.messageText && (
                      <p style={{ fontSize: 13.5, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 7, padding: '10px 12px', marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                        {b.messageText}
                      </p>
                    )}
                    {(b.messageAudioUrl || b.messageHasUploadedAudio) && (
                      <audio controls src={audioUrl(b.messageId)} style={{ width: '100%', marginBottom: 12 }} />
                    )}
                    {b.messageHasImage && (
                      <img src={imageUrl(b.messageId)} alt={b.messageTitle || 'Photo'} style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, marginBottom: 12, display: 'block' }} />
                    )}

                    <div className="list">
                      {b.recipients.map((s) => {
                        const duration = formatDuration(s.call_duration);
                        return (
                          <div className="row" key={s.id}>
                            <div className="row-main">
                              <span className="row-title">
                                <i className={`ti ${METHOD_ICONS[s.effective_method] || 'ti-send'}`} style={{ marginRight: 6, color: 'var(--ink-faint)' }} />
                                {s.contact_name || s.phone_number}
                                <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}> · {METHOD_LABELS[s.effective_method] || s.effective_method}</span>
                              </span>
                              <span className="row-sub">
                                {s.phone_number}
                                {s.delivery_status && ` · ${DELIVERY_LABELS[s.delivery_status] || s.delivery_status}`}
                                {duration && ` · ${duration}`}
                                {s.answered_by && ` · ${ANSWERED_BY_LABELS[s.answered_by] || s.answered_by}`}
                                {s.cost && ` · $${parseFloat(s.cost).toFixed(4)}`}
                              </span>
                              {s.error_message && <span className="row-sub" style={{ color: 'var(--danger)' }}>{s.error_message}</span>}
                            </div>
                            <div className="row-actions">
                              <span className="pill" style={s.status === 'failed' ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : undefined}>
                                {s.status === 'sent' ? 'Sent' : s.status}
                              </span>
                              <button className="icon-btn danger" onClick={() => handleDeleteRecipient(s.id)} aria-label="Delete record"><i className="ti ti-trash" /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
