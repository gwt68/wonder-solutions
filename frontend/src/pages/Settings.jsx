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

  const [users, setUsers] = useState([]);
  const [editingUser, setEditingUser] = useState(null);
  const [usersLoading, setUsersLoading] = useState(true);
  const [newUserName, setNewUserName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserFullName, setNewUserFullName] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [usersError, setUsersError] = useState('');
  const [usersSuccess, setUsersSuccess] = useState('');
  const [addingUser, setAddingUser] = useState(false);

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
    loadUsers();
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

  async function loadUsers() {
    setUsersLoading(true);
    try {
      setUsers(await api.users.list());
    } catch (err) {
      setUsersError(err.message);
    } finally {
      setUsersLoading(false);
    }
  }

  async function handleAddUser(e) {
    e.preventDefault();
    setUsersError(''); setUsersSuccess(''); setAddingUser(true);
    try {
      await api.users.create(newUserName, newUserPassword, { name: newUserFullName || null, phone: newUserPhone || null, email: newUserEmail || null });
      setNewUserName('');
      setNewUserPassword('');
      setNewUserFullName('');
      setNewUserPhone('');
      setNewUserEmail('');
      setUsersSuccess('User added.');
      await loadUsers();
    } catch (err) {
      setUsersError(err.message);
    } finally {
      setAddingUser(false);
    }
  }

  async function handleRemoveUser(id) {
    if (!confirm('Remove this user? They will no longer be able to log in.')) return;
    setUsersError('');
    try {
      await api.users.remove(id);
      await loadUsers();
    } catch (err) {
      setUsersError(err.message);
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
        Users
      </h3>
      <div className="card" style={{ padding: 20, marginBottom: 28 }}>
        <p style={{ color: 'var(--ink-soft)', fontSize: 13, margin: '0 0 14px' }}>
          Give other people their own login instead of sharing one username and password.
        </p>
        {usersError && <div className="banner error">{usersError}</div>}
        {usersSuccess && <div className="banner ok">{usersSuccess}</div>}

        {!usersLoading && users.length > 0 && (
          <div className="list" style={{ marginBottom: 16 }}>
            {users.map((u) => (
              <div className="row" key={u.id}>
                <div className="row-main">
                  <span className="row-title">{u.name || u.username}</span>
                  <span className="row-sub">
                    {u.username}
                    {u.phone && ` · ${u.phone}`}
                    {u.email && ` · ${u.email}`}
                    {' · Added '}{new Date(u.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="row-actions">
                  <button className="icon-btn" onClick={() => setEditingUser(u)} aria-label="Edit user"><i className="ti ti-edit" /></button>
                  <button className="icon-btn danger" onClick={() => handleRemoveUser(u.id)} aria-label="Remove user"><i className="ti ti-trash" /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAddUser}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label>Full name (optional)</label>
              <input value={newUserFullName} onChange={(e) => setNewUserFullName(e.target.value)} placeholder="e.g. Sarah Cohen" />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label>Username</label>
              <input required minLength={2} value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="e.g. sarah" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label>Phone (optional)</label>
              <input value={newUserPhone} onChange={(e) => setNewUserPhone(e.target.value)} placeholder="+19145551234" />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}>
              <label>Email (optional)</label>
              <input type="email" value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} placeholder="sarah@example.com" />
            </div>
          </div>
          <div className="field" style={{ maxWidth: 300 }}>
            <label>Password</label>
            <PasswordInput required minLength={4} value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} />
          </div>
          <button type="submit" className="btn" disabled={addingUser}>{addingUser ? 'Adding...' : 'Add user'}</button>
        </form>
      </div>

      <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--ink-faint)', marginBottom: 12 }}>
        Text-to-save
      </h3>
      <div className="card" style={{ padding: 20, maxWidth: 420 }}>
        <p style={{ color: 'var(--ink-soft)', fontSize: 13, margin: '0 0 14px' }}>
          Texts sent from any of these numbers to your Wonder Solutions number are automatically saved as a new text message here — no need to open the portal.
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
                <button className="icon-btn danger" onClick={() => handleRemoveTrustedPhone(tp.id)} aria-label="Remove number"><i className="ti ti-trash" /></button>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAddTrustedPhone}>
          <div className="field">
            <label>Phone number</label>
            <input required value={newTpNumber} onChange={(e) => setNewTpNumber(e.target.value)} placeholder="+19145551234" />
          </div>
          <div className="field">
            <label>Label (optional)</label>
            <input value={newTpLabel} onChange={(e) => setNewTpLabel(e.target.value)} placeholder="e.g. my cell" />
          </div>
          <button type="submit" className="btn" disabled={addingTp}>{addingTp ? 'Adding...' : 'Add number'}</button>
        </form>
      </div>

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={() => { setEditingUser(null); loadUsers(); }}
        />
      )}
    </div>
  );
}

function EditUserModal({ user, onClose, onSaved }) {
  const [username, setUsername] = useState(user.username || '');
  const [name, setName] = useState(user.name || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [email, setEmail] = useState(user.email || '');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const extra = { name: name || null, phone: phone || null, email: email || null };
      if (newPassword) extra.password = newPassword;
      await api.users.update(user.id, username, extra);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Edit user</h2>
        {error && <div className="banner error">{error}</div>}
        <form onSubmit={handleSave}>
          <div className="field">
            <label>Full name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
          </div>
          <div className="field">
            <label>Username</label>
            <input required minLength={2} value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
          </div>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" />
          </div>
          <div className="field">
            <label>New password (leave blank to keep current password)</label>
            <PasswordInput minLength={4} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn" disabled={saving}>{saving ? 'Saving...' : 'Save changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
