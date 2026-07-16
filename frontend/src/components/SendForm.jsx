import React, { useEffect, useState } from 'react';
import { api, audioUrl } from '../api.js';

const METHOD_LABELS = { sms: 'text', call: 'phone call', voice_note: 'voice note' };
const METHOD_OPTIONS = [
  { value: 'sms', label: 'Text' },
  { value: 'call', label: 'Phone call' },
  { value: 'voice_note', label: 'Voice note' },
];

export default function SendForm({ message, onSent }) {
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(new Map()); // contactId -> { method, alsoVoiceNote }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [step, setStep] = useState('select'); // 'select' | 'preview'
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [groupLoading, setGroupLoading] = useState(null);

  const messageHasAudio = !!(message.audio_url || message.has_uploaded_audio);

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
      else next.set(c.id, { method: c.preferred_method, alsoVoiceNote: false });
      return next;
    });
  }

  function setContactMethod(contactId, method) {
    setSelected((prev) => {
      const next = new Map(prev);
      const current = next.get(contactId) || {};
      next.set(contactId, { ...current, method, alsoVoiceNote: method === 'call' ? current.alsoVoiceNote : false });
      return next;
    });
  }

  function toggleAlsoVoiceNote(contactId) {
    setSelected((prev) => {
      const next = new Map(prev);
      const current = next.get(contactId);
      if (!current) return prev;
      next.set(contactId, { ...current, alsoVoiceNote: !current.alsoVoiceNote });
      return next;
    });
  }

  function selectAll() {
    setSelected(new Map(contacts.map((c) => [c.id, { method: c.preferred_method, alsoVoiceNote: false }])));
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
        members.forEach((c) => { if (!next.has(c.id)) next.set(c.id, { method: c.preferred_method, alsoVoiceNote: false }); });
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
      const recipients = [...selected.entries()].map(([contact_id, v]) => ({
        contact_id,
        method: v.method,
        also_voice_note: v.method === 'call' && v.alsoVoiceNote,
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
    return (
      <div className="banner ok">
        {result.scheduled
          ? `Scheduled for ${result.count} recipient${result.count !== 1 ? 's' : ''}.`
          : `Sent to ${result.count} recipient${result.count !== 1 ? 's' : ''}.`}
      </div>
    );
  }

  if (step === 'preview') {
    const selectedContacts = contacts.filter((c) => selected.has(c.id));
    const methodCounts = [...selected.values()].reduce((acc, v) => {
      acc[v.method] = (acc[v.method] || 0) + 1;
      if (v.method === 'call' && v.alsoVoiceNote) acc.voice_note = (acc.voice_note || 0) + 1;
      return acc;
    }, {});

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

          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 4 }}>To {selectedContacts.length} recipient{selectedContacts.length !== 1 ? 's' : ''}</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {Object.entries(methodCounts).map(([method, count]) => (
              <span className="pill" key={method}>{count} by {METHOD_LABELS[method] || method}</span>
            ))}
          </div>

          <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 13, color: 'var(--ink-soft)', marginBottom: 12 }}>
            {selectedContacts.map((c) => {
              const v = selected.get(c.id);
              return (
                <div key={c.id}>
                  {c.name || c.phone_number} — {METHOD_LABELS[v.method]}
                  {v.method === 'call' && v.alsoVoiceNote ? ' + voice note' : ''}
                </div>
              );
            })}
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
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 7 }}>
          {contacts.length === 0 ? (
            <p style={{ padding: 12, fontSize: 13, color: 'var(--ink-soft)' }}>No contacts yet.</p>
          ) : (
            contacts.map((c) => {
              const isSelected = selected.has(c.id);
              const sel = selected.get(c.id);
              const methods = contactMethods(c);
              return (
                <div key={c.id} style={{ borderBottom: '1px solid var(--line)', padding: '9px 12px' }}>
                  <label className="checkbox-row" style={{ fontSize: 13.5 }}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleContact(c)} />
                    <span style={{ flex: 1 }}>{c.name || c.phone_number}</span>
                    {!isSelected && (
                      <span style={{ color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{METHOD_LABELS[c.preferred_method]}</span>
                    )}
                  </label>
                  {isSelected && methods.length > 1 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, marginLeft: 24, flexWrap: 'wrap' }}>
                      {methods.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setContactMethod(c.id, m)}
                          className={sel.method === m ? 'pill' : 'pill signal'}
                          style={{ border: 'none', cursor: 'pointer' }}
                        >
                          {METHOD_OPTIONS.find((o) => o.value === m)?.label || m}
                        </button>
                      ))}
                    </div>
                  )}
                  {isSelected && methods.length === 1 && (
                    <div style={{ marginLeft: 24, marginTop: 4, fontSize: 12, color: 'var(--ink-faint)' }}>
                      Will send as {METHOD_LABELS[methods[0]]} (only method available)
                    </div>
                  )}
                  {isSelected && sel.method === 'call' && messageHasAudio && (
                    <label className="checkbox-row" style={{ marginLeft: 24, marginTop: 6, fontSize: 12.5, color: 'var(--ink-soft)' }}>
                      <input
                        type="checkbox"
                        checked={!!sel.alsoVoiceNote}
                        onChange={() => toggleAlsoVoiceNote(c.id)}
                      />
                      Also send as a voice note (MMS)
                    </label>
                  )}
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
