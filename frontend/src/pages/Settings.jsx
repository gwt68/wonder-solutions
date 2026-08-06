import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import PasswordInput from '../components/PasswordInput.jsx';
import { t } from '../i18n.js';

function SettingCard({ icon, title, description, error, success, children }) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0,
        }}>
          <i className={`ti ${icon}`} />
        </div>
        <h3 style={{ fontSize: 14.5 }}>{title}</h3>
      </div>
      <p style={{ color: 'var(--ink-soft)', fontSize: 13, margin: '0 0 14px' }}>{description}</p>
      {error && <div className="banner error">{error}</div>}
      {success && <div className="banner ok">{success}</div>}
      {children}
    </div>
  );
}

export default function Settings() {
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

  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const [recoveryKey, setRecoveryKey] = useState('');
  const [rkError, setRkError] = useState('');
  const [rkSuccess, setRkSuccess] = useState('');
  const [rkSaving, setRkSaving] = useState(false);

  const [twilioNumber, setTwilioNumber] = useState(null);

  const [trustedPhones, setTrustedPhones] = useState([]);
  const [tpLoading, setTpLoading] = useState(true);
  const [newTpNumber, setNewTpNumber] = useState('');
  const [newTpLabel, setNewTpLabel] = useState('');
  const [tpError, setTpError] = useState('');
  const [tpSuccess, setTpSuccess] = useState('');
  const [addingTp, setAddingTp] = useState(false);

  useEffect(() => {
    api.settings.getPin().then((r) => setCurrentPin(r.pin)).catch((e) => setPinError(e.message)).finally(() => setPinLoading(false));
    api.settings.getPortalUsername().then((r) => setCurrentUsername(r.username)).catch((e) => setUserError(e.message)).finally(() => setUserLoading(false));
    api.settings.getTwilioNumber().then((r) => setTwilioNumber(r.number)).catch(() => {});
    loadTrustedPhones();
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
      await api.settings.setPortalUsername(newUsername);
      setCurrentUsername(newUsername);
      setNewUsername('');
      setUserSuccess(t('settings_username_updated'));
    } catch (err) { setUserError(err.message); } finally { setUserSaving(false); }
  }

  async function handleSavePassword(e) {
    e.preventDefault();
    setPwError(''); setPwSuccess(''); setPwSaving(true);
    try {
      await api.settings.setPortalPassword(newPassword);
      setNewPassword('');
      setPwSuccess(t('settings_password_updated'));
    } catch (err) { setPwError(err.message); } finally { setPwSaving(false); }
  }

  async function handleSaveRecoveryKey(e) {
    e.preventDefault();
    setRkError(''); setRkSuccess(''); setRkSaving(true);
    try {
      await api.settings.setRecoveryKey(recoveryKey);
      setRecoveryKey('');
      setRkSuccess(t('settings_recovery_key_set'));
    } catch (err) { setRkError(err.message); } finally { setRkSaving(false); }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{t('settings_title')}</h1>
          <p>{t('settings_subtitle')}</p>
        </div>
      </div>

      {twilioNumber && (
        <div className="card" style={{ padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8, background: 'var(--signal-soft)', color: '#8a6015',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0,
          }}>
            <i className="ti ti-phone-outgoing" />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{t('settings_sending_number')}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500 }}>{twilioNumber}</div>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-faint)', marginBottom: 12 }}>
        {t('settings_phone_line')}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 28 }}>
        <SettingCard
          icon="ti-lock"
          title={t('settings_call_in_pin')}
          description={t('settings_call_in_pin_desc')}
          error={pinError}
          success={pinSuccess}
        >
          {!pinLoading && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 18, marginBottom: 12 }}>{t('settings_current')} {currentPin}</p>
          )}
          <form onSubmit={handleSavePin}>
            <div className="field">
              <label>{t('settings_new_pin')}</label>
              <input required inputMode="numeric" pattern="\d{4,8}" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder={t('settings_new_pin_placeholder')} />
            </div>
            <button type="submit" className="btn" disabled={pinSaving}>{pinSaving ? t('btn_saving') : t('settings_update_pin')}</button>
          </form>
        </SettingCard>
      </div>

      <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-faint)', marginBottom: 12 }}>
        {t('settings_web_portal_access')}
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <SettingCard
          icon="ti-user"
          title={t('settings_username_title')}
          description={t('settings_username_desc')}
          error={userError}
          success={userSuccess}
        >
          {!userLoading && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 18, marginBottom: 12 }}>{t('settings_current')} {currentUsername}</p>
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
              <label>{t('settings_new_password')}</label>
              <PasswordInput required minLength={4} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <button type="submit" className="btn" disabled={pwSaving}>{pwSaving ? t('btn_saving') : t('settings_update_password')}</button>
          </form>
        </SettingCard>

        <SettingCard
          icon="ti-shield-check"
          title={t('settings_recovery_key_title')}
          description={t('settings_recovery_key_desc')}
          error={rkError}
          success={rkSuccess}
        >
          <form onSubmit={handleSaveRecoveryKey}>
            <div className="field">
              <label>{t('settings_new_recovery_key')}</label>
              <input required minLength={4} value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} placeholder={t('settings_new_recovery_key_placeholder')} />
            </div>
            <button type="submit" className="btn" disabled={rkSaving}>{rkSaving ? t('btn_saving') : t('settings_set_recovery_key')}</button>
          </form>
        </SettingCard>
      </div>

      <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-faint)', marginTop: 28, marginBottom: 12 }}>
        {t('settings_text_to_save')}
      </h3>
      <div className="card" style={{ padding: 20, maxWidth: 420 }}>
        <p style={{ color: 'var(--ink-soft)', fontSize: 13, margin: '0 0 14px' }}>
          {t('settings_text_to_save_desc')}
        </p>
        {tpError && <div className="banner error">{tpError}</div>}
        {tpSuccess && <div className="banner ok">{tpSuccess}</div>}

        {!tpLoading && trustedPhones.length > 0 && (
          <div className="list" style={{ marginBottom: 16 }}>
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
    </div>
  );
}