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

  useEffect(() => { loadChats(false); }, []);
  useEffect(() => { loadPosts(activeId); }, [activeId]);

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
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn secondary" onClick={() => setEnableOpen(true)}>
            <i className="ti ti-plus" /> Enable a group
          </button>
          {active && (
            <button className="btn secondary" onClick={() => setSettingsOpen(true)}>
              <i className="ti ti-settings" /> Settings
            </button>
          )}
        </div>
      </div>

      {error && <div className="banner error" style={{ flexShrink: 0 }}>{error}</div>}

      {loading ? (
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
                      {c.poster_count} of {c.member_count} can post
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
  const [turningOff, setTurningOff] = useState(false);

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

  async function toggleCanPost(contact) {
    const next = !contact.can_post;
    setMembers((prev) => prev.map((m) => (m.id === contact.id ? { ...m, can_post: next } : m)));
    try {
      await api.groups.updateMember(group.id, contact.id, { can_post: next });
      onChanged();
    } catch (err) {
      setError(err.message);
      setMembers((prev) => prev.map((m) => (m.id === contact.id ? { ...m, can_post: !next } : m)));
    }
  }

  async function approveAll() {
    setError('');
    try {
      for (const m of members.filter((x) => !x.can_post)) {
        await api.groups.updateMember(group.id, m.id, { can_post: true });
      }
      await load();
      onChanged();
    } catch (err) {
      setError(err.message);
    }
  }

  async function turnOff() {
    if (!confirm(`Turn off group chat for ${group.name}? Members will no longer be able to text the group.`)) return;
    setTurningOff(true);
    setError('');
    try {
      await api.groups.update(group.id, { member_posting: 'off' });
      onChanged();
      onClose();
    } catch (err) {
      setError(err.message);
      setTurningOff(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h2>{group.name}</h2>
        {error && <div className="banner error">{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)', margin: 0 }}>
            Tick who is allowed to post to this group.
          </p>
          <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={approveAll}>
            Approve all
          </button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>Loading…</p>
        ) : members.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--ink-soft)' }}>
            This group has no members yet. Add them from the Groups tab.
          </p>
        ) : (
          <div className="list" style={{ maxHeight: 340, overflowY: 'auto' }}>
            {members.map((c) => (
              <label key={c.id} className="row" style={{ cursor: 'pointer' }}>
                <div className="row-main" style={{ minWidth: 0 }}>
                  <span className="row-title">{contactDisplayName(c) || c.phone_number}</span>
                  <span className="row-sub">{c.phone_number}</span>
                </div>
                <input type="checkbox" checked={!!c.can_post} onChange={() => toggleCanPost(c)} />
              </label>
            ))}
          </div>
        )}

        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="btn"
            style={{ background: 'var(--danger)' }}
            onClick={turnOff}
            disabled={turningOff}
          >
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
