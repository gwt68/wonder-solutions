import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import PasswordInput from '../components/PasswordInput.jsx';
import { t } from '../i18n.js';

// ---------- layout pieces ----------

function Group({ title, children }) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h3 style={{
        fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em',
        color: 'var(--ink-faint)', margin: '0 0 8px 2px', fontWeight: 600,
      }}>
        {title}
      </h3>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>{children}</div>
    </section>
  );
}

// One setting: name and explanation on the left, the control on the right.
// `below` is for a form that opens underneath the row.
function Row({ title, description, children, below, last }) {
  return (
    <div style={{ borderBottom: last ? 'none' : '1px solid var(--line)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 18, padding: '13px 16px', flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 180, flex: '1 1 240px' }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{title}</div>
          {description && (
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2, lineHeight: 1.45 }}>
              {description}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {children}
        </div>
      </div>
      {below && (
        <div style={{ padding: '0 16px 14px', background: 'var(--bg)' }}>
          {below}
        </div>
      )}
    </div>
  );
}

function CurrentValue({ children }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>{children}</span>
  );
}

function Note({ kind, children }) {
  if (!children) return null;
  const color = kind === 'error' ? 'var(--danger)' : 'var(--accent)';
  return (
    <p style={{ fontSize: 12.5, color, margin: '0 0 10px' }}>{children}</p>
  );
}

// ---------- page ----------

export default function Settings() {
  const isGroupsTier =
    import.meta.env.VITE_PORTAL === 'groups' ||
    (localStorage.getItem('wonder_account_type') || 'full') === 'groups';

  const [open, setOpen] = useState(null); // which inline form is showing

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinLoading, setPinLoading] = useState(true);
  const [pinError, setPinError] = useState('');
  const [pinSuccess, setPinSuccess] = useState('');
  const [pinSaving, setPinSaving] = useState(false);

  const [currentUsername, setCurrentUsername] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [userLoading, setUserLoading] = useState(true);
  const [userError, setUserError] = useState('');
  const [userSuccess, setUserSuccess] = useState('');
  const [userSaving, setUserSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const [twilioNumber, setTwilioNumber] = useState(null);

  const [trustedPhones, setTrustedPhones] = useState([]);
  const [tpLoading, setTpLoading] = useState(true);
  const [newTpNumber, setNewTpNumber] = useState('');
  const [newTpLabel, setNewTpLabel] = useState('');
  const [tpError, setTpError] = useState('');
  const [tpSuccess, setTpSuccess] = useState('');
  const [addingTp, setAddingTp] = useState(false);

  useEffect(() => {
    api.account.get()
      .then((r) => setCurrentUsername(r.username))
      .catch((e) => setUserError(e.message))
      .finally(() => setUserLoading(false));
    api.settings.getTwilioNumber().then((r) => setTwilioNumber(r.number)).catch(() => {});

    if (!isGroupsTier) {
      api.settings.getPin()
        .then((r) => setCurrentPin(r.pin))
        .catch((e) => setPinError(e.message))
        .finally(() => setPinLoading(false));
      loadTrustedPhones();
    } else {
      setPinLoading(false);
      setTpLoading(false);
    }
  }, []);

  function toggle(key) {
    setOpen((o) => (o === key ? null : key));
  }

  async function loadTrustedPhones() {
    setTpLoading(true);
    try {
      setTrustedPhones(await api.trustedPhones.list());
    } catch (err) {
      setTpError(err.message);
    } finally {
      setTpLoading(false);
    }
  }

  async function handleAddTrustedPhone(e) {
    e.preventDefault();
    setTpError(''); setTpSuccess(''); setAddingTp(true);
    try {
      await api.trustedPhones.add(newTpNumber, newTpLabel || null);
      setNewTpNumber('');
      setNewTpLabel('');
      setTpSuccess(t('settings_number_added'));
      await loadTrustedPhones();
    } catch (err) {
      setTpError(err.message);
    } finally {
      setAddingTp(false);
    }
  }

  async function handleRemoveTrustedPhone(id) {
    if (!confirm(t('settings_confirm_remove_number'))) return;
    setTpError('');
    try {
      await api.trustedPhones.remove(id);
      await loadTrustedPhones();
    } catch (err) {
      setTpError(err.message);
    }
  }

  async function handleSavePin(e) {
    e.preventDefault();
    setPinError(''); setPinSuccess(''); setPinSaving(true);
    try {
      await api.settings.setPin(newPin);
      setCurrentPin(newPin);
      setNewPin('');
      setPinSuccess(t('settings_pin_updated'));
      setOpen(null);
    } catch (err) { setPinError(err.message); } finally { setPinSaving(false); }
  }

  async function handleSaveUsername(e) {
    e.preventDefault();
    setUserError(''); setUserSuccess(''); setUserSaving(true);
    try {
      await api.account.setUsername(newUsername);
      setCurrentUsername(newUsername);
      setNewUsername('');
      setUserSuccess(t('settings_username_updated'));
      setOpen(null);
    } catch (err) { setUserError(err.message); } finally { setUserSaving(false); }
  }

  async function handleSavePassword(e) {
    e.preventDefault();
    setPwError(''); setPwSuccess(''); setPwSaving(true);
    try {
      await api.account.setPassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setPwSuccess(t('settings_password_updated'));
      setOpen(null);
    } catch (err) { setPwError(err.message); } finally { setPwSaving(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1>{t('settings_title')}</h1>
          <p>{t('settings_subtitle')}</p>
        </div>
        {twilioNumber && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{t('settings_sending_number')}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 500 }}>{twilioNumber}</div>
          </div>
        )}
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 720 }}>

          {!isGroupsTier && (
            <Group title={t('settings_phone_line')}>
              <Row
                title={t('settings_call_in_pin')}
                description={t('settings_call_in_pin_desc')}
                below={open === 'pin' && (
                  <form onSubmit={handleSavePin}>
                    <Note kind="error">{pinError}</Note>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                      <div className="field" style={{ marginBottom: 0, flex: '1 1 auto', maxWidth: 220 }}>
                        <label>{t('settings_new_pin')}</label>
                        <input
                          required autoFocus inputMode="numeric" pattern="\d{4,8}"
                          value={newPin} onChange={(e) => setNewPin(e.target.value)}
                          placeholder={t('settings_new_pin_placeholder')}
                        />
                      </div>
                      <button type="submit" className="btn" disabled={pinSaving}>
                        {pinSaving ? t('btn_saving') : 'Save'}
                      </button>
                    </div>
                  </form>
                )}
              >
                {!pinLoading && <CurrentValue>{currentPin}</CurrentValue>}
                {pinSuccess && open !== 'pin' && <Note>{pinSuccess}</Note>}
                <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={() => toggle('pin')}>
                  {open === 'pin' ? 'Cancel' : 'Change'}
                </button>
              </Row>

              <Row
                title="Group message prefix"
                description="When you send to a whole group, start the message with the group's name."
              >
                <GroupPrefixInline />
              </Row>

              <Row
                title="Your time zone"
                description="Used for scheduling, and for the times shown in History."
                last
              >
                <TimezoneInline />
              </Row>
            </Group>
          )}

          <Group title="Conference calls">
            <ConferenceRows />
          </Group>

          <Group title={t('settings_web_portal_access')}>
            <Row
              title={t('settings_username_title')}
              description={t('settings_username_desc')}
              below={open === 'username' && (
                <form onSubmit={handleSaveUsername}>
                  <Note kind="error">{userError}</Note>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <div className="field" style={{ marginBottom: 0, flex: '1 1 auto', maxWidth: 260 }}>
                      <label>{t('settings_new_username')}</label>
                      <input
                        required autoFocus minLength={2}
                        value={newUsername} onChange={(e) => setNewUsername(e.target.value)}
                        placeholder={t('settings_new_username_placeholder')}
                      />
                    </div>
                    <button type="submit" className="btn" disabled={userSaving}>
                      {userSaving ? t('btn_saving') : 'Save'}
                    </button>
                  </div>
                </form>
              )}
            >
              {!userLoading && <CurrentValue>{currentUsername}</CurrentValue>}
              {userSuccess && open !== 'username' && <Note>{userSuccess}</Note>}
              <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={() => toggle('username')}>
                {open === 'username' ? 'Cancel' : 'Change'}
              </button>
            </Row>

            <Row
              title={t('settings_password_title')}
              description={t('settings_password_desc')}
              last
              below={open === 'password' && (
                <form onSubmit={handleSavePassword}>
                  <Note kind="error">{pwError}</Note>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div className="field" style={{ marginBottom: 0, flex: '1 1 200px', maxWidth: 240 }}>
                      <label>Current password</label>
                      <PasswordInput required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                    </div>
                    <div className="field" style={{ marginBottom: 0, flex: '1 1 200px', maxWidth: 240 }}>
                      <label>{t('settings_new_password')}</label>
                      <PasswordInput required minLength={4} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                    </div>
                    <button type="submit" className="btn" disabled={pwSaving}>
                      {pwSaving ? t('btn_saving') : 'Save'}
                    </button>
                  </div>
                </form>
              )}
            >
              {pwSuccess && open !== 'password' && <Note>{pwSuccess}</Note>}
              <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 12.5 }} onClick={() => toggle('password')}>
                {open === 'password' ? 'Cancel' : 'Change'}
              </button>
            </Row>
          </Group>

          {!isGroupsTier && (
            <Group title={t('settings_text_to_save')}>
              <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--line)' }}>
                <p style={{ color: 'var(--ink-soft)', fontSize: 12.5, margin: 0, lineHeight: 1.5 }}>
                  {t('settings_text_to_save_desc')}
                </p>
              </div>

              {!tpLoading && trustedPhones.map((tp) => (
                <div key={tp.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 12, padding: '11px 16px', borderBottom: '1px solid var(--line)',
                }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13.5 }}>{tp.phone_number}</div>
                    {tp.label && <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{tp.label}</div>}
                  </div>
                  <button
                    className="icon-btn danger"
                    onClick={() => handleRemoveTrustedPhone(tp.id)}
                    aria-label={t('aria_remove_number')}
                  >
                    <i className="ti ti-trash" />
                  </button>
                </div>
              ))}

              <div style={{ padding: '13px 16px' }}>
                <Note kind="error">{tpError}</Note>
                <Note>{tpSuccess}</Note>
                <form onSubmit={handleAddTrustedPhone} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="field" style={{ marginBottom: 0, flex: '1 1 180px', maxWidth: 220 }}>
                    <label>{t('settings_phone_number')}</label>
                    <input required value={newTpNumber} onChange={(e) => setNewTpNumber(e.target.value)} placeholder="+19145551234" />
                  </div>
                  <div className="field" style={{ marginBottom: 0, flex: '1 1 180px', maxWidth: 220 }}>
                    <label>{t('settings_label_optional')}</label>
                    <input value={newTpLabel} onChange={(e) => setNewTpLabel(e.target.value)} placeholder={t('settings_label_optional_placeholder')} />
                  </div>
                  <button type="submit" className="btn secondary" disabled={addingTp}>
                    {addingTp ? t('settings_adding') : t('settings_add_number')}
                  </button>
                </form>
              </div>
            </Group>
          )}

          {isGroupsTier && (
            <Group title="Text commands">
              <div style={{ padding: '14px 16px' }}>
                <p style={{ color: 'var(--ink-soft)', fontSize: 12.5, margin: '0 0 10px', lineHeight: 1.5 }}>
                  How messages are worded is set per group, in that group's Settings on the Group Chat tab.
                  Members marked as Admin there can text these to the group number:
                </p>
                <ul style={{ fontSize: 13, lineHeight: 1.9, margin: 0, paddingLeft: 18 }}>
                  <li><code>#add 8455551234 First Last</code> — add someone and let them post</li>
                  <li><code>#invite 8455551234</code> — resend the invitation to someone already in the group</li>
                  <li><code>#remove 8455551234</code> — take someone out of the group</li>
                  <li><code>#count</code> — members, posters, and posts this week</li>
                  <li><code>#help</code> — this list</li>
                </ul>
                <p style={{ color: 'var(--ink-soft)', fontSize: 12.5, margin: '12px 0 0', lineHeight: 1.5 }}>
                  Any member can text <code>#join</code> to join or rejoin a group, and{' '}
                  <code>#exit</code> to leave. After leaving twice, only their own{' '}
                  <code>#join</code> brings them back — an admin can't re-invite them.
                </p>
              </div>
            </Group>
          )}

        </div>
      </div>
    </div>
  );
}

