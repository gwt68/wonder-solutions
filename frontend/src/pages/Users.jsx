import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import PasswordInput from '../components/PasswordInput.jsx';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  const [form, setForm] = useState({
    username: '', password: '', name: '', phone: '', email: '', area_code: '',
  });

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      setUsers(await api.users.list());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setError('');
    setSuccess('');
    try {
      const { username, password, ...extra } = form;
      await api.users.create(username, password, extra);
      setForm({ username: '', password: '', name: '', phone: '', email: '', area_code: '' });
      setShowCreate(false);
      setSuccess('User created.');
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id, username) {
    if (!confirm(`Delete user "${username}"? This also releases their phone number.`)) return;
    setError('');
    try {
      await api.users.remove(id);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Users</h1>
          <p>Give people their own login, contacts, messages, and phone number</p>
        </div>
        <button className="btn" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : '+ New User'}
        </button>
      </div>

      {error && <div className="banner error">{error}</div>}
      {success && <div className="banner ok">{success}</div>}

      {showCreate && (
        <div className="card" style={{ padding: 20, marginBottom: 24, maxWidth: 520 }}>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label>Full name (optional)</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sarah Cohen" />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label>Username</label>
                <input required minLength={2} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. sarah" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label>Contact phone (optional)</label>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+19145551234" />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label>Email (optional)</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="sarah@example.com" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label>Area code (for their new number)</label>
                <input required value={form.area_code} onChange={(e) => setForm({ ...form, area_code: e.target.value })} placeholder="e.g. 914" />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 140 }}>
                <label>Password</label>
                <PasswordInput required minLength={4} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            </div>
            <button type="submit" className="btn" disabled={creating}>
              {creating ? 'Creating…' : 'Create user'}
            </button>
          </form>
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--ink-soft)' }}>Loading…</p>
      ) : users.length === 0 ? (
        <div className="empty-state">
          <h3>No users yet</h3>
          <p>Create your first user to get started.</p>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Twilio Number</th>
              <th>Admin</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.name || '—'}</td>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{u.twilio_phone_number || '—'}</td>
                <td>{u.is_admin ? <span className="pill signal">Admin</span> : '—'}</td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                <td>
                  <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                    <button className="icon-btn" onClick={() => setEditingUser(u)} aria-label="Edit user">
                      <i className="ti ti-edit" />
                    </button>
                    {!u.is_admin && (
                      <button className="icon-btn danger" onClick={() => handleDelete(u.id, u.username)} aria-label="Delete user">
                        <i className="ti ti-trash" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

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
            <label>New password (leave blank to keep current)</label>
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