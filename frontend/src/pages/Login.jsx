import React, { useState } from 'react';
import { api, setToken } from '../api.js';
import PasswordInput from '../components/PasswordInput.jsx';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'recover'

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--accent)',
    }}>
      <div className="card" style={{ padding: 32, width: '100%', maxWidth: 380, background: 'var(--surface)' }}>
        <div className="brand-mark" aria-hidden="true" style={{ margin: '0 auto 16px' }}>
          <span></span><span></span><span></span><span></span>
        </div>
        <h1 style={{ textAlign: 'center', fontSize: 20, marginBottom: 4 }}>Wonder Solutions</h1>
        <p style={{ textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13.5, margin: '0 0 24px' }}>
          Message console
        </p>

        {mode === 'login' ? (
          <LoginForm onLogin={onLogin} onForgot={() => setMode('recover')} />
        ) : (
          <RecoverForm onBack={() => setMode('login')} />
        )}
      </div>
    </div>
  );
}

function LoginForm({ onLogin, onForgot }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await api.auth.login(username, password);
      setToken(token);
      onLogin();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {error && <div className="banner error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Username</label>
          <input required autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="field">
          <label>Password</label>
          <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button type="submit" className="btn" style={{ width: '100%' }} disabled={loading}>
          {loading ? 'Logging in...' : 'Log in'}
        </button>
      </form>
      <button
        type="button"
        onClick={onForgot}
        style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 13, marginTop: 14, cursor: 'pointer', width: '100%', textAlign: 'center' }}
      >
        Forgot username or password?
      </button>
    </>
  );
}

function RecoverForm({ onBack }) {
  const [recoveryKey, setRecoveryKey] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.auth.recover({ recovery_key: recoveryKey, new_username: newUsername, new_password: newPassword });
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div>
        <div className="banner ok">Your username and password have been reset. You can log in now.</div>
        <button type="button" className="btn" style={{ width: '100%' }} onClick={onBack}>Back to log in</button>
      </div>
    );
  }

  return (
    <>
      <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', margin: '0 0 16px' }}>
        Enter your recovery key (set up in advance from Settings) to choose a new username and password.
      </p>
      {error && <div className="banner error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Recovery key</label>
          <PasswordInput required autoFocus value={recoveryKey} onChange={(e) => setRecoveryKey(e.target.value)} />
        </div>
        <div className="field">
          <label>New username</label>
          <input required value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
        </div>
        <div className="field">
          <label>New password</label>
          <PasswordInput required minLength={4} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <button type="submit" className="btn" style={{ width: '100%' }} disabled={loading}>
          {loading ? 'Resetting...' : 'Reset username & password'}
        </button>
      </form>
      <button
        type="button"
        onClick={onBack}
        style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 13, marginTop: 14, cursor: 'pointer', width: '100%', textAlign: 'center' }}
      >
        Back to log in
      </button>
    </>
  );
}