// ---------- individual settings ----------

function GroupPrefixInline() {
  const [mode, setMode] = useState('never');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.settings.getGroupPrefixMode()
      .then((r) => setMode(r.mode))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleChange(newMode) {
    setSaving(true);
    setError('');
    try {
      await api.settings.setGroupPrefixMode(newMode);
      setMode(newMode);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  return (
    <div>
      <Note kind="error">{error}</Note>
      <div className="chip-select" style={{ marginBottom: 0 }}>
        {[
          { value: 'always', label: 'Always' },
          { value: 'never', label: 'Never' },
          { value: 'ask', label: 'Ask each time' },
        ].map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`chip-toggle ${mode === opt.value ? 'active' : ''}`}
            onClick={() => handleChange(opt.value)}
            disabled={saving}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const COMMON_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
];

function TimezoneInline() {
  const [timezone, setTimezone] = useState('America/New_York');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.settings.getTimezone()
      .then((r) => setTimezone(r.timezone))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleChange(e) {
    const newTz = e.target.value;
    setSaving(true);
    setError('');
    try {
      await api.settings.setTimezone(newTz);
      setTimezone(newTz);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  return (
    <div>
      <Note kind="error">{error}</Note>
      <select value={timezone} onChange={handleChange} disabled={saving} style={{ minWidth: 150 }}>
        {COMMON_TIMEZONES.map((tz) => (
          <option key={tz.value} value={tz.value}>{tz.label}</option>
        ))}
      </select>
    </div>
  );
}

// Account-wide conference settings. Per-conference settings live in the editor.
function ConferenceRows() {
  const [codes, setCodes] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  // hold music
  const [musicName, setMusicName] = useState(null);
  const [musicBusy, setMusicBusy] = useState(false);
  const [musicError, setMusicError] = useState('');
  const fileRef = useRef(null);

  function loadCodes() {
    return api.conferenceCodes.list()
      .then((r) => setCodes(r || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadCodes();
    api.groups.list().then(setGroups).catch(() => {});
    api.settings.getHoldMusic().then((r) => setMusicName(r.name)).catch(() => {});
  }, []);

  async function handleMusicFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setMusicBusy(true); setMusicError('');
    try {
      const r = await api.settings.uploadHoldMusic(file);
      setMusicName(r.name);
    } catch (err) {
      setMusicError(err.message);
    } finally {
      setMusicBusy(false);
    }
  }

  async function removeMusic() {
    if (!window.confirm('Remove your hold music and go back to the default?')) return;
    setMusicBusy(true); setMusicError('');
    try {
      await api.settings.deleteHoldMusic();
      setMusicName(null);
    } catch (err) {
      setMusicError(err.message);
    } finally {
      setMusicBusy(false);
    }
  }

  if (loading) return null;

  return (
    <>
      <Row
        title="Conferences"
        description="Each code is its own conference, with its own settings and mute list."
        below={(
          <div style={{ display: 'grid', gap: 8 }}>
            <Note kind="error">{error}</Note>
            {codes.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8,
                }}
              >
                <span style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', fontWeight: 600 }}>
                  {c.code}
                </span>
                <span style={{ fontSize: 13 }}>{c.name || 'Untitled'}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-soft)' }}>
                  {c.start_mode === 'two' ? 'Opens when anyone joins' : 'Opens when you start it'}
                  {c.default_muted ? ' - everyone muted' : ''}
                </span>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ padding: '5px 10px', fontSize: 12.5 }}
                  onClick={() => setEditing(c)}
                >
                  Edit
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                className="btn secondary"
                style={{ padding: '6px 12px', fontSize: 12.5 }}
                onClick={() => setEditing('new')}
              >
                Add a conference
              </button>
            </div>
          </div>
        )}
      >
        <CurrentValue>{codes.length === 1 ? '1 code' : codes.length + ' codes'}</CurrentValue>
      </Row>

      <Row
        title="Hold music"
        description={musicError || 'Played while callers wait for the conference to open. MP3 or WAV, up to 8 MB.'}
        last
      >
        <input ref={fileRef} type="file" accept="audio/mpeg,audio/wav" style={{ display: 'none' }} onChange={handleMusicFile} />
        {musicName && (
          <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {musicName}
          </span>
        )}
        <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 12.5 }}
          onClick={() => fileRef.current?.click()} disabled={musicBusy}>
          {musicBusy ? 'Working...' : musicName ? 'Replace' : 'Upload'}
        </button>
        {musicName && (
          <button type="button" className="icon-btn danger" onClick={removeMusic} disabled={musicBusy} aria-label="Remove hold music">
            <i className="ti ti-trash" />
          </button>
        )}
      </Row>

      {editing && (
        <ConferenceCodeEditor
          row={editing === 'new' ? null : editing}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); loadCodes(); }}
        />
      )}
    </>
  );
}

