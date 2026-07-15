import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import SendForm from '../components/SendForm.jsx';

const TYPE_LABELS = { sms: 'Text', call: 'Phone call', voice_note: 'Voice note' };

export default function Send() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    api.messages.list()
      .then(setMessages)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Send</h1>
          <p>Pick a message, then choose who gets it</p>
        </div>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="card" style={{ padding: 22, maxWidth: 520 }}>
        <div className="field">
          <label>Message</label>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} disabled={loading}>
            <option value="">Choose a message...</option>
            {messages.map((m) => (
              <option key={m.id} value={m.id}>
                {(m.title || 'Untitled')} — {TYPE_LABELS[m.type] || m.type}
              </option>
            ))}
          </select>
        </div>

        {selectedId && (
          <SendForm
            key={selectedId}
            message={messages.find((m) => m.id === parseInt(selectedId, 10))}
          />
        )}
      </div>
    </div>
  );
}
