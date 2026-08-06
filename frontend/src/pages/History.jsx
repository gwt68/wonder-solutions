import React, { useEffect, useState } from 'react';
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

export default function History({ onNavigateToConversation }) {
  const DELIVERY_LABELS = getDeliveryLabels();
  const ANSWERED_BY_LABELS = getAnsweredByLabels();
  const METHOD_LABELS = getMethodLabels();
  const [sends, setSends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(new Set());
  const [expandedReplyId, setExpandedReplyId] = useState(null);

  function onOpenConversation(contactId) {
    if (onNavigateToConversation) onNavigateToConversation(contactId);
  }

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
    if (!confirm(t('history_confirm_remove_recipient'))) return;
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1>{t('history_title')}</h1>
          <p>{t('history_subtitle')}</p>
        </div>
        <button className="btn secondary" onClick={load}><i className="ti ti-refresh" /> {t('history_refresh')}</button>
      </div>

      <div style={{ flexShrink: 0 }}>
      {error && <div className="banner error">{error}</div>}
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>

      {loading ? (
        <p style={{ color: 'var(--ink-soft)' }}>{t('send_loading')}</p>
      ) : broadcasts.length === 0 ? (
        <div className="card empty-state">
          <h3>{t('history_empty_title')}</h3>
          <p>{t('history_empty_body')}</p>
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
                      {b.messageTitle || t('label_untitled_message')}
                      <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}> · {b.singleMethod ? (METHOD_LABELS[b.singleMethod] || b.singleMethod) : t('history_mixed_methods')}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                      {tf('history_to_n_recipients', { n: b.total, s: b.total !== 1 ? 's' : '' })}
                      {isScheduled && b.scheduledAt && ` · ${t('history_scheduled_for')} ${new Date(b.scheduledAt).toLocaleString()}`}
                      {!isScheduled && b.latestSentAt && ` · ${new Date(b.latestSentAt).toLocaleString()}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {b.totalCost > 0 && <span className="pill signal">${b.totalCost.toFixed(4)}</span>}
                    {b.counts.sent > 0 && <span className="pill">{b.counts.sent} {t('label_sent')}</span>}
                    {b.counts.failed > 0 && <span className="pill" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>{b.counts.failed} {t('label_failed')}</span>}
                    {b.counts.scheduled > 0 && <span className="pill signal">{b.counts.scheduled} {t('label_scheduled_pill')}</span>}
                    <i className={`ti ${isOpen ? 'ti-chevron-up' : 'ti-chevron-down'}`} style={{ color: 'var(--ink-faint)' }} />
                  </div>
                </div>

                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--line)', padding: '14px 18px', maxHeight: 420, overflowY: 'auto' }}>
                    {b.messageText && (
                      <p style={{ fontSize: 13.5, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 7, padding: '10px 12px', marginBottom: 12, whiteSpace: 'pre-wrap' }}>
                        {b.messageText}
                      </p>
                    )}
                    {(b.messageAudioUrl || b.messageHasUploadedAudio) && (
                      <audio controls src={audioUrl(b.messageId)} style={{ width: '100%', marginBottom: 12 }} />
                    )}
                    {b.messageHasImage && (
                      <img src={imageUrl(b.messageId)} alt={b.messageTitle || t('type_image')} style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, marginBottom: 12, display: 'block' }} />
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
                                  {s.cost && ` · $${parseFloat(s.cost).toFixed(4)}`}
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
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}