import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { api, audioUrl, imageUrl } from '../api.js';

const METHOD_LABELS = { sms: 'Text', call: 'Phone call', voice_note: 'Voice note' };

const ALL_METHODS = [
  { value: 'sms', label: 'Text message' },
  { value: 'call', label: 'Phone call' },
  { value: 'voice_note', label: 'Voice note (MMS)' },
];

function emptyForm() {
  return { name: '', phone_number: '', email: '', address: '', methods: ['sms'], preferred_method: 'sms', notes: '', group_ids: [] };
}

// Maps common header variants in an uploaded spreadsheet to our field names
function normalizeRow(row) {
  const get = (...keys) => {
    for (const k of keys) {
      const found = Object.keys(row).find((rk) => rk.trim().toLowerCase() === k);
      if (found && row[found] !== undefined && row[found] !== '') return row[found];
    }
    return '';
  };
  return {
    name: get('name', 'full name', 'contact name'),
    phone_number: get('phone', 'phone number', 'phone_number', 'mobile', 'cell').toString(),
    email: get('email', 'email address'),
    address: get('address', 'street address'),
    notes: get('notes', 'note'),
    preferred_method: (get('preferred_method', 'method', 'contact method') || 'sms')
      .toString().toLowerCase().replace(/\s+/g, '_'),
  };
}

