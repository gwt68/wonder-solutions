import React, { useEffect, useState } from 'react';
import { api, audioUrl, imageUrl, contactDisplayName } from '../api.js';
import { t, tf } from '../i18n.js';

function getMethodLabels() {
  return { sms: t('method_sms').split(' ')[0], call: t('method_call'), voice_note: t('method_voice_note') };
}
function getMethodOptions() {
  return [
    { value: 'sms', label: t('type_sms')     { value: 'call', label: t('channel_call_label') },
    { value: 'voice_note', label: t('type_voice_note') },
  ];
}

export default function SendForm({ message, onSent, channel }) {
  const [groupPrefixMode, setGroupPrefixMode] = useState('never');
  const [activeGroupContext, setActiveGroupContext] = useState(null);
  const [includePrefixChoice, setIncludePrefixChoice] = useState(null); // null = not yet answered
  const [addedGroups, setAddedGroups] = useState([]);
  const METHOD_LABELS = getMethodLabels();
  const METHOD_OPTIONS = getMethodOptions();
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
  const [searchQuery, setSearchQuery] = useState('');

  const messageHasAudio = !!(message.audio_url || message.has_uploaded_audio);
  const messageHasImage = !!message.has_image;

  useEffect(() => {
    Promise.all([api.contacts.list(), api.groups.list(), api.settings.getGroupPrefixMode()])
      .then(([c, g, gp]) => { setContacts(c); setGroups(g); setGroupPrefixMode(gp.mode); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function contactMethods(c) {
    return c.methods && c.methods.length ? c.methods : [c.preferred_method];
  }

  function contactSortName(c) {
    return (contactDisplayName(c) || '').toLowerCase();
  }

  const visibleContacts = React.useMemo(() => {
    let list = contacts;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((c) =>
        contactSortName(c).includes(q) || (c.phone_number || '').includes(q)
      );
    }
    return [...list].sort((a, b) => contactSortName(a).localeCompare(contactSortName(b)));
  }, [contacts, searchQuery]);

  function toggleContact(c) {
    if (channel && !contactMethods(c).includes(channel)) return; // can't select a contact who isn't enabled for this channel
    setActiveGroupContext(null); // manual change breaks the "this is a clean group send" assumption
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(c.id)) next.delete(c.id);
      else next.set(c.id, new Set([channel || c.preferred_method]));
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
    setActiveGroupContext(null);
    setAddedGroups([]);
    const eligible = channel ? contacts.filter((c) => contactMethods(c).includes(channel)) : contacts;
    setSelected(new Map(eligible.map((c) => [c.id, new Set([channel || c.preferred_method])])));
  }

  function unselectAll() {
    setActiveGroupContext(null);
    setAddedGroups([]);
    setSelected(new Map());
  }
  async function handleAddGroup(group) 
    setGroupLoading(group.id);
    setError('');
    try {
      const members = await api.groups.contacts(group.id);
      const eligible = channel ? members.filter((c) => contactMethods(c).includes(channel)) : members;
      // Only treat this as a clean "group send" if the selection was empty
      // before — mixing in an existing selection makes the prefix ambiguous.
      const isCleanGroupSend = selected.size === 0;
      setSelected((prev) => {
        const next = new Map(prev);
        eligible.forEach((c) => { if (!next.has(c.id)) next.set(c.id, new Set([channel || c.preferred_method])); });
        return next;
      });
      setActiveGroupContext(isCleanGroupSend ? group : null);
      setAddedGroups((prev) => (prev.some((g) => g.id === group.id) ? prev : [...prev, group]));
      setIncludePrefixChoice(
        groupPrefixMode === 'always' ? true : groupPrefixMode === 'never' ? false : null
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setGroupLoading(null);
    }
  }

  function goToPreview() {
    if (!selected.size) { setError(t('sf_select_at_least_one')); return; }
    if (scheduleEnabled && !scheduledAt) { setError(t('sf_choose_schedule_date')); return; }
    setError('');
    setStep('preview');
  }

  async function handleConfirmSend() {
    setSending(true);
    setError('');
    try {
      let effectiveMessageId = message.id;
      const shouldPrefix = activeGroupContext && message.text_content && (
        groupPrefixMode === 'always' || (groupPrefixMode === 'ask' && includePrefixChoice === true)
      );
      if (shouldPrefix) {
        const prefixed = `${activeGroupContext.name}: ${message.text_content}`;
        const cloned = await api.messages.cloneWithCaption(message.id, prefixed, message.title);
        effectiveMessageId = cloned.id;
      }

      const recipients = [...selected.entries()].map(([contact_id, methods]) => ({
        contact_id,
        methods: [...methods],
      }));
      const res = await api.sends.create({
        message_id: effectiveMessageId,
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

  if (loading) return <p style={{ color: 'var(--ink-soft)' }}>{t('send_loading')}</p>;

  if (result) {
    if (result.scheduled) {
      return (
        <div className="banner ok">
          {tf('sf_scheduled_for_n', { n: result.count, s: result.count !== 1 ? 's' : '' })}
        </div>
      );
    }

    const failed = (result.sends || []).filter((s) => s.status === 'failed');
    const succeeded = result.count - failed.length;

    return (
      <div>
        {succeeded > 0 && (
          <div className="banner ok">
            {tf('sf_sent_to_n', { n: succeeded, s: succeeded !== 1 ? 's' : '' })}
          </div>
        )}
        {failed.length > 0 && (
          <div className="banner error">
            <strong>{tf('sf_failed_n', { n: failed.length })}</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {failed.map((s) => (
                <li key={s.id} style={{ fontSize: 13 }}>
                  {s.error_message || t('sf_unknown_error')}
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
    const recipientNames = selectedContacts
      .map((c) => contactDisplayName(c) || c.phone_number)
      .join('\n');
    const prefixApplies = !!(activeGroupContext && message.text_content);
    const prefixUnanswered = prefixApplies && groupPrefixMode === 'ask' && includePrefixChoice === null;
    const prefixWillSend = prefixApplies && includePrefixChoice === true;
    const methodCounts = {};
    for (const methods of selected.values()) {
      for (const m of methods) methodCounts[m] = (methodCounts[m] || 0) + 1;
    }

    return (
      <div>
        {error && <div className="banner error">{error}</div>}
        <div className="card" style={{ padding: 16, marginBottom: 16, background: 'var(--bg)' }}>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 4 }}>{t('send_sending_label')}</p>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>{message.title || t('label_untitled_message')}</p>

          {message.text_content && (
            <p style={{ fontSize: 14, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 7, padding: '10px 12px', marginBottom: 12, whiteSpace: 'pre-wrap' }}>
              {message.text_content}
            </p>
          )}
          {messageHasAudio && (
            <audio controls src={audioUrl(message.id)} style={{ width: '100%', marginBottom: 12 }} />
          )}
          {messageHasImage && (
            <img src={imageUrl(message.id)} alt={message.title || t('type_image')} style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 8, marginBottom: 12, display: 'block' }} />
          )}

          <p
            title={recipientNames}
            style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 4, cursor: 'help', textDecoration: 'underline dotted', textUnderlineOffset: 3 }}
          >
            {tf('sf_to_n_recipients', { n: selectedContacts.length, s: selectedContacts.length !== 1 ? 's' : '' })}
            {addedGroups.length > 0 && (
              <> · {addedGroups.length} {addedGroups.length === 1 ? 'group' : 'groups'} ({addedGroups.map((g) => g.name).join(', ')})</>
            )}
          </p>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {Object.entries(methodCounts).map(([method, count]) => (
              <span className="pill" key={method}>{count} {METHOD_LABELS[method] || method}</span>
            ))}
          </div>

          <div style={{ maxHeight: 140, overflowY: 'auto', fontSize: 13, color: 'var(--ink-soft)', marginBottom: 12 }}>
            {selectedContacts.map((c) => (
              <div key={c.id}>
                {contactDisplayName(c) || c.phone_number} — {[...selected.get(c.id)].map((m) => METHOD_LABELS[m]).join(' + ')}
              </div>
            ))}
          </div>

          <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            {scheduleEnabled
              ? tf('sf_scheduled_for_date', { date: new Date(scheduledAt).toLocaleString() })
              : t('sf_sending_immediately')}
          </p>

          {prefixUnanswered ? (
            <div style={{
              marginTop: 12, padding: '14px 16px', borderRadius: 8,
              border: '2px solid var(--accent)', background: 'var(--accent-soft)',
            }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                Start the message with "{activeGroupContext.name}:"?
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 10 }}>
                Choose one before sending.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" style={{ padding: '7px 16px', fontSize: 13 }} onClick={() => setIncludePrefixChoice(true)}>
                  Yes, include it
                </button>
                <button type="button" className="btn secondary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={() => setIncludePrefixChoice(false)}>
                  No, send as is
                </button>
              </div>
            </div>
          ) : (
            <div style={{
              marginTop: 12, padding: '10px 12px', borderRadius: 7, fontSize: 13,
              background: 'var(--surface)', border: '1px solid var(--line)',
            }}>
              {prefixWillSend ? (
                <>Sending <strong>with</strong> the group label — starts with "{activeGroupContext.name}:"</>
              ) : prefixApplies ? (
                <>
                  Sending <strong>without</strong> the group label.
                  {groupPrefixMode === 'ask' && (
                    <button
                      type="button"
                      onClick={() => setIncludePrefixChoice(null)}
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer', marginLeft: 6, padding: 0 }}
                    >
                      Change
                    </button>
                  )}
                </>
              ) : (
                <>Sending <strong>without</strong> a group label.</>
              )}
            </div>
          )}
        </div>

        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn secondary" onClick={() => setStep('select')} disabled={sending}>{t('send_back')}</button>
          <button type="button" className="btn" onClick={handleConfirmSend} disabled={sending || prefixUnanswered}>
            {sending ? t('sf_working') : scheduleEnabled ? t('sf_confirm_schedule') : t('sf_confirm_send')}
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
          <label>{t('sf_add_whole_group')}</label>
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
                {groupLoading === g.id ? t('sf_adding') : `+ ${g.name} (${g.member_count})`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label style={{ margin: 0 }}>{tf('sf_contacts_n_selected', { n: selected.size })}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={selectAll} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer' }}>{t('contacts_select_all')}</button>
            <button type="button" onClick={unselectAll} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer' }}>{t('contacts_unselect_all')}</button>
          </div>
        </div>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 7, padding: '10px 12px', marginBottom: 10, fontSize: 12.5, color: 'var(--ink-soft)' }}>
          <div><strong style={{ color: 'var(--ink)' }}>{t('channel_call_label')}</strong> — {t('sf_call_desc')}</div>
          <div><strong style={{ color: 'var(--ink)' }}>{t('type_voice_note')}</strong> — {t('sf_voice_note_desc')}</div>
          <div><strong style={{ color: 'var(--ink)' }}>{t('type_sms')}</strong> — {t('sf_text_desc')}</div>
        </div>
        <div className="field" style={{ marginBottom: 8 }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('sf_search_placeholder')}
          />
        </div>
        <div style={{ maxHeight: 300, overflowY: 'auto', overflowX: 'hidden', border: '1px solid var(--line)', borderRadius: 7 }}>
          {contacts.length === 0 ? (
            <p style={{ padding: 12, fontSize: 13, color: 'var(--ink-soft)' }}>{t('sf_no_contacts')}</p>
          ) : visibleContacts.length === 0 ? (
            <p style={{ padding: 12, fontSize: 13, color: 'var(--ink-soft)' }}>{t('sf_no_match')}</p>
          ) : (
            visibleContacts.map((c) => {
              const isSelected = selected.has(c.id);
              const activeMethods = selected.get(c.id) || new Set();
              const methods = contactMethods(c);
              return (
                <div
                  key={c.id}
                  style={{
                    display: 'grid', gridTemplateColumns: '20px 150px 1fr', alignItems: 'center', gap: 10,
                    padding: '9px 12px', borderBottom: '1px solid var(--line)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={channel && !methods.includes(channel)}
                    onChange={() => toggleContact(c)}
                  />
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{contactDisplayName(c) || t('sf_unnamed_contact')}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-faint)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.phone_number}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {methods.map((m) => {
                      const isActive = isSelected && activeMethods.has(m);
                      const disabled =
                        (m === 'voice_note' && !messageHasAudio && !messageHasImage) ||
                        (m === 'sms' && !message.text_content) ||
                        (m === 'call' && !messageHasAudio && !message.text_content);
                      const disabledReason =
                        m === 'voice_note' ? t('sf_disabled_voice_note')
                        : m === 'sms' ? t('sf_disabled_sms')
                        : t('sf_disabled_call');
                      const methodExplanation =
                        m === 'call' ? t('sf_method_call_short')
                        : m === 'voice_note' ? t('sf_method_voice_note_short')
                        : t('sf_method_sms_short');
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
        {t('sf_schedule_checkbox')}
      </div>

      {scheduleEnabled && (
        <div className="field">
          <label>{t('sf_send_at')}</label>
          <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
        </div>
      )}

      <button type="button" className="btn" onClick={goToPreview} style={{ width: '100%' }}>
        {t('sf_review_continue')}
      </button>
    </div>
  );
}