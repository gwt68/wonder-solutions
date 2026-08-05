import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Replies({ onRead }) {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openContactId, setOpenContactId] = useState(null);
  const [conversation, setConversation] = useState([]);
  const [convoLoading, setConvoLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

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
            <h1>Replies</h1>
            <p>Conversations with contacts</p>
          </div>
        </div>

        {error && <div className="banner error">{error}</div>}

        {loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
        ) : contactList.length === 0 ? (
          <div className="card empty-state">
            <h3>No replies yet</h3>
            <p>When a contact texts back, it'll show up here.</p>
          </div>
        ) : (
          <div className="list">
            {contactList.map((r) => (
              <div
                className="row"
                key={r.reply_contact_id || r.from_phone_number}
                style={{ cursor: 'pointer', background: openContactId === r.reply_contact_id ? 'var(--accent-soft)' : undefined }}
                onClick={() => openThread(r)}
              >
                <div className="row-main">
                  <span className="row-title">{r.contact_name || r.from_phone_number}</span>
                  <span className="row-sub">{new Date(r.created_at).toLocaleString()}</span>
                  <p style={{ fontSize: 13, marginTop: 4, color: 'var(--ink-soft)' }}>{r.text_content}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {openContactId && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
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