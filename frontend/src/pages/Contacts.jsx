import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { api, audioUrl, imageUrl, contactDisplayName } from '../api.js';
import { t } from '../i18n.js';

function METHOD_LABELS_MAP() {
  return { sms: t('method_sms').split(' ')[0], call: t('method_call'), voice_note: t('method_voice_note') };
}
const METHOD_LABELS = { sms: 'Text', call: 'Phone call', voice_note: 'Voice note' };

// For the First name column: shows the legacy full name when a contact
// hasn't been split into first/last yet, so it isn't just blank
function firstNameCell(c) {
  if (c.first_name) return c.first_name;
  if (!c.last_name) return c.name || 'Unnamed contact';
  return '';
}

function getAllMethods() {
  return [
    { value: 'sms', label: t('method_sms') },
    { value: 'call', label: t('method_call') },
    { value: 'voice_note', label: t('method_voice_note') },
  ];
}

function getAllColumns() {
  return [
    { key: 'last_name', label: t('col_last_name'), default: true },
    { key: 'phone_number', label: t('col_phone'), default: true },
    { key: 'email', label: t('col_email'), default: false },
    { key: 'address', label: t('col_address'), default: false },
    { key: 'city', label: t('col_city'), default: false },
    { key: 'state', label: t('col_state'), default: false },
    { key: 'zip', label: t('col_zip'), default: false },
    { key: 'country', label: t('col_country'), default: false },
    { key: 'methods', label: t('col_methods'), default: true },
    { key: 'groups', label: t('col_groups'), default: true },
  ];
}
const ALL_COLUMNS = [
  { key: 'last_name', default: true },
  { key: 'phone_number', default: true },
  { key: 'email', default: false },
  { key: 'address', default: false },
  { key: 'city', default: false },
  { key: 'state', default: false },
  { key: 'zip', default: false },
  { key: 'country', default: false },
  { key: 'methods', default: true },
  { key: 'groups', default: true },
];
const DEFAULT_VISIBLE_COLUMNS = ALL_COLUMNS.filter((c) => c.default).map((c) => c.key);

function emptyForm() {
  return {
    first_name: '', last_name: '', phone_number: '', email: '',
    address: '', city: '', state: '', zip: '', country: '',
    methods: ['sms'], preferred_method: 'sms', notes: '', group_ids: [],
  };
}

