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

// Fields we can pull from an uploaded spreadsheet, and the header names we
// guess against when auto-mapping columns
const IMPORT_FIELDS = [
  { key: 'phone_number', label: 'Phone number', required: true, synonyms: ['phone', 'phone number', 'phone_number', 'mobile', 'cell'] },
  { key: 'name', label: 'Name', synonyms: ['name', 'full name', 'contact name'] },
  { key: 'email', label: 'Email', synonyms: ['email', 'email address'] },
  { key: 'address', label: 'Address', synonyms: ['address', 'street address'] },
  { key: 'notes', label: 'Notes', synonyms: ['notes', 'note'] },
  { key: 'preferred_method', label: 'Preferred method', synonyms: ['preferred_method', 'method', 'contact method'] },
];

// Reads a sheet into a header row + raw data rows, keyed by column index
// rather than header text, so mapping works even with blank/duplicate headers
function readSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const headerRow = raw[0] || [];
  const headers = headerRow.map((h, i) => {
    const text = (h ?? '').toString().trim();
    return text || `Column ${XLSX.utils.encode_col(i)}`;
  });
  const dataRows = raw.slice(1).filter((r) => r.some((cell) => cell !== '' && cell !== undefined && cell !== null));
  return { headers, dataRows };
}

// Guesses which column index goes with each of our fields, based on header text
function guessMapping(headers) {
  const mapping = {};
  for (const f of IMPORT_FIELDS) {
    const idx = headers.findIndex((h) => f.synonyms.includes(h.trim().toLowerCase()));
    mapping[f.key] = idx >= 0 ? idx : '';
  }
  return mapping;
}

