import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Replies({ onRead, openContactId: navContactId, onOpened }) {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openContactId, setOpenContactId] = useState(null);
  const [conversation, setConversation] = useState([]);
  const [convoLoading, setConvoLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (navContactId) {
      setOpenContactId(navContactId);
      setConvoLoading(true);
      api.messages.conversation(navContactId)
        .then(setConversation)
        .catch((e) => setError(e.message))
        .finally(() => setConvoLoading(false));
      if (onOpened) onOpened();
    }
  }, [navContactId]);

  async function load() {
    setLoading(true);
    try {
      const data = await api.messages.replies();
      setReplies(data);
      const unread = data.filter((r) => !r.read_at);
      for (const r of unread) {
        await api.messages.markReplyRead(r.id);
      }
      if (unread.length && onRead) onRead();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function openThread(reply) {
    if (!reply.reply_contact_id) return;
    setOpenContactId(reply.reply_contact_id);
    setConvoLoading(true);
    setError('');
    try {
      const data = await api.messages.conversation(reply.reply_contact_id);
      setConversation(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setConvoLoading(false);
    }
  }

  async function handleSend(replyId) {
    if (!draft.trim()) return;
    setSending(true);
    setError('');
    try {
      await api.messages.sendReply(replyId, draft);
      setDraft('');
      const data = await api.messages.conversation(openContactId);
      setConversation(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  // group replies by contact so each person shows once in the list, with their latest message
  const byContact = {};
  for (const r of replies) {
    const key = r.reply_contact_id || r.from_phone_number;
    if (!byContact[key] || new Date(r.created_at) > new Date(byContact[key].created_at)) {
      byContact[key] = r;
    }
  }
  const contactList = Object.values(byContact).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%' }}>
      <div style={{ width: 320, flexShrink: 0, overflowY: 'auto' }}>
        <div className="page-header">
          <div>
            <h1>Conversations</h1>
            <p>Two-way texts with your contacts</p>
          </div>
        </div>

        {error && <div className="banner error">{error}</div>}

        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
        ) : contactList.length === 0 ? (
          <div className="card empty-state">
            <h3>No conversations yet</h3>
            <p>When a contact texts back, it'll show up here.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {contactList.map((r) => {
              const isActive = openContactId === r.reply_contact_id;
              return (
                <div
                  key={r.reply_contact_id || r.from_phone_number}
                  onClick={() => openThread(r)}
                  style={{
                    cursor: 'pointer',
                    padding: '12px 14px',
                    borderRadius: 10,
                    background: isActive ? 'var(--accent-soft)' : 'transparent',
                    border: '1px solid transparent',
                    transition: 'background 0.12s ease',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg)'; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: isActive ? 'var(--accent)' : 'var(--ink)' }}>
                      {r.contact_name || r.from_phone_number}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--ink-faint)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                      {new Date(r.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <p style={{
                    fontSize: 12.5, color: 'var(--ink-soft)', margin: '3px 0 0',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {r.text_content}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {openContactId && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderLeft: '1px solid var(--line)', paddingLeft: 20 }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 4px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {convoLoading ? (
              <p style={{ color: 'var(--ink-soft)' }}>Loading conversation...</p>
            ) : (
              conversation.map((m) => (
                <div
                  key={`${m.direction}-${m.id}`}
                  style={{
                    alignSelf: m.direction === 'out' ? 'flex-end' : 'flex-start',
                    maxWidth: '70%',
                    background: m.direction === 'out' ? 'var(--accent)' : 'var(--bg)',
                    color: m.direction === 'out' ? '#fff' : 'var(--ink)',
                    border: m.direction === 'out' ? 'none' : '1px solid var(--line)',
                    borderRadius: 12,
                    padding: '8px 12px',
                  }}
                >
                  <div style={{ fontSize: 13.5 }}>{m.text}</div>
                  <div style={{ fontSize: 10.5, opacity: 0.7, marginTop: 3 }}>{new Date(m.created_at).toLocaleString()}</div>
                </div>
              ))
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, padding: '12px 4px', borderTop: '1px solid var(--line)' }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type a reply..."
              style={{ flex: 1 }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(contactList.find((r) => r.reply_contact_id === openContactId)?.id); }}
            />
            <button
              type="button"
              className="btn"
              onClick={() => handleSend(contactList.find((r) => r.reply_contact_id === openContactId)?.id)}
              disabled={sending || !draft.trim()}
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}