// Fields we can pull from an uploaded spreadsheet, and the header names we
// guess against when auto-mapping columns
const IMPORT_FIELDS = [
  { key: 'phone_number', label: 'Phone number', required: true, synonyms: ['phone', 'phone number', 'phone_number', 'mobile', 'cell'] },
  { key: 'first_name', label: 'First name', synonyms: ['first name', 'first_name', 'firstname', 'fname', 'given name'] },
  { key: 'last_name', label: 'Last name', synonyms: ['last name', 'last_name', 'lastname', 'lname', 'surname', 'family name'] },
  { key: 'full_name', label: 'Full name (splits into first/last)', synonyms: ['name', 'full name', 'contact name'] },
  { key: 'email', label: 'Email', synonyms: ['email', 'email address'] },
  { key: 'address', label: 'Address', synonyms: ['address', 'street address'] },
  { key: 'city', label: 'City', synonyms: ['city', 'town'] },
  { key: 'state', label: 'State', synonyms: ['state', 'province', 'region'] },
  { key: 'zip', label: 'Zip', synonyms: ['zip', 'zip code', 'zipcode', 'postal code', 'postalcode'] },
  { key: 'country', label: 'Country', synonyms: ['country'] },
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

// Splits "John Smith" into { first: 'John', last: 'Smith' }; a single word goes entirely to first
function splitFullName(full) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: full.trim(), last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

// Turns one raw spreadsheet row (array of cells) into our contact shape, using the mapping
function extractRow(rowArr, mapping) {
  const get = (key) => {
    const idx = mapping[key];
    if (idx === '' || idx === undefined || idx === null) return '';
    const v = rowArr[idx];
    return v === undefined || v === null ? '' : v;
  };

  let first_name = get('first_name').toString();
  let last_name = get('last_name').toString();
  const fullName = get('full_name').toString();
  if (!first_name && !last_name && fullName) {
    const split = splitFullName(fullName);
    first_name = split.first;
    last_name = split.last;
  }

  return {
    first_name,
    last_name,
    phone_number: get('phone_number').toString(),
    email: get('email').toString(),
    address: get('address').toString(),
    city: get('city').toString(),
    state: get('state').toString(),
    zip: get('zip').toString(),
    country: get('country').toString(),
    notes: get('notes').toString(),
    preferred_method: (get('preferred_method') || '').toString().toLowerCase().replace(/\s+/g, '_'),
  };
}

export default function Contacts() {
  const ALL_METHODS_T = getAllMethods();
  const ALL_COLUMNS_T = getAllColumns();
  const ML = METHOD_LABELS_MAP();
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
  const [importDefaultMethod, setImportDefaultMethod] = useState('');
  const [importGroupId, setImportGroupId] = useState('');
  const [importing, setImporting] = useState(false);
  const [sortField, setSortField] = useState('first_name');
  const [sortDir, setSortDir] = useState('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [logContact, setLogContact] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkMethodOpen, setBulkMethodOpen] = useState(false);
  const [bulkGroupOpen, setBulkGroupOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState('all');
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = localStorage.getItem('wonder_contacts_columns');
      return saved ? JSON.parse(saved) : DEFAULT_VISIBLE_COLUMNS;
    } catch {
      return DEFAULT_VISIBLE_COLUMNS;
    }
  });
  const [columnsOpen, setColumnsOpen] = useState(false);

  function toggleColumn(key) {
    setVisibleCols((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      localStorage.setItem('wonder_contacts_columns', JSON.stringify(next));
      return next;
    });
  }
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
      first_name: contact.first_name || '',
      last_name: contact.last_name || '',
      phone_number: contact.phone_number,
      email: contact.email || '',
      address: contact.address || '',
      city: contact.city || '',
      state: contact.state || '',
      zip: contact.zip || '',
      country: contact.country || '',
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
    if (!confirm(t('contacts_confirm_remove'))) return;
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
      setImportDefaultMethod('');
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
    let filtered = groupFilter === 'all'
      ? contacts
      : contacts.filter((c) => c.groups.some((g) => String(g.id) === String(groupFilter)));
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((c) => {
        const name = `${c.first_name || ''} ${c.last_name || ''} ${c.name || ''}`.toLowerCase();
        return name.includes(q) || (c.phone_number || '').includes(q) || (c.email || '').toLowerCase().includes(q);
      });
    }
    const copy = [...filtered];
    copy.sort((a, b) => {
      let av, bv;
      if (sortField === 'first_name') { av = firstNameCell(a).toLowerCase(); bv = firstNameCell(b).toLowerCase(); }
      else if (sortField === 'last_name') { av = (a.last_name || '').toLowerCase(); bv = (b.last_name || '').toLowerCase(); }
      else if (sortField === 'phone_number') { av = a.phone_number; bv = b.phone_number; }
      else if (sortField === 'groups') { av = (a.groups[0]?.name || '').toLowerCase(); bv = (b.groups[0]?.name || '').toLowerCase(); }
      else { av = ''; bv = ''; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }, [contacts, sortField, sortDir, groupFilter, searchQuery]);

  function sortArrow(field) {
    if (sortField !== field) return null;
    return <span className="sort-arrow">{sortDir === 'asc' ? '▲' : '▼'}</span>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1>{t('contacts_title')}</h1>
          <p>{contacts.length} {contacts.length === 1 ? t('contacts_count_one') : t('contacts_count_other')}</p>
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
            <i className="ti ti-upload" /> {importing ? t('contacts_importing') : t('contacts_import')}
          </button>
          <div style={{ position: 'relative' }}>
            <button className="btn secondary" onClick={() => setColumnsOpen((o) => !o)}>
              <i className="ti ti-columns" /> {t('contacts_columns')}
            </button>
            {columnsOpen && (
              <div
                className="card"
                style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, padding: 12, zIndex: 10, minWidth: 180 }}
              >
                {ALL_COLUMNS_T.map((col) => (
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
          <button className="btn" onClick={openAdd}><i className="ti ti-plus" /> {t('contacts_add')}</button>
        </div>
      </div>

      <div style={{ flexShrink: 0 }}>
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
                      {e.row.phone_number || [e.row.first_name, e.row.last_name].filter(Boolean).join(' ') || 'Row'} — {e.reason}
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
          <div className="field" style={{ maxWidth: 320, marginBottom: 12 }}>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('contacts_search_placeholder')}
            />
          </div>
        )}

        {contacts.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button type="button" onClick={toggleSelectAll} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer' }}>
                {sortedContacts.length > 0 && sortedContacts.every((c) => selected.has(c.id)) ? t('contacts_unselect_all') : t('contacts_select_all')}
              </button>
              {selected.size > 0 && <span style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>{selected.size} {t('contacts_selected')}</span>}
            </div>
            {selected.size > 0 && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setBulkMethodOpen(true)}>
                  <i className="ti ti-adjustments" /> {t('contacts_set_method_for')} {selected.size}
                </button>
                {groups.length > 0 && (
                  <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setBulkGroupOpen(true)}>
                    <i className="ti ti-users-group" /> {t('contacts_add_to_group')} ({selected.size})
                  </button>
                )}
                <button type="button" className="btn" style={{ padding: '6px 12px', fontSize: 13, background: 'var(--danger)' }} onClick={handleBulkDelete} disabled={bulkDeleting}>
                  <i className="ti ti-trash" /> {bulkDeleting ? t('contacts_deleting') : `${t('contacts_delete')} ${selected.size}`}
                </button>
              </div>
            )}
          </div>
        )}

        {!loading && contacts.length > 0 && groups.length > 0 && (
          <div className="chip-select" style={{ marginBottom: 14 }}>
            <button
              type="button"
              className={`chip-toggle ${groupFilter === 'all' ? 'active' : ''}`}
              onClick={() => setGroupFilter('all')}
            >
              {t('contacts_all')}
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
      </div>

      <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
        ) : contacts.length === 0 ? (
          <div className="card empty-state">
            <h3>{t('contacts_empty_title')}</h3>
            <p>{t('contacts_empty_body')}</p>
          </div>
        ) : (
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
                <th onClick={() => handleSort('first_name')}>{t('col_first_name')}{sortArrow('first_name')}</th>
                {visibleCols.includes('last_name') && <th onClick={() => handleSort('last_name')}>{t('col_last_name')}{sortArrow('last_name')}</th>}
                {visibleCols.includes('phone_number') && <th onClick={() => handleSort('phone_number')}>{t('col_phone')}{sortArrow('phone_number')}</th>}
                {visibleCols.includes('email') && <th>{t('col_email')}</th>}
                {visibleCols.includes('address') && <th>{t('col_address')}</th>}
                {visibleCols.includes('city') && <th>{t('col_city')}</th>}
                {visibleCols.includes('state') && <th>{t('col_state')}</th>}
                {visibleCols.includes('zip') && <th>{t('col_zip')}</th>}
                {visibleCols.includes('country') && <th>{t('col_country')}</th>}
                {visibleCols.includes('methods') && <th>{t('col_methods')}</th>}
                {visibleCols.includes('groups') && <th onClick={() => handleSort('groups')}>{t('col_groups')}{sortArrow('groups')}</th>}
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
                    <div style={{ fontWeight: 500 }}>{firstNameCell(c)}</div>
                  </td>
                  {visibleCols.includes('last_name') && <td style={{ fontWeight: 500 }}>{c.last_name || ''}</td>}
                  {visibleCols.includes('phone_number') && <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, whiteSpace: 'nowrap' }}>{c.phone_number}</td>}
                  {visibleCols.includes('email') && <td style={{ fontSize: 13 }}>{c.email || ''}</td>}
                  {visibleCols.includes('address') && <td style={{ fontSize: 13 }}>{c.address || ''}</td>}
                  {visibleCols.includes('city') && <td style={{ fontSize: 13 }}>{c.city || ''}</td>}
                  {visibleCols.includes('state') && <td style={{ fontSize: 13 }}>{c.state || ''}</td>}
                  {visibleCols.includes('zip') && <td style={{ fontSize: 13 }}>{c.zip || ''}</td>}
                  {visibleCols.includes('country') && <td style={{ fontSize: 13 }}>{c.country || ''}</td>}
                  {visibleCols.includes('methods') && (
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {(c.methods && c.methods.length ? c.methods : [c.preferred_method]).map((m) => (
                          <span className={m === c.preferred_method ? 'pill' : 'pill signal'} key={m}>
                            {ML[m]}{m === c.preferred_method ? ' ★' : ''}
                          </span>
                        ))}
                      </div>
                    </td>
                  )}
                  {visibleCols.includes('groups') && (
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {c.groups.map((g) => <span className="pill signal" key={g.id}>{g.name}</span>)}
                      </div>
                    </td>
                  )}
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
        )}
      </div>

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? t('contact_modal_edit') : t('contact_modal_add')}</h2>
            <form onSubmit={handleSave}>
              <div className="field">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label>{t('field_first_name')}</label>
                    <input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} placeholder={t('field_optional')} />
                  </div>
                  <div>
                    <label>{t('field_last_name')}</label>
                    <input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} placeholder={t('field_optional')} />
                  </div>
                </div>
              </div>
              <div className="field">
                <label>{t('field_phone_number')}</label>
                <input
                  required
                  value={form.phone_number}
                  onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
                  placeholder="+19145551234"
                />
              </div>
              <div className="field">
                <label>{t('field_email')}</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder={t('field_optional')}
                />
              </div>
              <div className="field">
                <label>{t('field_address')}</label>
                <input
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder={t('field_optional')}
                />
              </div>
              <div className="field">
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10 }}>
                  <div>
                    <label>{t('field_city')}</label>
                    <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder={t('field_optional')} />
                  </div>
                  <div>
                    <label>{t('field_state')}</label>
                    <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} placeholder={t('field_optional')} />
                  </div>
                  <div>
                    <label>{t('field_zip')}</label>
                    <input value={form.zip} onChange={(e) => setForm({ ...form, zip: e.target.value })} placeholder={t('field_optional')} />
                  </div>
                </div>
              </div>
              <div className="field">
                <label>{t('field_country')}</label>
                <input
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                  placeholder={t('field_optional')}
                />
              </div>
              <div className="field">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <label style={{ margin: 0 }}>{t('field_how_receive')}</label>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, methods: ALL_METHODS_T.map((m) => m.value) }))}
                    style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer' }}
                  >
                    {t('contacts_select_all')}
                  </button>
                </div>
                <p className="field-hint">{t('field_tap_select')}</p>
                <div className="chip-select">
                  {ALL_METHODS_T.map((m) => {
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
                  <label>{t('field_default_method')}</label>
                  <p className="field-hint">{t('field_default_method_hint')}</p>
                  <div className="chip-select">
                    {ALL_METHODS_T.filter((m) => form.methods.includes(m.value)).map((m) => {
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
                  <label>{t('col_groups')}</label>
                  <p className="field-hint">{t('field_groups_hint')}</p>
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
                <label>{t('field_notes')}</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder={t('field_optional')}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn secondary" onClick={() => setModalOpen(false)}>{t('btn_cancel')}</button>
                <button type="submit" className="btn" disabled={saving}>{saving ? t('btn_saving') : t('btn_save_contact')}</button>
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
            <h2>{t('import_title')}</h2>

            <details style={{ marginBottom: 14 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: 13 }}>
                {t('import_tips_summary')}
              </summary>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--ink-soft)' }}>
                <li>{t('import_tip1')}</li>
                <li>{t('import_tip2')}</li>
                <li>{t('import_tip3')}</li>
                <li>{t('import_tip4')}</li>
                <li>{t('import_tip5')}</li>
              </ul>
            </details>

            {importSheetNames.length > 1 && (
              <div className="field">
                <label>{t('import_sheet')}</label>
                <select value={importSheetName} onChange={(e) => handleSheetChange(e.target.value)}>
                  {importSheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}

            <div className="field">
              <label>{t('import_match_columns')}</label>
              <p className="field-hint">{t('import_match_hint')}</p>
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
                      <option value="">{t('import_not_in_file')}</option>
                      {importHeaders.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            <p style={{ fontSize: 13.5, color: 'var(--ink-soft)', marginBottom: 4 }}>
              {importExtracted.valid.length} {importExtracted.valid.length === 1 ? t('import_ready_one') : t('import_ready_other')}
              {importExtracted.invalidCount > 0 && ` ${importExtracted.invalidCount} ${importExtracted.invalidCount === 1 ? t('import_skipped_one') : t('import_skipped_other')}`}
            </p>

            <div className="field">
              <label>{t('import_default_method')}</label>
              <select value={importDefaultMethod} onChange={(e) => setImportDefaultMethod(e.target.value)}>
                <option value="">{t('import_no_default')}</option>
                {ALL_METHODS_T.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>

            {groups.length > 0 && (
              <div className="field">
                <label>{t('import_add_to_group')}</label>
                <select value={importGroupId} onChange={(e) => setImportGroupId(e.target.value)}>
                  <option value="">{t('import_no_group')}</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            )}

            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 7, marginBottom: 14 }}>
              <table className="data-table" style={{ fontSize: 12.5 }}>
                <thead>
                  <tr><th>{t('import_col_name')}</th><th>{t('import_col_phone')}</th><th>{t('import_col_method')}</th></tr>
                </thead>
                <tbody>
                  {importExtracted.valid.slice(0, 100).map((r, i) => (
                    <tr key={i}>
                      <td>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{r.phone_number}</td>
                      <td>{ML[r.preferred_method] || (
                        <span style={{ color: 'var(--ink-faint)' }}>
                          {importDefaultMethod ? ML[importDefaultMethod] : ML.sms}
                        </span>
                      )}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {importExtracted.valid.length === 0 && (
                <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', padding: '8px 10px' }}>
                  {t('import_no_rows_hint')}
                </p>
              )}
              {importExtracted.valid.length > 100 && (
                <p style={{ fontSize: 12, color: 'var(--ink-faint)', padding: '8px 10px' }}>
                  {t('import_and_more').replace('{n}', importExtracted.valid.length - 100)}
                </p>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => resetImport()} disabled={importing}>{t('btn_cancel')}</button>
              <button type="button" className="btn" onClick={handleConfirmImport} disabled={importing || !importExtracted.valid.length}>
                {importing ? t('contacts_importing') : t('btn_import_n').replace('{n}', importExtracted.valid.length).replace('{s}', importExtracted.valid.length !== 1 ? 's' : '')}
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
      {bulkGroupOpen && (
        <BulkGroupModal
          count={selected.size}
          groups={groups}
          onClose={() => setBulkGroupOpen(false)}
          onSaved={async () => { setBulkGroupOpen(false); setSelected(new Set()); await load(); }}
          contactIds={[...selected]}
        />
      )}
    </div>
  );
}

function METHOD_LABELS_LOWER_MAP() {
  return { sms: t('method_sms').toLowerCase(), call: t('method_call').toLowerCase(), voice_note: t('method_voice_note').toLowerCase() };
}
const METHOD_LABELS_LOWER = { sms: 'text', call: 'phone call', voice_note: 'voice note' };

function BulkMethodModal({ count, contactIds, onClose, onSaved }) {
  const ALL_METHODS_T = getAllMethods();
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
        <h2>{t('bulk_update_title').replace('{n}', count)}</h2>
        {error && <div className="banner error">{error}</div>}
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 4 }}>
          {t('bulk_update_warning')}
        </p>

        <div className="field">
          <label>{t('bulk_enabled_methods')}</label>
          <div className="chip-select">
            {ALL_METHODS_T.map((m) => {
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
            <label>{t('field_default_method')}</label>
            <div className="chip-select">
              {ALL_METHODS_T.filter((m) => methods.includes(m.value)).map((m) => (
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
          <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>{t('btn_cancel')}</button>
          <button type="button" className="btn" onClick={handleSave} disabled={saving}>
            {saving ? t('btn_saving') : t('bulk_apply_to').replace('{n}', count)}
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkGroupModal({ count, contactIds, groups, onClose, onSaved }) {
  const [groupIds, setGroupIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggleGroupId(id) {
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  }

  async function handleSave() {
    if (!groupIds.length) return;
    setSaving(true);
    setError('');
    try {
      await api.groups.bulkAssign(contactIds, groupIds);
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
        <h2>{t('bulk_group_title').replace('{n}', count)}</h2>
        {error && <div className="banner error">{error}</div>}
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 4 }}>
          {t('bulk_group_body')}
        </p>

        <div className="field">
          <label>{t('col_groups')}</label>
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

        <div className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>{t('btn_cancel')}</button>
          <button type="button" className="btn" onClick={handleSave} disabled={saving || !groupIds.length}>
            {saving ? t('btn_saving') : t('bulk_apply_to').replace('{n}', count)}
          </button>
        </div>
      </div>
    </div>
  );
}

function ContactLogModal({ contact, onClose }) {
  const ML = METHOD_LABELS_LOWER_MAP();
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
        <h2>{t('contact_history_title')} {contactDisplayName(contact) || contact.phone_number}</h2>
        {error && <div className="banner error">{error}</div>}
        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
        ) : sends.length === 0 ? (
          <p style={{ color: 'var(--ink-soft)', fontSize: 14 }}>{t('contact_history_empty')}</p>
        ) : (
          <div className="list" style={{ maxHeight: 360, overflowY: 'auto' }}>
            {sends.map((s) => (
              <div className="row" key={s.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                  <div className="row-main">
                    <span className="row-title">{s.message_title || t('label_untitled')}</span>
                    <span className="row-sub">
                      {t('contact_history_via')} {ML[s.effective_method] || s.effective_method}
                      {s.sent_at && ` · ${new Date(s.sent_at).toLocaleString()}`}
                      {s.status === 'scheduled' && s.scheduled_at && ` · ${t('contact_history_scheduled_for')} ${new Date(s.scheduled_at).toLocaleString()}`}
                    </span>
                    {s.error_message && <span className="row-sub" style={{ color: 'var(--danger)' }}>{s.error_message}</span>}
                  </div>
                  <span className="pill" style={s.status === 'failed' ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : undefined}>
                    {s.status === 'sent' ? t('status_sent') : s.status}
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
          <button type="button" className="btn secondary" onClick={onClose}>{t('btn_close')}</button>
        </div>
      </div>
    </div>
  );
}
