import React, { useEffect, useState } from 'react';
import { api, groupAudioLabelUrl, contactDisplayName } from '../api.js';

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [detailGroup, setDetailGroup] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setGroups(await api.groups.list());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditing(null);
    setName('');
    setModalOpen(true);
  }

  function openEdit(group) {
    setEditing(group);
    setName(group.name);
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await api.groups.update(editing.id, { name });
      } else {
        await api.groups.create({ name });
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm('Delete this group? Contacts will not be deleted, just removed from the group.')) return;
    try {
      await api.groups.remove(id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const allSelected = groups.length > 0 && groups.every((g) => prev.has(g.id));
      return allSelected ? new Set() : new Set(groups.map((g) => g.id));
    });
  }

  async function handleBulkDelete() {
    if (!selected.size) return;
    if (!confirm(`Delete ${selected.size} selected group${selected.size !== 1 ? 's' : ''}? Contacts won't be deleted, just removed from these groups.`)) return;
    setBulkDeleting(true);
    setError('');
    try {
      await api.groups.bulkDelete([...selected]);
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkDeleting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Groups</h1>
          <p>Organize contacts to send to a whole set at once</p>
        </div>
        <button className="btn" onClick={openAdd}><i className="ti ti-plus" /> New group</button>
      </div>

      {error && <div className="banner error">{error}</div>}

      {groups.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="button" onClick={toggleSelectAll} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer' }}>
              {groups.every((g) => selected.has(g.id)) ? 'Unselect all' : 'Select all'}
            </button>
            {selected.size > 0 && <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{selected.size} selected</span>}
          </div>
          {selected.size > 0 && (
            <button type="button" className="btn" style={{ padding: '6px 12px', fontSize: 13, background: 'var(--danger)' }} onClick={handleBulkDelete} disabled={bulkDeleting}>
              <i className="ti ti-trash" /> {bulkDeleting ? 'Deleting...' : `Delete ${selected.size}`}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
      ) : groups.length === 0 ? (
        <div className="card empty-state">
          <h3>No groups yet</h3>
          <p>Create a group here, or create one by phone during the contact-adding flow.</p>
        </div>
      ) : (
        <div className="list">
          {groups.map((g) => (
            <div className="row" key={g.id} style={{ cursor: 'pointer' }} onClick={() => setDetailGroup(g)}>
              <input
                type="checkbox"
                checked={selected.has(g.id)}
                onChange={() => toggleSelected(g.id)}
                onClick={(e) => e.stopPropagation()}
                style={{ marginRight: 4 }}
              />
              <div className="row-main">
                <span className="row-title">
                  {g.name}
                  {g.source === 'phone_placeholder' && (
                    <span className="pill signal" style={{ marginLeft: 8 }}>Needs a name</span>
                  )}
                </span>
                <span className="row-sub">
                  {g.member_count} member{g.member_count !== 1 ? 's' : ''} · click to view
                  {g.source === 'phone_placeholder' && ` · created ${new Date(g.created_at).toLocaleString()}`}
                </span>
              </div>
              <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                {g.source === 'phone_placeholder' && g.audio_label_url && (
                  <audio controls src={groupAudioLabelUrl(g.id)} />
                )}
                <button className="icon-btn" onClick={() => openEdit(g)} aria-label="Rename group"><i className="ti ti-edit" /></button>
                <button className="icon-btn danger" onClick={() => handleDelete(g.id)} aria-label="Delete group"><i className="ti ti-trash" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? 'Rename group' : 'New group'}</h2>
            {editing && editing.source === 'phone_placeholder' && editing.audio_label_url && (
              <div className="field">
                <label>Recorded name (from phone)</label>
                <audio controls src={groupAudioLabelUrl(editing.id)} style={{ width: '100%' }} />
              </div>
            )}
            <form onSubmit={handleSave}>
              <div className="field">
                <label>Group name</label>
                <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Drivers" />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn secondary" onClick={() => setModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn" disabled={saving}>{saving ? 'Saving...' : 'Save group'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {detailGroup && (
        <GroupDetailModal
          group={detailGroup}
          onClose={() => setDetailGroup(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function GroupDetailModal({ group, onClose, onChanged }) {
  const [members, setMembers] = useState([]);
  const [allContacts, setAllContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState(new Set());

  async function load() {
    setLoading(true);
    try {
      const [m, all] = await Promise.all([api.groups.contacts(group.id), api.contacts.list()]);
      setMembers(m);
      setAllContacts(all);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [group.id]);

  const memberIds = new Set(members.map((m) => m.id));
  const availableContacts = allContacts.filter((c) => !memberIds.has(c.id));

  function togglePicked(id) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleAddSelected() {
    if (!picked.size) return;
    setAdding(true);
    setError('');
    try {
      await api.groups.addContacts(group.id, [...picked]);
      setPicked(new Set());
      setPickerOpen(false);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveMember(contactId) {
    try {
      await api.groups.removeContact(group.id, contactId);
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h2>{group.name}</h2>
        {error && <div className="banner error">{error}</div>}

        {!pickerOpen ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>
                {members.length} member{members.length !== 1 ? 's' : ''}
              </p>
              <button
                type="button"
                className="btn secondary"
                style={{ padding: '6px 12px', fontSize: 13 }}
                onClick={() => setPickerOpen(true)}
              >
                <i className="ti ti-plus" /> Add contacts
              </button>
            </div>

            {loading ? (
              <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
            ) : members.length === 0 ? (
              <p style={{ fontSize: 14, color: 'var(--ink-soft)' }}>No members yet — add some below.</p>
            ) : (
              <div className="list" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {members.map((c) => (
                  <div className="row" key={c.id}>
                    <div className="row-main">
                      <span className="row-title">{contactDisplayName(c) || c.phone_number}</span>
                      <span className="row-sub">{c.phone_number}</span>
                    </div>
                    <button className="icon-btn danger" onClick={() => handleRemoveMember(c.id)} aria-label="Remove from group">
                      <i className="ti ti-x" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10 }}>
              Select contacts to add to this group.
            </p>
            <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 7, marginBottom: 14 }}>
              {availableContacts.length === 0 ? (
                <p style={{ padding: 12, fontSize: 13, color: 'var(--ink-soft)' }}>Every contact is already in this group.</p>
              ) : (
                availableContacts.map((c) => (
                  <label key={c.id} className="checkbox-row" style={{ padding: '9px 12px', borderBottom: '1px solid var(--line)', fontSize: 13.5 }}>
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => togglePicked(c.id)} />
                    <span style={{ flex: 1 }}>{contactDisplayName(c) || c.phone_number}</span>
                  </label>
                ))
              )}
            </div>
            <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="btn secondary" onClick={() => { setPickerOpen(false); setPicked(new Set()); }}>Back</button>
              <button type="button" className="btn" onClick={handleAddSelected} disabled={adding || !picked.size}>
                {adding ? 'Adding...' : `Add ${picked.size || ''}`.trim()}
              </button>
            </div>
          </>
        )}

        {!pickerOpen && (
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
