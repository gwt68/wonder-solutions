import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', name: '', phone: '', email: '', area_code: '' });

  async function loadUsers() {
    setLoading(true);
    setError('');
    try {
      const data = await api.users.list();
      setUsers(data);
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
    try {
      const { username, password, ...extra } = form;
      await api.users.create(username, password, extra);
      setForm({ username: '', password: '', name: '', phone: '', email: '', area_code: '' });
      setShowCreate(false);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id, username) {
    if (!window.confirm(`Delete user "${username}"? This also releases their phone number.`)) return;
    try {
      await api.users.remove(id);
      await loadUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page users-page">
      <div className="page-header">
        <h2>Users</h2>
        <button onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? 'Cancel' : '+ New User'}
        </button>
      </div>

      {error && <div className="error-banner">{error}</div>}

      {showCreate && (
        <form className="user-create-form" onSubmit={handleCreate}>
          <input
            placeholder="Username"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            required
          />
          <input
            placeholder="Password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <input
            placeholder="Name (optional)"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            placeholder="Contact phone (optional)"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <input
            placeholder="Email (optional)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <input
            placeholder="Area code for new Twilio number (e.g. 914)"
            value={form.area_code}
            onChange={(e) => setForm({ ...form, area_code: e.target.value })}
            required
          />
          <button type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create user'}
          </button>
        </form>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <table className="users-table">
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
                <td>{u.twilio_phone_number || '—'}</td>
                <td>{u.is_admin ? 'Yes' : 'No'}</td>
                <td>{new Date(u.created_at).toLocaleDateString()}</td>
                <td>
                  {!u.is_admin && (
                    <button onClick={() => handleDelete(u.id, u.username)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}