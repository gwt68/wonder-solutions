const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function getToken() {
  return localStorage.getItem('wonder_token');
}

export function setToken(token) {
  if (token) localStorage.setItem('wonder_token', token);
  else localStorage.removeItem('wonder_token');
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}/api${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new Event('wonder-logout'));
    throw new Error('Session expired — please log in again');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function upload(path, formData) {
  const token = getToken();
  const res = await fetch(`${BASE}/api${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });
  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new Event('wonder-logout'));
    throw new Error('Session expired — please log in again');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Upload failed (${res.status})`);
  }
  return res.json();
}

export function audioUrl(messageId) {
  return `${BASE}/api/messages/${messageId}/audio`;
}

export function imageUrl(messageId) {
  return `${BASE}/api/messages/${messageId}/image`;
}

export function groupAudioLabelUrl(groupId) {
  return `${BASE}/api/groups/${groupId}/audio-label`;
}

// Prefers first/last name, falling back to the legacy single "name" field
// on older contacts that haven't been re-entered yet
export function contactDisplayName(contact) {
  if (!contact) return '';
  const full = [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();
  return full || contact.name || '';
}

export const api = {
  auth: {
    login: async (username, password) => {
      const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Login failed');
      }
      return res.json();
    },
    recover: async (data) => {
      const res = await fetch(`${BASE}/api/auth/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Recovery failed');
      }
      return res.json();
    },
  },
  contacts: {
    list: () => request('/contacts'),
    create: (data) => request('/contacts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/contacts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/contacts/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids) => request('/contacts/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    bulkImport: (contacts, group_id) => request('/contacts/bulk', { method: 'POST', body: JSON.stringify({ contacts, group_id: group_id || null }) }),
    bulkUpdate: (ids, methods, preferred_method) => request('/contacts/bulk-update', { method: 'POST', body: JSON.stringify({ ids, methods, preferred_method }) }),
  },
  groups: {
    list: () => request('/groups'),
    create: (data) => request('/groups', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => request(`/groups/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id) => request(`/groups/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids) => request('/groups/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    contacts: (id) => request(`/groups/${id}/contacts`),
    addContacts: (id, contact_ids) => request(`/groups/${id}/contacts`, { method: 'POST', body: JSON.stringify({ contact_ids }) }),
    removeContact: (id, contactId) => request(`/groups/${id}/contacts/${contactId}`, { method: 'DELETE' }),
    bulkAssign: (contact_ids, group_ids) => request('/groups/bulk-assign', { method: 'POST', body: JSON.stringify({ contact_ids, group_ids }) }),
  },
  messages: {
    list: () => request('/messages'),
    create: (data) => request('/messages', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id) => request(`/messages/${id}`, { method: 'DELETE' }),
    bulkDelete: (ids) => request('/messages/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    rename: (id, title) => request(`/messages/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),
    editText: (id, title, text_content) => request(`/messages/${id}`, { method: 'PUT', body: JSON.stringify({ title, text_content }) }),
    uploadAudio: (file, title) => {
      const formData = new FormData();
      formData.append('audio', file);
      if (title) formData.append('title', title);
      return upload('/messages/upload', formData);
    },
    uploadImage: (file, title) => {
      const formData = new FormData();
      formData.append('image', file);
      if (title) formData.append('title', title);
      return upload('/messages/upload-image', formData);
    },
    replaceAudio: async (id, blob) => {
      const formData = new FormData();
      formData.append('audio', blob, 'trimmed.wav');
      const token = getToken();
      const res = await fetch(`${BASE}/api/messages/${id}/audio`, {
        method: 'PUT',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to save trimmed audio');
      }
      return res.json();
    },
  },
  sends: {
    create: (data) => request('/sends', { method: 'POST', body: JSON.stringify(data) }),
    list: () => request('/sends'),
    listForContact: (contactId) => request(`/sends?contact_id=${contactId}`),
    remove: (id) => request(`/sends/${id}`, { method: 'DELETE' }),
  },
  users: {
    list: () => request('/users'),
    create: (username, password, extra = {}) => request('/users', { method: 'POST', body: JSON.stringify({ username, password, ...extra }) }),
    update: (id, username, extra = {}) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify({ username, ...extra }) }),
    remove: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  },
  settings: {
    getPin: () => request('/settings/pin'),
    setPin: (pin) => request('/settings/pin', { method: 'PUT', body: JSON.stringify({ pin }) }),
    setPortalPassword: (password) => request('/settings/portal-password', { method: 'PUT', body: JSON.stringify({ password }) }),
    getPortalUsername: () => request('/settings/portal-username'),
    setPortalUsername: (username) => request('/settings/portal-username', { method: 'PUT', body: JSON.stringify({ username }) }),
    setRecoveryKey: (recovery_key) => request('/settings/recovery-key', { method: 'PUT', body: JSON.stringify({ recovery_key }) }),
    getTwilioNumber: () => request('/settings/twilio-number'),
    getOwnerPhone: () => request('/settings/owner-phone'),
    setOwnerPhone: (phone) => request('/settings/owner-phone', { method: 'PUT', body: JSON.stringify({ phone }) }),
  },
  trustedPhones: {
    list: () => request('/trusted-phones'),
    add: (phone_number, label) => request('/trusted-phones', { method: 'POST', body: JSON.stringify({ phone_number, label }) }),
    remove: (id) => request(`/trusted-phones/${id}`, { method: 'DELETE' }),
  },
};
