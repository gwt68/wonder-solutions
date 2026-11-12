import React, { useEffect, useMemo, useState } from 'react';
import { api, groupAudioLabelUrl, contactDisplayName } from '../api.js';
import { t, tf } from '../i18n.js';

const COLUMNS_KEY = 'wonder_groups_columns';

function getAllColumns() {
  return [
    { key: 'member_count', label: 'Members', default: true, sortable: true, align: 'right' },
    { key: 'joined_count', label: 'Joined', default: false, sortable: true, align: 'right' },
    { key: 'pending_count', label: 'Pending', default: false, sortable: true, align: 'right' },
    { key: 'poster_count', label: 'Can post', default: false, sortable: true, align: 'right' },
    { key: 'member_posting', label: 'Group chat', default: true, sortable: true },
    { key: 'own_number', label: 'Own number', default: false, sortable: false },
    { key: 'last_post_at', label: 'Last post', default: false, sortable: true },
    { key: 'created_at', label: t('groups_created'), default: true, sortable: true },
  ];
}

function fmtWhen(v) {
  if (!v) return '';
  const d = new Date(v);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

export default function Groups() {
  const ALL_COLUMNS = getAllColumns();
  const DEFAULT_VISIBLE = ALL_COLUMNS.filter((c) => c.default).map((c) => c.key);

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
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [chatFilter, setChatFilter] = useState('all');
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = localStorage.getItem(COLUMNS_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_VISIBLE;
    } catch {
      return DEFAULT_VISIBLE;
    }
  });

  function toggleColumn(key) {
    setVisibleCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function handleSort(field) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function sortArrow(field) {
    if (sortField !== field) return null;
    return <span className="sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  const visibleGroups = useMemo(() => {
    let rows = groups;

    if (chatFilter === 'on') rows = rows.filter((g) => g.member_posting === 'approved');
    else if (chatFilter === 'off') rows = rows.filter((g) => g.member_posting !== 'approved');
    else if (chatFilter === 'unnamed') rows = rows.filter((g) => g.source === 'phone_placeholder');

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      rows = rows.filter((g) => (g.name || '').toLowerCase().includes(q));
    }

    return [...rows].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      let av;
      let bv;
      if (sortField === 'created_at' || sortField === 'last_post_at') {
        av = a[sortField] ? new Date(a[sortField]).getTime() : 0;
        bv = b[sortField] ? new Date(b[sortField]).getTime() : 0;
      } else if (typeof a[sortField] === 'number' || typeof b[sortField] === 'number') {
        av = a[sortField] || 0; bv = b[sortField] || 0;
      } else {
        av = (a[sortField] || '').toString().toLowerCase();
        bv = (b[sortField] || '').toString().toLowerCase();
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [groups, searchQuery, sortField, sortDir, chatFilter]);

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
    if (!confirm(t('groups_confirm_delete'))) return;
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
      const allSelected = visibleGroups.length > 0 && visibleGroups.every((g) => prev.has(g.id));
      return allSelected ? new Set() : new Set(visibleGroups.map((g) => g.id));
    });
  }

  async function handleBulkDelete() {
    if (!selected.size) return;
    if (!confirm(tf('groups_confirm_bulk_delete', { n: selected.size, s: selected.size !== 1 ? 's' : '' }))) return;
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

  const allVisibleSelected = visibleGroups.length > 0 && visibleGroups.every((g) => selected.has(g.id));
  const hasUnnamed = groups.some((g) => g.source === 'phone_placeholder');

  function cell(g, key) {
    switch (key) {
      case 'member_count': return g.member_count;
      case 'joined_count': return g.member_posting === 'approved' ? g.joined_count : '';
      case 'pending_count':
        if (g.member_posting !== 'approved') return '';
        return g.pending_count ? <span style={{ color: 'var(--danger)' }}>{g.pending_count}</span> : 0;
      case 'poster_count': return g.member_posting === 'approved' ? g.poster_count : '';
      case 'member_posting':
        return g.member_posting === 'approved'
          ? <span className="pill">On</span>
          : <span style={{ color: 'var(--ink-soft)' }}>Off</span>;
      case 'own_number':
        return g.own_number
          ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>{g.own_number}</span>
          : <span style={{ color: 'var(--ink-faint)' }}>Shared</span>;
      case 'last_post_at': return fmtWhen(g.last_post_at);
      case 'created_at': return g.created_at ? new Date(g.created_at).toLocaleDateString() : '';
      default: return '';
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1>{t('groups_title')}</h1>
          <p>{groups.length} {groups.length === 1 ? 'group' : 'groups'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <button className="btn secondary" onClick={() => setColumnsOpen((o) => !o)}>
              <i className="ti ti-columns" /> {t('contacts_columns')}
            </button>
            {columnsOpen && (
              <div
                className="card"
                style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, padding: 12, zIndex: 10, minWidth: 180 }}
              >
                {ALL_COLUMNS.map((col) => (
                  <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, padding: '5px 4px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={visibleCols.includes(col.key)}
                      onChange={() => toggleColumn(col.key)}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button className="btn" onClick={openAdd}><i className="ti ti-plus" /> {t('groups_new')}</button>
        </div>
      </div>

      <div style={{ flexShrink: 0 }}>
        {error && <div className="banner error">{error}</div>}

        {groups.length > 0 && (
          <div className="field" style={{ maxWidth: 320, marginBottom: 12 }}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search groups by name"
            />
          </div>
        )}

        {groups.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button type="button" onClick={toggleSelectAll} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer' }}>
                {allVisibleSelected ? t('contacts_unselect_all') : t('contacts_select_all')}
              </button>
              {selected.size > 0 && <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{selected.size} {t('contacts_selected')}</span>}
            </div>
            {selected.size > 0 && (
              <button type="button" className="btn" style={{ padding: '6px 12px', fontSize: 13, background: 'var(--danger)' }} onClick={handleBulkDelete} disabled={bulkDeleting}>
                <i className="ti ti-trash" /> {bulkDeleting ? t('contacts_deleting') : `${t('contacts_delete')} ${selected.size}`}
              </button>
            )}
          </div>
        )}

        {groups.length > 0 && (
          <div className="chip-select" style={{ marginBottom: 14 }}>
            <button type="button" className={`chip-toggle ${chatFilter === 'all' ? 'active' : ''}`} onClick={() => setChatFilter('all')}>
              {t('contacts_all')}
            </button>
            <button type="button" className={`chip-toggle ${chatFilter === 'on' ? 'active' : ''}`} onClick={() => setChatFilter('on')}>
              Group chat on
            </button>
            <button type="button" className={`chip-toggle ${chatFilter === 'off' ? 'active' : ''}`} onClick={() => setChatFilter('off')}>
              Broadcast only
            </button>
            {hasUnnamed && (
              <button type="button" className={`chip-toggle ${chatFilter === 'unnamed' ? 'active' : ''}`} onClick={() => setChatFilter('unnamed')}>
                {t('groups_needs_name')}
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>{t('send_loading')}</p>
        ) : groups.length === 0 ? (
          <div className="card empty-state">
            <h3>{t('groups_empty_title')}</h3>
            <p>{t('groups_empty_body')}</p>
          </div>
        ) : visibleGroups.length === 0 ? (
          <div className="card empty-state">
            <h3>No groups match your search</h3>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} />
                  </th>
                  <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                    {t('field_group_name')}{sortArrow('name')}
                  </th>
                  {ALL_COLUMNS.filter((c) => visibleCols.includes(c.key)).map((col) => (
                    <th
                      key={col.key}
                      onClick={col.sortable ? () => handleSort(col.key) : undefined}
                      style={{
                        cursor: col.sortable ? 'pointer' : 'default',
                        textAlign: col.align === 'right' ? 'right' : 'left',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {col.label}{col.sortable && sortArrow(col.key)}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleGroups.map((g) => (
                  <tr key={g.id} onClick={() => setDetailGroup(g)} style={{ cursor: 'pointer' }}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleSelected(g.id)} />
                    </td>
                    <td style={{ fontWeight: 500 }}>
                      {g.name}
                      {g.source === 'phone_placeholder' && (
                        <span className="pill signal" style={{ marginLeft: 8 }}>{t('groups_needs_name')}</span>
                      )}
                    </td>
                    {ALL_COLUMNS.filter((c) => visibleCols.includes(c.key)).map((col) => (
                      <td
                        key={col.key}
                        style={{
                          fontSize: 13,
                          textAlign: col.align === 'right' ? 'right' : 'left',
                          whiteSpace: 'nowrap',
                          color: col.key === 'created_at' || col.key === 'last_post_at' ? 'var(--ink-soft)' : undefined,
                        }}
                      >
                        {cell(g, col.key)}
                      </td>
                    ))}
                    <td onClick={(e) => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                        {g.source === 'phone_placeholder' && g.audio_label_url && (
                          <audio controls src={groupAudioLabelUrl(g.id)} style={{ height: 28, maxWidth: 140 }} />
                        )}
                        <button className="icon-btn" onClick={() => openEdit(g)} aria-label={t('aria_rename_group')}><i className="ti ti-edit" /></button>
                        <button className="icon-btn danger" onClick={() => handleDelete(g.id)} aria-label={t('aria_delete_group')}><i className="ti ti-trash" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? t('group_modal_rename') : t('group_modal_new')}</h2>
            {editing && editing.source === 'phone_placeholder' && editing.audio_label_url && (
              <div className="field">
                <label>{t('group_recorded_name')}</label>
                <audio controls src={groupAudioLabelUrl(editing.id)} style={{ width: '100%' }} />
              </div>
            )}
            <form onSubmit={handleSave}>
              <div className="field">
                <label>{t('field_group_name')}</label>
                <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('field_group_name_placeholder')} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn secondary" onClick={() => setModalOpen(false)}>{t('btn_cancel')}</button>
                <button type="submit" className="btn" disabled={saving}>{saving ? t('btn_saving') : t('btn_save_group')}</button>
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
  const [posting, setPosting] = useState(group.member_posting || 'off');
  const [savingPosting, setSavingPosting] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [pickerSearch, setPickerSearch] = useState('');

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
  const availableContacts = allContacts
    .filter((c) => !memberIds.has(c.id))
    .filter((c) => {
      const q = pickerSearch.trim().toLowerCase();
      if (!q) return true;
      return (contactDisplayName(c) || '').toLowerCase().includes(q) || (c.phone_number || '').includes(q);
    });

  const shownMembers = members.filter((c) => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return true;
    return (contactDisplayName(c) || '').toLowerCase().includes(q) || (c.phone_number || '').includes(q);
  });

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
      setPickerSearch('');
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

  async function handleTogglePosting() {
    const next = posting === 'approved' ? 'off' : 'approved';
    setSavingPosting(true);
    setError('');
    try {
      await api.groups.update(group.id, { member_posting: next });
      setPosting(next);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingPosting(false);
    }
  }

  async function handleToggleCanPost(contact) {
    const next = !contact.can_post;
    // Optimistic: flip locally, roll back if the save fails.
    setMembers((prev) => prev.map((m) => (m.id === contact.id ? { ...m, can_post: next } : m)));
    try {
      await api.groups.updateMember(group.id, contact.id, { can_post: next });
    } catch (err) {
      setError(err.message);
      setMembers((prev) => prev.map((m) => (m.id === contact.id ? { ...m, can_post: !next } : m)));
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h2>{group.name}</h2>
        {error && <div className="banner error">{error}</div>}

        {!pickerOpen ? (
          <>
            <div
              style={{
                border: '1px solid var(--line)', borderRadius: 7, padding: '10px 12px',
                marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>Group chat</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                  Approved members can text this group and reach everyone in it.
                </div>
              </div>
              <button
                type="button"
                className={`btn ${posting === 'approved' ? '' : 'secondary'}`}
                style={{ padding: '6px 12px', fontSize: 13, flexShrink: 0 }}
                onClick={handleTogglePosting}
                disabled={savingPosting}
              >
                {savingPosting ? '…' : posting === 'approved' ? 'On' : 'Off'}
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, gap: 10 }}>
              <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>
                {members.length} {members.length === 1 ? t('groups_member_one') : t('groups_member_other')}
              </p>
              <button
                type="button"
                className="btn secondary"
                style={{ padding: '6px 12px', fontSize: 13 }}
                onClick={() => setPickerOpen(true)}
              >
                <i className="ti ti-plus" /> {t('group_detail_add_contacts')}
              </button>
            </div>

            {members.length > 8 && (
              <div className="field" style={{ marginBottom: 10 }}>
                <input
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="Search members"
                />
              </div>
            )}

            {loading ? (
              <p style={{ color: 'var(--ink-soft)' }}>{t('send_loading')}</p>
            ) : members.length === 0 ? (
              <p style={{ fontSize: 14, color: 'var(--ink-soft)' }}>{t('group_detail_no_members')}</p>
            ) : (
              <div className="list" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {shownMembers.map((c) => (
                  <div className="row" key={c.id}>
                    <div className="row-main">
                      <span className="row-title">{contactDisplayName(c) || c.phone_number}</span>
                      <span className="row-sub">{c.phone_number}</span>
                    </div>
                    {posting === 'approved' && (
                      <label
                        style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--ink-soft)', marginRight: 8, whiteSpace: 'nowrap' }}
                        title="Let this member post to the group"
                      >
                        <input
                          type="checkbox"
                          checked={!!c.can_post}
                          onChange={() => handleToggleCanPost(c)}
                        />
                        Can post
                      </label>
                    )}
                    <button className="icon-btn danger" onClick={() => handleRemoveMember(c.id)} aria-label={t('aria_remove_from_group')}>
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
              {t('group_detail_select_contacts')}
            </p>
            <div className="field" style={{ marginBottom: 10 }}>
              <input
                autoFocus
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                placeholder="Search contacts"
              />
            </div>
            <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 7, marginBottom: 14 }}>
              {availableContacts.length === 0 ? (
                <p style={{ padding: 12, fontSize: 13, color: 'var(--ink-soft)' }}>{t('group_detail_all_in_group')}</p>
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
              <button type="button" className="btn secondary" onClick={() => { setPickerOpen(false); setPicked(new Set()); setPickerSearch(''); }}>{t('group_detail_back')}</button>
              <button type="button" className="btn" onClick={handleAddSelected} disabled={adding || !picked.size}>
                {adding ? t('settings_adding') : picked.size ? tf('group_detail_add_n', { n: picked.size }) : t('group_detail_add')}
              </button>
            </div>
          </>
        )}

        {!pickerOpen && (
          <div className="modal-actions">
            <button type="button" className="btn secondary" onClick={onClose}>{t('btn_close')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
