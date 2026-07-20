import React, { useEffect, useState } from 'react';
import { api, audioUrl, imageUrl } from '../api.js';
import SendForm from '../components/SendForm.jsx';

const TYPE_ICONS = { sms: 'ti-message', call: 'ti-phone', voice_note: 'ti-microphone', image: 'ti-photo' };

export default function Send() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    api.messages.list()
      .then(setMessages)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const texts = messages.filter((m) => m.type === 'sms');
  const recordings = messages.filter((m) => m.type === 'voice_note' || m.type === 'call');
  const photos = messages.filter((m) => m.type === 'image');

  function MessageCard({ m }) {
    return (
      <button
        type="button"
        onClick={() => setSelected(m)}
        className="card"
        style={{
          textAlign: 'left', padding: 14, cursor: 'pointer', border: '1px solid var(--line)',
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
        }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: 8, background: 'var(--accent-soft)', color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 15,
        }}>
          <i className={`ti ${TYPE_ICONS[m.type] || 'ti-file'}`} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {m.title || 'Untitled'}
          </div>
          {m.text_content && (
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.text_content}
            </div>
          )}
        </div>
      </button>
    );
  }

  function MessageGrid({ items }) {
    if (!items.length) return <p style={{ fontSize: 13, color: 'var(--ink-faint)' }}>None yet.</p>;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginBottom: 24 }}>
        {items.map((m) => <MessageCard key={m.id} m={m} />)}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Send</h1>
          <p>Pick a message, then choose who gets it</p>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      {!selected ? (
        loading ? (
          <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>
        ) : messages.length === 0 ? (
          <div className="card empty-state">
            <h3>Nothing to send yet</h3>
            <p>Create a text, recording, or photo on the Messages page first.</p>
          </div>
        ) : (
          <div>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Texts</h3>
            <MessageGrid items={texts} />
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Recordings</h3>
            <MessageGrid items={recordings} />
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Photos</h3>
            <MessageGrid items={photos} />
          </div>
        )
      ) : (
        <div className="card" style={{ padding: 22, maxWidth: 560 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <p style={{ fontSize: 12.5, color: 'var(--ink-soft)', margin: '0 0 2px' }}>Sending</p>
              <p style={{ fontWeight: 600, fontSize: 15.5 }}>{selected.title || 'Untitled message'}</p>
            </div>
            <button type="button" className="btn secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setSelected(null)}>
              Change message
            </button>
          </div>

          {selected.text_content && (
            <p style={{ fontSize: 14, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 7, padding: '10px 12px', marginBottom: 14, whiteSpace: 'pre-wrap' }}>
              {selected.text_content}
            </p>
          )}
          {(selected.audio_url || selected.has_uploaded_audio) && (
            <audio controls src={audioUrl(selected.id)} style={{ width: '100%', marginBottom: 14 }} />
          )}
          {selected.has_image && (
            <img src={imageUrl(selected.id)} alt={selected.title || 'Photo'} style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, marginBottom: 14, display: 'block' }} />
          )}

          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            <SendForm key={selected.id} message={selected} />
          </div>
        </div>
      )}
    </div>
  );
}