export default function Contacts() {
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importPreview, setImportPreview] = useState(null); // { valid: [...], invalidCount }
  const [importDefaultMethod, setImportDefaultMethod] = useState('sms');
  const [importGroupId, setImportGroupId] = useState('');
  const [importing, setImporting] = useState(false);
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [logContact, setLogContact] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkMethodOpen, setBulkMethodOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState('all');
  const fileInputRef = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const [c, g] = await Promise.all([api.contacts.list(), api.groups.list()]);
      setContacts(c);
      setGroups(g);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  }

  function openEdit(contact) {
    setEditing(contact);
    setForm({
      name: contact.name || '',
      phone_number: contact.phone_number,
      email: contact.email || '',
      address: contact.address || '',
      methods: contact.methods && contact.methods.length ? contact.methods : [contact.preferred_method],
      preferred_method: contact.preferred_method,
      notes: contact.notes || '',
      group_ids: contact.groups.map((g) => g.id),
    });
    setModalOpen(true);
  }

  function toggleMethod(value) {
    setForm((f) => {
      const has = f.methods.includes(value);
      let methods = has ? f.methods.filter((m) => m !== value) : [...f.methods, value];
      if (!methods.length) methods = [value];
      const preferred_method = methods.includes(f.preferred_method) ? f.preferred_method : methods[0];
      return { ...f, methods, preferred_method };
    });
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editing) {
        await api.contacts.update(editing.id, form);
      } else {
        await api.contacts.create(form);
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
    if (!confirm('Remove this contact?')) return;
    try {
      await api.contacts.remove(id);
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
      const allSelected = sortedContacts.length > 0 && sortedContacts.every((c) => prev.has(c.id));
      return allSelected ? new Set() : new Set(sortedContacts.map((c) => c.id));
    });
  }

  async function handleBulkDelete() {
    if (!selected.size) return;
    if (!confirm(`Remove ${selected.size} selected contact${selected.size !== 1 ? 's' : ''}? This can't be undone.`)) return;
    setBulkDeleting(true);
    setError('');
    try {
      await api.contacts.bulkDelete([...selected]);
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBulkDeleting(false);
    }
  }

  function toggleGroup(id) {
    setForm((f) => ({
      ...f,
      group_ids: f.group_ids.includes(id)
        ? f.group_ids.filter((g) => g !== id)
        : [...f.group_ids, id],
    }));
  }

  function handleImportClick() {
    setImportResult(null);
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setImportResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      const normalized = rows.map(normalizeRow);
      const valid = normalized.filter((r) => r.phone_number);
      const invalidCount = normalized.length - valid.length;

      if (!valid.length) {
        setError('No rows with a phone number were found in that file.');
        return;
      }

      setImportDefaultMethod('sms');
      setImportGroupId('');
      setImportPreview({ valid, invalidCount });
    } catch (err) {
      setError('Could not read that file. Make sure it\'s a .xlsx or .csv file with a phone number column.');
    } finally {
      e.target.value = '';
    }
  }

  async function handleConfirmImport() {
    if (!importPreview) return;
    setImporting(true);
    setError('');
    try {
      const rowsToImport = importPreview.valid.map((r) => ({
        ...r,
        preferred_method: r.preferred_method || importDefaultMethod,
      }));
      const result = await api.contacts.bulkImport(rowsToImport, importGroupId || null);
      setImportResult(result);
      setImportPreview(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  }

  function handleSort(field) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  const sortedContacts = useMemo(() => {
    const filtered = groupFilter === 'all'
      ? contacts
      : contacts.filter((c) => c.groups.some((g) => String(g.id) === String(groupFilter)));
    const copy = [...filtered];
    copy.sort((a, b) => {
      let av, bv;
      if (sortField === 'name') { av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); }
      else if (sortField === 'phone_number') { av = a.phone_number; bv = b.phone_number; }
      else if (sortField === 'groups') { av = (a.groups[0]?.name || '').toLowerCase(); bv = (b.groups[0]?.name || '').toLowerCase(); }
      else { av = ''; bv = ''; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [contacts, sortField, sortDir, groupFilter]);

  function sortArrow(field) {
    if (sortField !== field) return null;
    return <span className="sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Contacts</h1>
          <p>{contacts.length} contact{contacts.length !== 1 ? 's' : ''} in your list</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleFileSelected}
          />
          <button className="btn secondary" onClick={handleImportClick} disabled={importing}>
            <i className="ti ti-upload" /> {importing ? 'Importing...' : 'Import Excel'}
          </button>
          <button className="btn" onClick={openAdd}><i className="ti ti-plus" /> Add contact</button>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}
      {importResult && (
        <div className="banner ok">
          Imported {importResult.created} contact{importResult.created !== 1 ? 's' : ''}.
          {importResult.skipped > 0 && (
            <>
              {' '}{importResult.skipped} row{importResult.skipped !== 1 ? 's' : ''} skipped:
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {importResult.errors.slice(0, 10).map((e, i) => (
                  <li key={i} style={{ fontSize: 12.5 }}>
                    {e.row.phone_number || e.row.name || 'Row'} — {e.reason}
                  </li>
                ))}
                {importResult.errors.length > 10 && (
                  <li style={{ fontSize: 12.5 }}>...and {importResult.errors.length - 10} more</li>
                )}
              </ul>
            </>
          )}
        </div>
      )}

      {contacts.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button type="button" onClick={toggleSelectAll} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer' }}>
              {sortedContacts.length > 0 && sortedContacts.every((c) => selected.has(c.id)) ? 'Unselect all' : 'Select all'}
            </button>
            {selected.size > 0 && <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{selected.size} selected</span>}
          </div>
          {selected.size > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setBulkMethodOpen(true)}>
                <i className="ti ti-adjustments" /> Set method for {selected.size}
              </button>
              <button type="button" className="btn" style={{ padding: '6px 12px', fontSize: 13, background: 'var(--danger)' }} onClick={handleBulkDelete} disabled={bulkDeleting}>
                <i className="ti ti-trash" /> {bulkDeleting ? 'Deleting...' : `Delete ${selected.size}`}
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
      ) : contacts.length === 0 ? (
        <div className="card empty-state">
          <h3>No contacts yet</h3>
          <p>Add your first contact, import a spreadsheet, or call your Wonder Solutions line and press 3.</p>
        </div>
      ) : (
        <>
          {groups.length > 0 && (
            <div className="chip-select" style={{ marginBottom: 14 }}>
              <button
                type="button"
                className={`chip-toggle ${groupFilter === 'all' ? 'active' : ''}`}
                onClick={() => setGroupFilter('all')}
              >
                All contacts
              </button>
              {groups.map((g) => (
                <button
                  type="button"
                  key={g.id}
                  className={`chip-toggle ${String(groupFilter) === String(g.id) ? 'active' : ''}`}
                  onClick={() => setGroupFilter(g.id)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    checked={sortedContacts.length > 0 && sortedContacts.every((c) => selected.has(c.id))}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th onClick={() => handleSort('name')}>Name{sortArrow('name')}</th>
                <th onClick={() => handleSort('phone_number')}>Phone{sortArrow('phone_number')}</th>
                <th>Methods</th>
                <th onClick={() => handleSort('groups')}>Groups{sortArrow('groups')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedContacts.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelected(c.id)} />
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{c.name || 'Unnamed contact'}</div>
                    {c.email && <div style={{ color: 'var(--ink-soft)', fontSize: 12.5 }}>{c.email}</div>}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{c.phone_number}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {(c.methods && c.methods.length ? c.methods : [c.preferred_method]).map((m) => (
                        <span className={m === c.preferred_method ? 'pill' : 'pill signal'} key={m}>
                          {METHOD_LABELS[m]}{m === c.preferred_method ? ' ★' : ''}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {c.groups.map((g) => <span className="pill signal" key={g.id}>{g.name}</span>)}
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="icon-btn" onClick={() => setLogContact(c)} aria-label="View history"><i className="ti ti-history" /></button>
                      <button className="icon-btn" onClick={() => openEdit(c)} aria-label="Edit contact"><i className="ti ti-edit" /></button>
                      <button className="icon-btn danger" onClick={() => handleDelete(c.id)} aria-label="Delete contact"><i className="ti ti-trash" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? 'Edit contact' : 'Add contact'}</h2>
            <form onSubmit={handleSave}>
              <div className="field">
                <label>Name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Optional" />
              </div>
              <div className="field">
                <label>Phone number</label>
                <input
                  required
                  value={form.phone_number}
                  onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                  placeholder="+19145551234"
                />
              </div>
              <div className="field">
                <label>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="field">
                <label>Address</label>
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <label style={{ margin: 0 }}>How can they receive messages?</label>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, methods: ALL_METHODS.map((m) => m.value) }))}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer' }}
                  >
                    Select all
                  </button>
                </div>
                <p className="field-hint">Tap to select one or more.</p>
                <div className="chip-select">
                  {ALL_METHODS.map((m) => {
                    const active = form.methods.includes(m.value);
                    return (
                      <button
                        type="button"
                        key={m.value}
                        className={`chip-toggle ${active ? 'active' : ''}`}
                        onClick={() => toggleMethod(m.value)}
                      >
                        {active && <i className="ti ti-check" />}
                        {m.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {form.methods.length > 1 && (
                <div className="field">
                  <label>Default method</label>
                  <p className="field-hint">Used automatically when sending, unless you choose a different one for a specific send.</p>
                  <div className="chip-select">
                    {ALL_METHODS.filter((m) => form.methods.includes(m.value)).map((m) => {
                      const isDefault = form.preferred_method === m.value;
                      return (
                        <button
                          type="button"
                          key={m.value}
                          className={`chip-toggle ${isDefault ? 'active' : ''}`}
                          onClick={() => setForm((f) => ({ ...f, preferred_method: m.value }))}
                        >
                          <i className={isDefault ? 'ti ti-star-filled' : 'ti ti-star'} />
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {groups.length > 0 && (
                <div className="field">
                  <label>Groups</label>
                  <p className="field-hint">Optional — tap any group to add this contact to it.</p>
                  <div className="chip-select">
                    {groups.map((g) => {
                      const active = form.group_ids.includes(g.id);
                      return (
                        <button
                          type="button"
                          key={g.id}
                          className={`chip-toggle ${active ? 'active' : ''}`}
                          onClick={() => toggleGroup(g.id)}
                        >
                          {active && <i className="ti ti-check" />}
                          {g.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="field">
                <label>Notes</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn secondary" onClick={() => setModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn" disabled={saving}>{saving ? 'Saving...' : 'Save contact'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {logContact && (
        <ContactLogModal contact={logContact} onClose={() => setLogContact(null)} />
      )}

      {importPreview && (
        <div className="modal-overlay" onClick={() => !importing && setImportPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <h2>Review import</h2>
            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginBottom: 4 }}>
              {importPreview.valid.length} contact{importPreview.valid.length !== 1 ? 's' : ''} ready to import.
              {importPreview.invalidCount > 0 && ` ${importPreview.invalidCount} row${importPreview.invalidCount !== 1 ? 's' : ''} will be skipped (no phone number).`}
            </p>

            <div className="field">
              <label>Default method (for rows without one specified)</label>
              <div className="chip-select">
                {ALL_METHODS.map((m) => (
                  <button
                    type="button"
                    key={m.value}
                    className={`chip-toggle ${importDefaultMethod === m.value ? 'active' : ''}`}
                    onClick={() => setImportDefaultMethod(m.value)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {groups.length > 0 && (
              <div className="field">
                <label>Add all to a group (optional)</label>
                <select value={importGroupId} onChange={(e) => setImportGroupId(e.target.value)}>
                  <option value="">Don't add to a group</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            )}

            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 7, marginBottom: 14 }}>
              <table className="data-table" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr><th>Name</th><th>Phone</th><th>Method</th></tr>
                </thead>
                <tbody>
                  {importPreview.valid.slice(0, 100).map((r, i) => (
                    <tr key={i}>
                      <td>{r.name || '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{r.phone_number}</td>
                      <td>{METHOD_LABELS[r.preferred_method] || (
                        <span style={{ color: 'var(--ink-faint)' }}>{METHOD_LABELS[importDefaultMethod]} (default)</span>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {importPreview.valid.length > 100 && (
                <p style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '8px 10px' }}>
                  ...and {importPreview.valid.length - 100} more
                </p>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setImportPreview(null)} disabled={importing}>Cancel</button>
              <button type="button" className="btn" onClick={handleConfirmImport} disabled={importing}>
                {importing ? 'Importing...' : `Import ${importPreview.valid.length} contact${importPreview.valid.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {bulkMethodOpen && (
        <BulkMethodModal
          count={selected.size}
          onClose={() => setBulkMethodOpen(false)}
          onSaved={async () => { setBulkMethodOpen(false); setSelected(new Set()); await load(); }}
          contactIds={[...selected]}
        />
      )}
    </div>
  );
}

const METHOD_LABELS_LOWER = { sms: 'text', call: 'phone call', voice_note: 'voice note' };

function BulkMethodModal({ count, contactIds, onClose, onSaved }) {
  const [methods, setMethods] = useState(['sms']);
  const [preferred, setPreferred] = useState('sms');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggleMethod(value) {
    setMethods((prev) => {
      const has = prev.includes(value);
      let next = has ? prev.filter((m) => m !== value) : [...prev, value];
      if (!next.length) next = [value];
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await api.contacts.bulkUpdate(contactIds, methods, preferred);
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
        <h2>Set method for {count} contact{count !== 1 ? 's' : ''}</h2>
        {error && <div className="banner error">{error}</div>}
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 4 }}>
          This replaces how these contacts receive messages — their current method settings will be overwritten.
        </p>

        <div className="field">
          <label>Enabled methods</label>
          <div className="chip-select">
            {ALL_METHODS.map((m) => {
              const active = methods.includes(m.value);
              return (
                <button
                  type="button"
                  key={m.value}
                  className={`chip-toggle ${active ? 'active' : ''}`}
                  onClick={() => toggleMethod(m.value)}
                >
                  {active && <i className="ti ti-check" />}
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {methods.length > 1 && (
          <div className="field">
            <label>Default method</label>
            <div className="chip-select">
              {ALL_METHODS.filter((m) => methods.includes(m.value)).map((m) => (
                <button
                  type="button"
                  key={m.value}
                  className={`chip-toggle ${preferred === m.value ? 'active' : ''}`}
                  onClick={() => setPreferred(m.value)}
                >
                  <i className={preferred === m.value ? 'ti ti-star-filled' : 'ti ti-star'} />
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : `Apply to ${count}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactLogModal({ contact, onClose }) {
  const [sends, setSends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.sends.listForContact(contact.id)
      .then(setSends)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [contact.id]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>History for {contact.name || contact.phone_number}</h2>
        {error && <div className="banner error">{error}</div>}
        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
        ) : sends.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>Nothing has been sent to this contact yet.</p>
        ) : (
          <div className="list" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {sends.map((s) => (
              <div className="row" key={s.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                  <div className="row-main">
                    <span className="row-title">{s.message_title || 'Untitled'}</span>
                    <span className="row-sub">
                      via {METHOD_LABELS_LOWER[s.effective_method] || s.effective_method}
                      {s.sent_at && ` · ${new Date(s.sent_at).toLocaleString()}`}
                      {s.status === 'scheduled' && s.scheduled_at && ` · scheduled for ${new Date(s.scheduled_at).toLocaleString()}`}
                    </span>
                    {s.error_message && <span className="row-sub" style={{ color: 'var(--danger)' }}>{s.error_message}</span>}
                  </div>
                  <span className="pill" style={s.status === 'failed' ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : undefined}>
                    {s.status === 'sent' ? 'Sent' : s.status}
                  </span>
                </div>
                {s.message_text && (
                  <p style={{ fontSize: 13, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 7, padding: '8px 10px', margin: '8px 0 0', whiteSpace: 'pre-wrap' }}>
                    {s.message_text}
                  </p>
                )}
                {(s.message_audio_url || s.message_has_uploaded_audio) && (
                  <audio controls src={audioUrl(s.message_id)} style={{ width: '100%', marginTop: 8 }} />
                )}
                {s.message_has_image && (
                  <img src={imageUrl(s.message_id)} alt={s.message_title || 'Photo'} style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8, marginTop: 8, display: 'block' }} />
                )}
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
