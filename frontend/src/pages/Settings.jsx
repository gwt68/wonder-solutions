import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import PasswordInput from '../components/PasswordInput.jsx';
import { t } from '../i18n.js';

function SettingCard({ icon, title, description, error, success, children }) {
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7, background: 'var(--accent-soft)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0,
        }}>
          <i className={`ti ${icon}`} />
        </div>
        <h3 style={{ fontSize: 14 }}>{title}</h3>
      </div>
      {description && <p style={{ color: 'var(--ink-soft)', fontSize: 12.5, margin: '0 0 12px' }}>{description}</p>}
      {error && <div className="banner error">{error}</div>}
      {success && <div className="banner ok">{success}</div>}
      {children}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-faint)', marginTop: 22, marginBottom: 10 }}>
      {children}
    </h3>
  );
}

export default function Settings() {
  const isGroupsTier =
    import.meta.env.VITE_PORTAL === 'groups' ||
    (localStorage.getItem('wonder_account_type') || 'full') === 'groups';

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
      api.settings.getPin().then((r) => setCurrentPin(r.pin)).catch((e) => setPinError(e.message)).finally(() => setPinLoading(false));
      loadTrustedPhones();
    } else {
      setPinLoading(false);
      setTpLoading(false);
    }
  }, []);

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

      <SectionLabel>{isGroupsTier ? 'Messages' : t('settings_phone_line')}</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {!isGroupsTier && (
          <SettingCard
            icon="ti-lock"
            title={t('settings_call_in_pin')}
            description={t('settings_call_in_pin_desc')}
            error={pinError}
            success={pinSuccess}
          >
            {!pinLoading && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 16, marginBottom: 10 }}>{t('settings_current')} {currentPin}</p>
            )}
            <form onSubmit={handleSavePin}>
              <div className="field">
                <label>{t('settings_new_pin')}</label>
                <input required inputMode="numeric" pattern="\d{4,8}" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder={t('settings_new_pin_placeholder')} />
              </div>
              <button type="submit" className="btn" disabled={pinSaving}>{pinSaving ? t('btn_saving') : t('settings_update_pin')}</button>
            </form>
          </SettingCard>
        )}

        {!isGroupsTier && (
          <SettingCard icon="ti-users-group" title="Group message prefix" description="When sending to a whole group, start the message with the group's name?">
            <GroupPrefixInline />
          </SettingCard>
        )}

        <SettingCard icon="ti-clock" title="Your time zone" description="Used for scheduling and for the times shown in History.">
          <TimezoneInline />
        </SettingCard>
      </div>

      <SectionLabel>{t('settings_web_portal_access')}</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        <SettingCard
          icon="ti-user"
          title={t('settings_username_title')}
          description={t('settings_username_desc')}
          error={userError}
          success={userSuccess}
        >
          {!userLoading && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 16, marginBottom: 10 }}>{t('settings_current')} {currentUsername}</p>
          )}
          <form onSubmit={handleSaveUsername}>
            <div className="field">
              <label>{t('settings_new_username')}</label>
              <input required minLength={2} value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder={t('settings_new_username_placeholder')} />
            </div>
            <button type="submit" className="btn" disabled={userSaving}>{userSaving ? t('btn_saving') : t('settings_update_username')}</button>
          </form>
        </SettingCard>

        <SettingCard
          icon="ti-key"
          title={t('settings_password_title')}
          description={t('settings_password_desc')}
          error={pwError}
          success={pwSuccess}
        >
          <form onSubmit={handleSavePassword}>
            <div className="field">
              <label>Current password</label>
              <PasswordInput required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div className="field">
              <label>{t('settings_new_password')}</label>
              <PasswordInput required minLength={4} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <button type="submit" className="btn" disabled={pwSaving}>{pwSaving ? t('btn_saving') : t('settings_update_password')}</button>
          </form>
        </SettingCard>
      </div>

      {!isGroupsTier && (
        <>
          <SectionLabel>{t('settings_text_to_save')}</SectionLabel>
          <div className="card" style={{ padding: 18, maxWidth: 420 }}>
            <p style={{ color: 'var(--ink-soft)', fontSize: 12.5, margin: '0 0 12px' }}>
              {t('settings_text_to_save_desc')}
            </p>
            {tpError && <div className="banner error">{tpError}</div>}
            {tpSuccess && <div className="banner ok">{tpSuccess}</div>}

            {!tpLoading && trustedPhones.length > 0 && (
              <div className="list" style={{ marginBottom: 14 }}>
                {trustedPhones.map((tp) => (
                  <div className="row" key={tp.id}>
                    <div className="row-main">
                      <span className="row-title">{tp.phone_number}</span>
                      {tp.label && <span className="row-sub">{tp.label}</span>}
                    </div>
                    <button className="icon-btn danger" onClick={() => handleRemoveTrustedPhone(tp.id)} aria-label={t('aria_remove_number')}><i className="ti ti-trash" /></button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleAddTrustedPhone}>
              <div className="field">
                <label>{t('settings_phone_number')}</label>
                <input required value={newTpNumber} onChange={(e) => setNewTpNumber(e.target.value)} placeholder="+19145551234" />
              </div>
              <div className="field">
                <label>{t('settings_label_optional')}</label>
                <input value={newTpLabel} onChange={(e) => setNewTpLabel(e.target.value)} placeholder={t('settings_label_optional_placeholder')} />
              </div>
              <button type="submit" className="btn" disabled={addingTp}>{addingTp ? t('settings_adding') : t('settings_add_number')}</button>
            </form>
          </div>
        </>
      )}

      {isGroupsTier && (
        <>
          <SectionLabel>Text commands</SectionLabel>
          <div className="card" style={{ padding: 18, maxWidth: 480 }}>
            <p style={{ color: 'var(--ink-soft)', fontSize: 12.5, margin: '0 0 10px' }}>
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
          </div>
        </>
      )}

      </div>
    </div>
  );
}

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
    <>
      {error && <div className="banner error">{error}</div>}
      <div className="chip-select">
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
    </>
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
  const [success, setSuccess] = useState('');

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
    setSuccess('');
    try {
      await api.settings.setTimezone(newTz);
      setTimezone(newTz);
      setSuccess('Updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return null;
  return (
    <>
      {error && <div className="banner error">{error}</div>}
      {success && <div className="banner ok">{success}</div>}
      <div className="field">
        <select value={timezone} onChange={handleChange} disabled={saving}>
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </select>
      </div>
    </>
  );
}
