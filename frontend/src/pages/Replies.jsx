import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Replies({ onRead }) {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [replyDrafts, setReplyDrafts] = useState({});
  const [sendingId, setSendingId] = useState(null);
  const [sentIds, setSentIds] = useState(new Set());

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

  async function handleSendReply(replyId) {
    const text = (replyDrafts[replyId] || '').trim();
    if (!text) return;
    setSendingId(replyId);
    setError('');
    try {
      await api.messages.sendReply(replyId, text);
      setSentIds((prev) => new Set(prev).add(replyId));
      setReplyDrafts((prev) => ({ ...prev, [replyId]: '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Replies</h1>
          <p>Texts your contacts have sent back</p>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {loading ? (
        <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
      ) : replies.length === 0 ? (
        <div className="card empty-state">
          <h3>No replies yet</h3>
          <p>When a contact texts back, it'll show up here.</p>
        </div>
      ) : (
        <div className="list">
          {replies.map((r) => (
            <div className="row" key={r.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row-main">
                <span className="row-title">{r.contact_name || r.from_phone_number}</span>
                <span className="row-sub">{r.from_phone_number} · {new Date(r.created_at).toLocaleString()}</span>
                <p style={{ fontSize: 13.5, marginTop: 6 }}>{r.text_content}</p>
              </div>
              {sentIds.has(r.id) ? (
                <p style={{ fontSize: 12.5, color: 'var(--accent)', marginTop: 8 }}>Reply sent.</p>
              ) : (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <input
                    value={replyDrafts[r.id] || ''}
                    onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    placeholder="Type a reply..."
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: '6px 14px', fontSize: 13 }}
                    onClick={() => handleSendReply(r.id)}
                    disabled={sendingId === r.id || !(replyDrafts[r.id] || '').trim()}
                  >
                    {sendingId === r.id ? 'Sending...' : 'Send'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}