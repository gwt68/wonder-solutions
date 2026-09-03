import React, { useEffect, useState } from 'react';
import { api, contactDisplayName } from '../api.js';

export default function GroupChat() {
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [postsLoading, setPostsLoading] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [enableOpen, setEnableOpen] = useState(false);
  const [view, setView] = useState('feed');
  const [period, setPeriod] = useState('day');
  const [usage, setUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const active = chats.find((c) => c.id === activeId) || null;

  async function loadChats(keepActive = true) {
    setLoading(true);
    try {
      const rows = await api.groups.chatEnabled();
      setChats(rows);
      if (!keepActive || !rows.some((r) => r.id === activeId)) {
        setActiveId(rows.length ? rows[0].id : null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadPosts(groupId) {
    if (!groupId) { setPosts([]); return; }
    setPostsLoading(true);
    try {
      setPosts(await api.groups.posts(groupId));
    } catch (err) {
      setError(err.message);
    } finally {
      setPostsLoading(false);
    }
  }

  async function loadUsage(p) {
    setUsageLoading(true);
    try {
      setUsage(await api.groups.usage(p));
    } catch (err) {
      setError(err.message);
    } finally {
      setUsageLoading(false);
    }
  }

  useEffect(() => { loadChats(false); }, []);
  useEffect(() => { loadPosts(activeId); }, [activeId]);
  useEffect(() => { if (view === 'history') loadUsage(period); }, [view, period]);

  function bucketLabel(iso) {
    const d = new Date(iso);
    if (period === 'hour') return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });
    if (period === 'month') return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (period === 'week') return `Week of ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (secs < 60) return 'just now';
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
    if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <div>
          <h1>Group Chat</h1>
          <p>Members text the group and everyone in it gets the message.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="chip-select" style={{ marginBottom: 0 }}>
            <button
              type="button"
              className={`chip-toggle ${view === 'feed' ? 'active' : ''}`}
              onClick={() => setView('feed')}
            >
              Messages
            </button>
            <button
              type="button"
              className={`chip-toggle ${view === 'history' ? 'active' : ''}`}
              onClick={() => setView('history')}
            >
              History
            </button>
          </div>
          {view === 'feed' && (
            <>
              <button className="btn secondary" onClick={() => setEnableOpen(true)}>
                <i className="ti ti-plus" /> Enable a group
              </button>
              {active && (
                <button className="btn secondary" onClick={() => setSettingsOpen(true)}>
                  <i className="ti ti-settings" /> Settings
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {error && <div className="banner error" style={{ flexShrink: 0 }}>{error}</div>}

      {view === 'history' ? (
        <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
          <div className="chip-select" style={{ marginBottom: 14 }}>
            {[
              { value: 'hour', label: 'Hourly' },
              { value: 'day', label: 'Daily' },
              { value: 'week', label: 'Weekly' },
              { value: 'month', label: 'Monthly' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`chip-toggle ${period === opt.value ? 'active' : ''}`}
                onClick={() => setPeriod(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {usageLoading ? (
            <p style={{ color: 'var(--ink-soft)' }}>Loading…</p>
          ) : !usage || !usage.buckets.length ? (
            <div className="card empty-state">
              <h3>No usage yet</h3>
              <p>Group messages will show up here once members start posting.</p>
            </div>
          ) : (
            <>
              <div className="card" style={{ padding: 16, marginBottom: 14, display: 'flex', gap: 32 }}>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Messages sent</div>
                  <div style={{ fontSize: 22, fontWeight: 500 }}>{usage.totals.messages}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Cost</div>
                  <div style={{ fontSize: 22, fontWeight: 500 }}>${usage.totals.cost.toFixed(2)}</div>
                </div>
              </div>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th style={{ textAlign: 'right' }}>Messages</th>
                    <th style={{ textAlign: 'right' }}>Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.buckets.map((b) => (
                    <tr key={b.bucket}>
                      <td>{bucketLabel(b.bucket)}</td>
                      <td style={{ textAlign: 'right' }}>{b.messages}</td>
                      <td style={{ textAlign: 'right' }}>${b.cost.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      ) : loading ? (
        <p style={{ color: 'var(--ink-soft)' }}>Loading…</p>
      ) : chats.length === 0 ? (
        <div className="card empty-state">
          <h3>No group chats yet</h3>
          <p>Turn on group chat for one of your groups to let its members text each other.</p>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => setEnableOpen(true)}>
            <i className="ti ti-plus" /> Enable a group
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 16, flex: '1 1 auto', minHeight: 0 }}>
          <div style={{ width: 240, flexShrink: 0, overflowY: 'auto' }}>
            <div className="list">
              {chats.map((c) => (
                <div
                  className="row"
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  style={{
                    cursor: 'pointer',
                    background: c.id === activeId ? 'var(--surface-2, rgba(0,0,0,0.04))' : undefined,
                  }}
                >
                  <div className="row-main" style={{ minWidth: 0 }}>
                    <span className="row-title" style={{ wordBreak: 'break-word' }}>{c.name}</span>
                    <span className="row-sub">
                      {c.joined_count} joined
                      {c.pending_count > 0 ? `, ${c.pending_count} pending` : ''}
                      {c.last_post_at ? ` · ${timeAgo(c.last_post_at)}` : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: '1 1 auto', minWidth: 0, overflowY: 'auto' }}>
            {postsLoading ? (
              <p style={{ color: 'var(--ink-soft)' }}>Loading…</p>
            ) : posts.length === 0 ? (
              <div className="card empty-state">
                <h3>No messages yet</h3>
                <p>
                  {active ? `Nobody has posted to ${active.name} yet.` : ''}
                  {active && active.poster_count === 0
                    ? ' No members are approved to post — open Settings to approve someone.'
                    : ''}
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {posts.map((p) => (
                  <div className="card" key={p.id} style={{ padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
                      <span style={{ fontWeight: 500, fontSize: 13.5 }}>{p.sender_name}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>
                        {timeAgo(p.created_at)}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {p.body || '(no text)'}
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 8 }}>
                      Sent to {p.recipient_count} {p.recipient_count === 1 ? 'person' : 'people'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {settingsOpen && active && (
        <ChatSettingsModal
          group={active}
          onClose={() => setSettingsOpen(false)}
          onChanged={() => loadChats()}
        />
      )}

      {enableOpen && (
        <EnableGroupModal
          enabledIds={new Set(chats.map((c) => c.id))}
          onClose={() => setEnableOpen(false)}
          onChanged={() => loadChats(false)}
        />
      )}
    </div>
  );
}

function ChatSettingsModal({ group, onClose, onChanged }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [turningOff, setTurningOff] = useState(false);
  const [prefix, setPrefix] = useState(group.post_prefix || 'off');
  const [busy, setBusy] = useState(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const [picked, setPicked] = useState(new Set());

  async function load() {
    setLoading(true);
    try {
      setMembers(await api.groups.contacts(group.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [group.id]);

  const STATUS_ORDER = { pending: 0, joined: 1, declined: 2 };

  const visible = members
    .filter((m) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (contactDisplayName(m) || '').toLowerCase().includes(q)
        || (m.phone_number || '').includes(q);
    })
    .sort((a, b) => {
      if (sort === 'status') {
        const d = STATUS_ORDER[a.join_status] - STATUS_ORDER[b.join_status];
        if (d !== 0) return d;
      }
      if (sort === 'can_post') {
        const d = (b.can_post ? 1 : 0) - (a.can_post ? 1 : 0);
        if (d !== 0) return d;
      }
      return (contactDisplayName(a) || '').localeCompare(contactDisplayName(b) || '');
    });

  const allVisiblePicked = visible.length > 0 && visible.every((m) => picked.has(m.id));

  function togglePicked(id) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setPicked(allVisiblePicked ? new Set() : new Set(visible.map((m) => m.id)));
  }

  function statusPill(m) {
    if (m.join_status === 'joined') return null;
    if (m.join_status === 'declined') return <span className="pill" style={{ marginLeft: 8 }}>Left</span>;
    return (
      <span className="pill signal" style={{ marginLeft: 8 }}>
        {m.invited_at ? 'Invited' : 'Not invited'}
      </span>
    );
  }

  async function toggleField(contact, field) {
    const next = !contact[field];
    setMembers((prev) => prev.map((m) => (m.id === contact.id ? { ...m, [field]: next } : m)));
    try {
      await api.groups.updateMember(group.id, contact.id, { [field]: next });
      onChanged();
    } catch (err) {
      setError(err.message);
      setMembers((prev) => prev.map((m) => (m.id === contact.id ? { ...m, [field]: !next } : m)));
    }
  }

  async function bulkSet(field, value, key) {
    const ids = [...picked];
    if (!ids.length) return;
    setBusy(key); setError(''); setNotice('');
    try {
      const r = await api.groups.bulkMembers(group.id, ids, { [field]: value });
      setNotice(`Updated ${r.updated} ${r.updated === 1 ? 'member' : 'members'}.`);
      setPicked(new Set());
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function invite(contactIds, key) {
    setBusy(key); setError(''); setNotice('');
    try {
      const r = await api.groups.invite(group.id, contactIds);
      setNotice(r.invited === 0
        ? 'Nobody to invite.'
        : `Invitation sent to ${r.invited} ${r.invited === 1 ? 'person' : 'people'}.`);
      setPicked(new Set());
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function changePrefix(next) {
    const previous = prefix;
    setPrefix(next);
    try {
      await api.groups.update(group.id, { post_prefix: next });
      onChanged();
    } catch (err) {
      setError(err.message);
      setPrefix(previous);
    }
  }

  async function turnOff() {
    if (!confirm(`Turn off group chat for ${group.name}? Members will no longer be able to text the group.`)) return;
    setTurningOff(true); setError('');
    try {
      await api.groups.update(group.id, { member_posting: 'off' });
      onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
      setTurningOff(false);
    }
  }

  const pendingCount = members.filter((m) => m.join_status === 'pending').length;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <h2>{group.name}</h2>
        {error && <div className="banner error">{error}</div>}
        {notice && <div className="banner ok">{notice}</div>}

        <div style={{ border: '1px solid var(--line)', borderRadius: 7, padding: '10px 12px', marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 2 }}>How messages appear</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 8 }}>
            {prefix === 'group_name'
              ? `Members see: ${group.name} — Rivka: Meeting at 7`
              : 'Members see: Rivka: Meeting at 7'}
          </div>
          <div className="chip-select" style={{ marginBottom: 0 }}>
            <button type="button" className={`chip-toggle ${prefix === 'off' ? 'active' : ''}`} onClick={() => changePrefix('off')}>
              Sender only
            </button>
            <button type="button" className={`chip-toggle ${prefix === 'group_name' ? 'active' : ''}`} onClick={() => changePrefix('group_name')}>
              Add group name
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name or number"
            style={{ flex: '1 1 180px', minWidth: 0 }}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ flex: '0 0 auto' }}>
            <option value="name">Sort by name</option>
            <option value="status">Sort by join status</option>
            <option value="can_post">Sort by can post</option>
          </select>
          {pendingCount > 0 && (
            <button
              type="button"
              className="btn"
              style={{ padding: '6px 12px', fontSize: 13 }}
              onClick={() => invite(null, 'all')}
              disabled={busy === 'all'}
            >
              {busy === 'all' ? 'Sending…' : `Invite all pending (${pendingCount})`}
            </button>
          )}
        </div>

        {picked.size > 0 && (
          <div style={{
            display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
            padding: '8px 10px', marginBottom: 10, borderRadius: 7, background: 'var(--accent-soft)',
          }}>
            <span style={{ fontSize: 12.5, marginRight: 4 }}>{picked.size} selected</span>
            <button type="button" className="btn" style={{ padding: '5px 10px', fontSize: 12.5 }}
              onClick={() => bulkSet('can_post', true, 'post-on')} disabled={busy === 'post-on'}>
              Allow posting
            </button>
            <button type="button" className="btn secondary" style={{ padding: '5px 10px', fontSize: 12.5 }}
              onClick={() => bulkSet('can_post', false, 'post-off')} disabled={busy === 'post-off'}>
              Block posting
            </button>
            <button type="button" className="btn secondary" style={{ padding: '5px 10px', fontSize: 12.5 }}
              onClick={() => invite([...picked], 'invite-sel')} disabled={busy === 'invite-sel'}>
              Invite
            </button>
            <button type="button" style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12.5, cursor: 'pointer' }}
              onClick={() => setPicked(new Set())}>
              Clear
            </button>
          </div>
        )}

        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>Loading…</p>
        ) : !members.length ? (
          <p style={{ fontSize: 14, color: 'var(--ink-soft)' }}>
            This group has no members yet. Add them from the Groups tab.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 12.5, color: 'var(--ink-soft)' }}>
              <input type="checkbox" checked={allVisiblePicked} onChange={toggleAllVisible} />
              <span>Select all{query.trim() ? ' matching' : ''} ({visible.length})</span>
            </div>

            {!visible.length ? (
              <p style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>Nobody matches that search.</p>
            ) : (
              <div className="list" style={{ maxHeight: 320, overflowY: 'auto' }}>
                {visible.map((c) => (
                  <div key={c.id} className="row">
                    <input
                      type="checkbox"
                      checked={picked.has(c.id)}
                      onChange={() => togglePicked(c.id)}
                      style={{ marginRight: 10, flexShrink: 0 }}
                    />
                    <div className="row-main" style={{ minWidth: 0 }}>
                      <span className="row-title">
                        {contactDisplayName(c) || c.phone_number}
                        {statusPill(c)}
                      </span>
                      <span className="row-sub">{c.phone_number}</span>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--ink-soft)', marginRight: 10, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!c.can_post} onChange={() => toggleField(c, 'can_post')} />
                      Post
                    </label>
                    <label
                      style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: 'var(--ink-soft)', cursor: 'pointer' }}
                      title="Admins can text #add, #remove and #count to the group"
                    >
                      <input type="checkbox" checked={!!c.is_admin} onChange={() => toggleField(c, 'is_admin')} />
                      Admin
                    </label>
                    {c.join_status === 'pending' && (
                      <button
                        type="button"
                        className="btn secondary"
                        style={{ padding: '4px 10px', fontSize: 12, marginLeft: 8, flexShrink: 0 }}
                        onClick={() => invite([c.id], c.id)}
                        disabled={busy === c.id}
                      >
                        {busy === c.id ? '…' : c.invited_at ? 'Resend' : 'Invite'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn" style={{ background: 'var(--danger)' }} onClick={turnOff} disabled={turningOff}>
            {turningOff ? 'Turning off…' : 'Turn off group chat'}
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function EnableGroupModal({ enabledIds, onClose, onChanged }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setGroups(await api.groups.list());
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const available = groups.filter((g) => !enabledIds.has(g.id));

  async function enable(g) {
    setSaving(g.id);
    setError('');
    try {
      await api.groups.update(g.id, { member_posting: 'approved' });
      onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
      setSaving(null);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h2>Enable group chat</h2>
        {error && <div className="banner error">{error}</div>}
        <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10 }}>
          Pick a group. You choose who can post in the next step.
        </p>

        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>Loading…</p>
        ) : available.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--ink-soft)' }}>Every group already has group chat on.</p>
        ) : (
          <div className="list" style={{ maxHeight: 320, overflowY: 'auto' }}>
            {available.map((g) => (
              <div className="row" key={g.id}>
                <div className="row-main" style={{ minWidth: 0 }}>
                  <span className="row-title">{g.name}</span>
                  <span className="row-sub">{g.member_count} members</span>
                </div>
                <button
                  type="button"
                  className="btn secondary"
                  style={{ padding: '6px 12px', fontSize: 13 }}
                  onClick={() => enable(g)}
                  disabled={saving === g.id}
                >
                  {saving === g.id ? '…' : 'Enable'}
                </button>
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
