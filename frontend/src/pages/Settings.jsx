import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import PasswordInput from '../components/PasswordInput.jsx';

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
      setTpSuccess('Number added.');
      await loadTrustedPhones();
    } catch (err) {
      setTpError(err.message);
    } finally {
      setAddingTp(false);
    }
  }

  async function handleRemoveTrustedPhone(id) {
    if (!confirm('Remove this number? Texts sent from it will no longer be saved automatically.')) return;
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
      setPinSuccess('PIN updated.');
    } catch (err) { setPinError(err.message); } finally { setPinSaving(false); }
  }

  async function handleSaveUsername(e) {
    e.preventDefault();
    setUserError(''); setUserSuccess(''); setUserSaving(true);
    try {
      await api.settings.setPortalUsername(newUsername);
      setCurrentUsername(newUsername);
      setNewUsername('');
      setUserSuccess('Username updated.');
    } catch (err) { setUserError(err.message); } finally { setUserSaving(false); }
  }

  async function handleSavePassword(e) {
    e.preventDefault();
    setPwError(''); setPwSuccess(''); setPwSaving(true);
    try {
      await api.settings.setPortalPassword(newPassword);
      setNewPassword('');
      setPwSuccess('Password updated.');
    } catch (err) { setPwError(err.message); } finally { setPwSaving(false); }
  }

  async function handleSaveRecoveryKey(e) {
    e.preventDefault();
    setRkError(''); setRkSuccess(''); setRkSaving(true);
    try {
      await api.settings.setRecoveryKey(recoveryKey);
      setRecoveryKey('');
      setRkSuccess('Recovery key set.');
    } catch (err) { setRkError(err.message); } finally { setRkSaving(false); }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Manage access to your call-in line and the web portal</p>
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
            <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Sending number</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 500 }}>{twilioNumber}</div>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-faint)', marginBottom: 12 }}>
        Phone line
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginBottom: 28 }}>
        <SettingCard
          icon="ti-lock"
          title="Call-in PIN"
          description="Required to access the phone menu when you call in."
          error={pinError}
          success={pinSuccess}
        >
          {!pinLoading && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 18, marginBottom: 12 }}>Current: {currentPin}</p>
          )}
          <form onSubmit={handleSavePin}>
            <div className="field">
              <label>New PIN (4-8 digits)</label>
              <input required inputMode="numeric" pattern="\d{4,8}" value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="e.g. 4471" />
            </div>
            <button type="submit" className="btn" disabled={pinSaving}>{pinSaving ? 'Saving...' : 'Update PIN'}</button>
          </form>
        </SettingCard>
      </div>

      <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-faint)', marginBottom: 12 }}>
        Web portal access
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        <SettingCard
          icon="ti-user"
          title="Username"
          description="Used together with your password to log in."
          error={userError}
          success={userSuccess}
        >
          {!userLoading && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 18, marginBottom: 12 }}>Current: {currentUsername}</p>
          )}
          <form onSubmit={handleSaveUsername}>
            <div className="field">
              <label>New username</label>
              <input required minLength={2} value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="e.g. moishe" />
            </div>
            <button type="submit" className="btn" disabled={userSaving}>{userSaving ? 'Saving...' : 'Update username'}</button>
          </form>
        </SettingCard>

        <SettingCard
          icon="ti-key"
          title="Password"
          description="For security, the current password isn't shown."
          error={pwError}
          success={pwSuccess}
        >
          <form onSubmit={handleSavePassword}>
            <div className="field">
              <label>New password (at least 4 characters)</label>
              <PasswordInput required minLength={4} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <button type="submit" className="btn" disabled={pwSaving}>{pwSaving ? 'Saving...' : 'Update password'}</button>
          </form>
        </SettingCard>

        <SettingCard
          icon="ti-shield-check"
          title="Recovery key"
          description="Lets you reset your login from the 'Forgot username or password?' link if you're ever locked out."
          error={rkError}
          success={rkSuccess}
        >
          <form onSubmit={handleSaveRecoveryKey}>
            <div className="field">
              <label>New recovery key (at least 4 characters)</label>
              <input required minLength={4} value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} placeholder="A phrase only you know" />
            </div>
            <button type="submit" className="btn" disabled={rkSaving}>{rkSaving ? 'Saving...' : 'Set recovery key'}</button>
          </form>
        </SettingCard>
      </div>

      <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-faint)', marginTop: 28, marginBottom: 12 }}>
        Text-to-save
      </h3>
      <div className="card" style={{ padding: 20, maxWidth: 420 }}>
        <p style={{ color: 'var(--ink-soft)', fontSize: 13,