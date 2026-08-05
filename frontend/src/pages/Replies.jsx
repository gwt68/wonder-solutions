import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function Replies({ onRead }) {
  const [replies, setReplies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
            <div className="row" key={r.id}>
              <div className="row-main">
                <span className="row-title">{r.contact_name || r.from_phone_number}</span>
                <span className="row-sub">{r.from_phone_number} · {new Date(r.created_at).toLocaleString()}</span>
                <p style={{ fontSize: 13.5, marginTop: 6 }}>{r.text_content}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}