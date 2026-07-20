import React, { useEffect, useState } from 'react';
import { api, audioUrl, imageUrl } from '../api.js';

const METHOD_LABELS = { sms: 'text', call: 'phone call', voice_note: 'voice note' };
const METHOD_OPTIONS = [
  { value: 'sms', label: 'Text' },
  { value: 'call', label: 'Phone call' },
  { value: 'voice_note', label: 'Voice note' },
];

export default function SendForm({ message, onSent }) {
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(new Map()); // contactId -> Set of methods
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [step, setStep] = useState('select'); // 'select' | 'preview'
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [groupLoading, setGroupLoading] = useState(null);

  const messageHasAudio = !!(message.audio_url || message.has_uploaded_audio);
  const messageHasImage = !!message.has_image;

  useEffect(() => {
    Promise.all([api.contacts.list(), api.groups.list()])
      .then(([c, g]) => { setContacts(c); setGroups(g); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function contactMethods(c) {
    return c.methods && c.methods.length ? c.methods : [c.preferred_method];
  }

  function toggleContact(c) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(c.id)) next.delete(c.id);
      else next.set(c.id, new Set([c.preferred_method]));
      return next;
    });
  }

  function toggleMethodForContact(c, method) {
    setSelected((prev) => {
      const next = new Map(prev);
      const current = new Set(next.get(c.id) || []);
      if (current.has(method)) {
        current.delete(method);
      } else {
        current.add(method);
      }
      if (current.size === 0) {
        next.delete(c.id); // unchecking their last method removes them from the send entirely
      } else {
        next.set(c.id, current);
      }
      return next;
    });
  }

  function selectAll() {
    setSelected(new Map(contacts.map((c) => [c.id, new Set([c.preferred_method])])));
  }

  function unselectAll() {
    setSelected(new Map());
  }

  async function handleAddGroup(group) {
    setGroupLoading(group.id);
    setError('');
    try {
      const members = await api.groups.contacts(group.id);
      setSelected((prev) => {
        const next = new Map(prev);
        members.forEach((c) => { if (!next.has(c.id)) next.set(c.id, new Set([c.preferred_method])); });
        return next;
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setGroupLoading(null);
    }
  }

  function goToPreview() {
    if (!selected.size) { setError('Select at least one contact'); return; }
    if (scheduleEnabled && !scheduledAt) { setError('Choose a date and time to schedule for'); return; }
    setError('');
    setStep('preview');
  }

  async function handleConfirmSend() {
    setSending(true);
    setError('');
    try {
      const recipients = [...selected.entries()].map(([contact_id, methods]) => ({
        contact_id,
        methods: [...methods],
      }));
      const res = await api.sends.create({
        message_id: message.id,
        recipients,
        scheduled_at: scheduleEnabled ? new Date(scheduledAt).toISOString() : null,
      });
      setResult(res);
      if (onSent) onSent(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  if (loading) return <p style={{ color: 'var(--ink-soft)' }}>Loading contacts...</p>;

  if (result) {
    if (result.scheduled) {
      return (
        <div className="banner ok">
          Scheduled for {result.count} recipient{result.count !== 1 ? 's' : ''}.
        </div>
      );
    }

    const failed = (result.sends || []).filter((s) => s.status === 'failed');
    const succeeded = result.count - failed.length;

    return (
      <div>
        {succeeded > 0 && (
          <div className="banner ok">
            Sent to {succeeded} recipient{succeeded !== 1 ? 's' : ''}.
          </div>
        )}
        {failed.length > 0 && (
          <div className="banner error">
            <strong>{failed.length} failed to send:</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {failed.map((s) => (
                <li key={s.id} style={{ fontSize: 13 }}>
                  {s.error_message || 'Unknown error'}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (step === 'preview') {
    const selectedContacts = contacts.filter((c) => selected.has(c.id));
    const methodCounts = {};
    for (const methods of selected.values()) {
      for (const m of methods) methodCounts[m] = (methodCounts[m] || 0) + 1;
    }

    return (
      <div>
        {error && <div className="banner error">{error}</div>}
        <div className="card" style={{ padding: 16, marginBottom: 16, background: 'var(--bg)' }}>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 4 }}>Sending</p>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>{message.title || 'Untitled message'}</p>

          {message.text_content && (
            <p style={{ fontSize: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 7, padding: '10px 12px', marginBottom: 12, whiteSpace: 'pre-wrap' }}>
              {message.text_content}
            </p>
          )}
          {messageHasAudio && (
            <audio controls src={audioUrl(message.id)} style={{ width: '100%', marginBottom: 12 }} />
          )}
          {messageHasImage && (
            <img src={imageUrl(message.id)} alt={message.title || 'Photo'} style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, marginBottom: 12, display: 'block' }} />
          )}

          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 4 }}>To {selectedContacts.length} recipient{selectedContacts.length !== 1 ? 's' : ''}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {Object.entries(methodCounts).map(([method, count]) => (
              <span className="pill" key={method}>{count} by {METHOD_LABELS[method] || method}</span>
            ))}
          </div>

          <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 13, color: 'var(--ink-soft)', marginBottom: 12 }}>
            {selectedContacts.map((c) => (
              <div key={c.id}>
                {c.name || c.phone_number} — {[...selected.get(c.id)].map((m) => METHOD_LABELS[m]).join(' + ')}
              </div>
            ))}
          </div>

          <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            {scheduleEnabled
              ? `Scheduled for ${new Date(scheduledAt).toLocaleString()}`
              : 'Sending immediately'}
          </p>
        </div>

        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn secondary" onClick={() => setStep('select')} disabled={sending}>Back</button>
          <button type="button" className="btn" onClick={handleConfirmSend} disabled={sending}>
            {sending ? 'Working...' : scheduleEnabled ? 'Confirm & schedule' : 'Confirm & send'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="banner error">{error}</div>}

      {groups.length > 0 && (
        <div className="field">
          <label>Add a whole group</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                className="btn secondary"
                style={{ padding: '6px 12px', fontSize: 13 }}
                onClick={() => handleAddGroup(g)}
                disabled={groupLoading === g.id}
              >
                {groupLoading === g.id ? 'Adding...' : `+ ${g.name} (${g.member_count})`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label style={{ margin: 0 }}>Contacts ({selected.size} selected)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={selectAll} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer' }}>Select all</button>
            <button type="button" onClick={unselectAll} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer' }}>Unselect all</button>
          </div>
        </div>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 7, padding: '10px 12px', marginBottom: 10, fontSize: 12.5, color: 'var(--ink-soft)' }}>
          <div><strong style={{ color: 'var(--ink)' }}>Phone call</strong> — rings their phone and plays or speaks the message out loud</div>
          <div><strong style={{ color: 'var(--ink)' }}>Voice note</strong> — sends a text message with the audio or photo attached, no call</div>
          <div><strong style={{ color: 'var(--ink)' }}>Text</strong> — sends a plain text message</div>
        </div>
        <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 7 }}>
          {contacts.length === 0 ? (
            <p style={{ padding: 12, fontSize: 13, color: 'var(--ink-soft)' }}>No contacts yet.</p>
          ) : (
            contacts.map((c) => {
              const isSelected = selected.has(c.id);
              const activeMethods = selected.get(c.id) || new Set();
              const methods = contactMethods(c);
              return (
                <div
                  key={c.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 12px', borderBottom: '1px solid var(--line)',
                  }}
                >
                  <input type="checkbox" checked={isSelected} onChange={() => toggleContact(c)} style={{ flexShrink: 0 }} />
                  <div style={{ flexShrink: 0, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap' }}>{c.name || 'Unnamed contact'}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{c.phone_number}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: 'auto' }}>
                    {methods.map((m) => {
                      const isActive = isSelected && activeMethods.has(m);
                      const disabled =
                        (m === 'voice_note' && !messageHasAudio && !messageHasImage) ||
                        (m === 'sms' && !message.text_content) ||
                        (m === 'call' && !messageHasAudio && !message.text_content);
                      const disabledReason =
                        m === 'voice_note' ? 'This message has no audio or photo to send as an MMS'
                        : m === 'sms' ? 'This message has no text to send'
                        : 'This message has nothing to play or say on a call';
                      const methodExplanation =
                        m === 'call' ? 'Rings their phone and plays/speaks the message'
                        : m === 'voice_note' ? 'Sends a text with the audio/photo attached, no call'
                        : 'Sends a plain text message';
                      return (
                        <button
                          key={m}
                          type="button"
                          disabled={disabled}
                          onClick={() => toggleMethodForContact(c, m)}
                          className={`method-toggle ${isActive ? 'active' : ''}`}
                          title={disabled ? disabledReason : methodExplanation}
                        >
                          {isActive && <i className="ti ti-check" />}
                          {METHOD_OPTIONS.find((o) => o.value === m)?.label || m}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="checkbox-row" style={{ margin: '14px 0' }}>
        <input type="checkbox" checked={scheduleEnabled} onChange={(e) => setScheduleEnabled(e.target.checked)} />
        Schedule for later instead of sending now
      </div>

      {scheduleEnabled && (
        <div className="field">
          <label>Send at</label>
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </div>
      )}

      <button type="button" className="btn" onClick={goToPreview} style={{ width: '100%' }}>
        Review & continue
      </button>
    </div>
  );
}
