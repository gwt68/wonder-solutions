import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { groupSendsIntoBroadcasts } from '../broadcastUtils.js';

export default function Dashboard({ onNavigate }) {
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [messages, setMessages] = useState([]);
  const [sends, setSends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.contacts.list(), api.groups.list(), api.messages.list(), api.sends.list()])
      .then(([c, g, m, s]) => { setContacts(c); setGroups(g); setMessages(m); setSends(s); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ color: 'var(--ink-soft)' }}>Loading...</p>;
  if (error) return <div className="banner error">{error}</div>;

  const broadcasts = groupSendsIntoBroadcasts(sends);
  const today = new Date().toDateString();
  const broadcastsSentToday = broadcasts.filter((b) => b.latestSentAt && new Date(b.latestSentAt).toDateString() === today).length;
  const upcomingBroadcasts = broadcasts.filter((b) => b.scheduledAt && (b.counts.scheduled || 0) > 0);
  const recentBroadcasts = broadcasts.filter((b) => !(b.counts.scheduled > 0 && !b.counts.sent && !b.counts.failed));

  const messageCount = messages.length;

  const stats = [
    { label: 'Contacts', value: contacts.length, page: 'contacts' },
    { label: 'Groups', value: groups.length, page: 'groups' },
    { label: 'Messages', value: messageCount, page: 'messages' },
    { label: 'Broadcasts sent', value: broadcastsSentToday, page: 'history' },
    { label: 'Scheduled', value: upcomingBroadcasts.length, page: 'history' },
  ];

  return (
    // Fills exactly the space main gives it (100vh minus main's own top/bottom padding),
    // and never scrolls itself — only the individual panels below do.
    <div style={{ height: 'calc(100vh - 72px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0 }}>
        <div className="page-header" style={{ marginBottom: 20 }}>
          <div>
            <h1>Dashboard</h1>
            <p>An overview of your contacts, messages, and sends</p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
          {stats.map((s) => (
            <button key={s.label} className="stat-card" onClick={() => onNavigate && onNavigate(s.page)}>
              <div className="stat-value">{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Everything below this point is a set of independent panels — each one
          scrolls on its own if it has more content than fits, without moving
          the stat boxes or any other panel. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 20, marginTop: 24 }}>

        {upcomingBroadcasts.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>Upcoming scheduled broadcasts</h3>
            <div className="list" style={{ maxHeight: 160, overflowY: 'auto' }}>
              {upcomingBroadcasts.map((b) => (
                <div className="row" key={b.batchId}>
                  <div className="row-main">
                    <span className="row-title">{b.messageTitle || 'Untitled'} → {b.total} recipient{b.total !== 1 ? 's' : ''}</span>
                    <span className="row-sub">{new Date(b.scheduledAt).toLocaleString()}</span>
                  </div>
                  <span className="pill signal">Scheduled</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: 15, marginBottom: 10, flexShrink: 0 }}>Recent activity</h3>
          {recentBroadcasts.length === 0 ? (
            <div className="card empty-state">
              <h3>Nothing sent yet</h3>
              <p>Send your first message and it'll show up here.</p>
            </div>
          ) : (
            <div className="list" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {recentBroadcasts.map((b) => (
                <div className="row" key={b.batchId}>
                  <div className="row-main">
                    <span className="row-title">{b.messageTitle || 'Untitled'} → {b.total} recipient{b.total !== 1 ? 's' : ''}</span>
                    <span className="row-sub">
                      {b.latestSentAt && new Date(b.latestSentAt).toLocaleString()}
                      {b.counts.failed > 0 && ` · ${b.counts.failed} failed`}
                    </span>
                  </div>
                  <span className="pill" style={b.counts.failed > 0 && !b.counts.sent ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : undefined}>
                    {b.counts.sent > 0 ? `${b.counts.sent} sent` : `${b.counts.failed} failed`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