// Add or change one conference: its code, how it opens, and who arrives muted.
function ConferenceCodeEditor({ row, groups, onClose, onSaved }) {
  const [form, setForm] = useState({
    code: row?.code || '',
    name: row?.name || '',
    start_mode: row?.start_mode || 'admin',
    record_mode: row?.record_mode || 'always',
    announce_names: row?.announce_names === true,
    whitelist_group_id: row?.whitelist_group_id == null ? '' : String(row.whitelist_group_id),
    default_muted: row?.default_muted === true,
    unmuted_group_id: row?.unmuted_group_id == null ? '' : String(row.unmuted_group_id),
    unmuted_numbers: row?.unmuted_numbers || '',
    muted_group_id: row?.muted_group_id == null ? '' : String(row.muted_group_id),
    muted_numbers: row?.muted_numbers || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      if (row) await api.conferenceCodes.update(row.id, form);
      else await api.conferenceCodes.create(form);
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this conference and its code?')) return;
    setSaving(true); setError('');
    try {
      await api.conferenceCodes.remove(row.id);
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const groupPick = (field, blank) => (
    <select value={form[field]} onChange={(e) => set(field, e.target.value)} style={{ width: '100%' }}>
      <option value="">{blank}</option>
      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
    </select>
  );

  const chips = (field, opts) => (
    <div className="chip-select" style={{ marginBottom: 0 }}>
      {opts.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={`chip-toggle ${form[field] === o.value ? 'active' : ''}`}
          onClick={() => set(field, o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <form onSubmit={submit}>
          <h3 style={{ margin: '0 0 6px' }}>{row ? 'Edit conference' : 'New conference'}</h3>
          <Note kind="error">{error}</Note>

          <div style={{ display: 'flex', gap: 10 }}>
            <div className="field" style={{ maxWidth: 150 }}>
              <label>Code (4 to 8 digits)</label>
              <input
                autoFocus
                value={form.code}
                onChange={(e) => set('code', e.target.value.replace(/\D/g, '').slice(0, 8))}
                style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Name (just for you)</label>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Board meeting" />
            </div>
          </div>

          <div className="field">
            <label>When it opens</label>
            {chips('start_mode', [
              { value: 'admin', label: 'When I start it' },
              { value: 'two', label: 'As soon as anyone joins' },
            ])}
          </div>

          <div className="field">
            <label>Who can call in</label>
            {groupPick('whitelist_group_id', 'Anyone with the code')}
          </div>

          <div className="field">
            <label>Announce who joins</label>
            {chips('announce_names', [
              { value: true, label: 'On' },
              { value: false, label: 'Off' },
            ])}
          </div>

          <div className="field">
            <label>Recording</label>
            {chips('record_mode', [
              { value: 'always', label: 'Always' },
              { value: 'never', label: 'Never' },
              { value: 'ask', label: 'Ask each time' },
            ])}
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '16px 0 12px' }} />

          <div className="field">
            <label>Everyone arrives</label>
            {chips('default_muted', [
              { value: false, label: 'Unmuted' },
              { value: true, label: 'Muted' },
            ])}
            <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: '6px 0 0' }}>
              The two lists below override this for the numbers you name.
            </p>
          </div>

          <div className="field">
            <label>Always unmuted (speakers)</label>
            {groupPick('unmuted_group_id', 'No group')}
            <textarea
              rows={2}
              value={form.unmuted_numbers}
              onChange={(e) => set('unmuted_numbers', e.target.value)}
              placeholder="Extra numbers, one per line"
              style={{ marginTop: 6 }}
            />
          </div>

          <div className="field">
            <label>Always muted (listeners)</label>
            {groupPick('muted_group_id', 'No group')}
            <textarea
              rows={2}
              value={form.muted_numbers}
              onChange={(e) => set('muted_numbers', e.target.value)}
              placeholder="Extra numbers, one per line"
              style={{ marginTop: 6 }}
            />
          </div>

          <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
            <div>
              {row && (
                <button type="button" className="btn danger" onClick={remove} disabled={saving}>
                  Delete
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button type="submit" className="btn" disabled={saving || form.code.length < 4}>
                {saving ? t('btn_saving') : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