// Turns one raw spreadsheet row (array of cells) into our contact shape, using the mapping
function extractRow(rowArr, mapping) {
  const get = (key) => {
    const idx = mapping[key];
    if (idx === '' || idx === undefined || idx === null) return '';
    const v = rowArr[idx];
    return v === undefined || v === null ? '' : v;
  };
  return {
    name: get('name').toString(),
    phone_number: get('phone_number').toString(),
    email: get('email').toString(),
    address: get('address').toString(),
    notes: get('notes').toString(),
    preferred_method: (get('preferred_method') || '').toString().toLowerCase().replace(/\s+/g, '_'),
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
  const [importWorkbook, setImportWorkbook] = useState(null);
  const [importSheetNames, setImportSheetNames] = useState([]);
  const [importSheetName, setImportSheetName] = useState('');
  const [importHeaders, setImportHeaders] = useState([]);
  const [importDataRows, setImportDataRows] = useState([]);
  const [importMapping, setImportMapping] = useState({});
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

  function loadSheet(workbook, sheetName) {
    const { headers, dataRows } = readSheet(workbook, sheetName);
    setImportSheetName(sheetName);
    setImportHeaders(headers);
    setImportDataRows(dataRows);
    setImportMapping(guessMapping(headers));
  }

  function handleSheetChange(sheetName) {
    loadSheet(importWorkbook, sheetName);
  }

  function resetImport() {
    if (importing) return;
    setImportWorkbook(null);
    setImportSheetNames([]);
    setImportSheetName('');
    setImportHeaders([]);
    setImportDataRows([]);
    setImportMapping({});
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setImportResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      if (!workbook.SheetNames.length) {
        setError('That file has no sheets.');
        return;
      }
      setImportWorkbook(workbook);
      setImportSheetNames(workbook.SheetNames);
      loadSheet(workbook, workbook.SheetNames[0]);
      setImportDefaultMethod('sms');
      setImportGroupId('');
    } catch (err) {
      setError('Could not read that file. Make sure it\'s a .xlsx, .xls, or .csv file.');
    } finally {
      e.target.value = '';
    }
  }

  const importExtracted = useMemo(() => {
    if (!importDataRows.length) return { valid: [], invalidCount: 0 };
    const rows = importDataRows.map((r) => extractRow(r, importMapping));
    const valid = rows.filter((r) => r.phone_number);
    return { valid, invalidCount: rows.length - valid.length };
  }, [importDataRows, importMapping]);

  async function handleConfirmImport() {
    if (!importExtracted.valid.length) return;
    setImporting(true);
    setError('');
    try {
      const rowsToImport = importExtracted.valid.map((r) => ({
        ...r,
        preferred_method: r.preferred_method || importDefaultMethod,
      }));
      const result = await api.contacts.bulkImport(rowsToImport, importGroupId || null);
      setImportResult(result);
      resetImport();
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

      {importWorkbook && (
        <div className="modal-overlay" onClick={() => resetImport()}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <h2>Import contacts</h2>

            <details style={{ marginBottom: 14 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: 13 }}>
                Tips for a smooth import
              </summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--ink-soft)' }}>
                <li>Use one header row at the top, then one contact per row below it.</li>
                <li>Helpful column names: Name, Phone Number, Email, Address, Notes, Preferred Method.</li>
                <li>Phone numbers should include the country code, e.g. +19145551234.</li>
                <li>Preferred method can be sms, call, or voice_note — leave it blank to use the default you pick below.</li>
                <li>If your workbook has multiple sheets, only one can be imported at a time — pick it below.</li>
              </ul>
            </details>

            {importSheetNames.length > 1 && (
              <div className="field">
                <label>Sheet</label>
                <select value={importSheetName} onChange={(e) => handleSheetChange(e.target.value)}>
                  {importSheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}

            <div className="field">
              <label>Match spreadsheet columns</label>
              <p className="field-hint">We guessed these from your header row — adjust anything that looks wrong.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {IMPORT_FIELDS.map((f) => (
                  <div key={f.key}>
                    <label style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
                      {f.label}{f.required ? ' *' : ''}
                    </label>
                    <select
                      value={importMapping[f.key] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setImportMapping((m) => ({ ...m, [f.key]: v === '' ? '' : Number(v) }));
                      }}
                    >
                      <option value="">— Not in file —</option>
                      {importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginBottom: 4 }}>
              {importExtracted.valid.length} contact{importExtracted.valid.length !== 1 ? 's' : ''} ready to import.
              {importExtracted.invalidCount > 0 && ` ${importExtracted.invalidCount} row${importExtracted.invalidCount !== 1 ? 's' : ''} will be skipped (no phone number).`}
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
                  {importExtracted.valid.slice(0, 100).map((r, i) => (
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
              {importExtracted.valid.length === 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', padding: '8px 10px' }}>
                  No rows yet — check that "Phone number" is mapped to the right column above.
                </p>
              )}
              {importExtracted.valid.length > 100 && (
                <p style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '8px 10px' }}>
                  ...and {importExtracted.valid.length - 100} more
                </p>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => resetImport()} disabled={importing}>Cancel</button>
              <button type="button" className="btn" onClick={handleConfirmImport} disabled={importing || !importExtracted.valid.length}>
                {importing ? 'Importing...' : `Import ${importExtracted.valid.length} contact${importExtracted.valid.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
      {bulkMethodOpen && (
        <BulkMethodModal
          count={selected.size}
          groups={groups}
          onClose={() => setBulkMethodOpen(false)}
          onSaved={async () => { setBulkMethodOpen(false); setSelected(new Set()); await load(); }}
          contactIds={[...selected]}
        />
      )}
    </div>
  );
}

const METHOD_LABELS_LOWER = { sms: 'text', call: 'phone call', voice_note: 'voice note' };

function BulkMethodModal({ count, contactIds, groups, onClose, onSaved }) {
  const [methods, setMethods] = useState(['sms']);
  const [preferred, setPreferred] = useState('sms');
  const [groupIds, setGroupIds] = useState([]);
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

  function toggleGroupId(id) {
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      await api.contacts.bulkUpdate(contactIds, methods, preferred);
      if (groupIds.length) await api.groups.bulkAssign(contactIds, groupIds);
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
        <h2>Update {count} contact{count !== 1 ? 's' : ''}</h2>
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

        {groups.length > 0 && (
          <div className="field">
            <label>Add to group(s)</label>
            <p className="field-hint">Optional — adds these contacts to the selected groups without removing any existing memberships.</p>
            <div className="chip-select">
              {groups.map((g) => {
                const active = groupIds.includes(g.id);
                return (
                  <button
                    type="button"
                    key={g.id}
                    className={`chip-toggle ${active ? 'active' : ''}`}
                    onClick={() => toggleGroupId(g.id)}
                  >
                    {active && <i className="ti ti-check" />}
                    {g.name}
                  </button>
                );
              })}
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
