import React, { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import Contacts from './pages/Contacts.jsx';
import Groups from './pages/Groups.jsx';
import Messages from './pages/Messages.jsx';
import Replies from './pages/Replies.jsx';
import Send from './pages/Send.jsx';
import History from './pages/History.jsx';
import Settings from './pages/Settings.jsx';
import Users from './pages/Users.jsx';
import Login from './pages/Login.jsx';
import { setToken, api } from './api.js';
import { getLang, setLang, t } from './i18n.js';

const PAGES = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'groups', label: 'Groups' },
  { key: 'messages', label: 'Messages' },
  { key: 'replies', label: 'Conversations' },
  { key: 'send', label: 'Send' },
  { key: 'history', label: 'History' },
  { key: 'users', label: 'Users' },
  { key: 'settings', label: 'Settings' },
];

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [unreadReplies, setUnreadReplies] = useState(0);
  const [lang, setLangState] = useState(getLang());

  function toggleLang() {
    const next = lang === 'he' ? 'en' : 'he';
    setLang(next);
    setLangState(next);
  }
  const [openConversationContactId, setOpenConversationContactId] = useState(null);
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem('wonder_token'));
  const [isAdmin, setIsAdmin] = useState(localStorage.getItem('wonder_is_admin') === 'true');

  useEffect(() => {
    function handleLogout() { setLoggedIn(false); }
    window.addEventListener('wonder-logout', handleLogout);
    return () => window.removeEventListener('wonder-logout', handleLogout);
  }, []);

useEffect(() => {
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
  }, [lang]);

  useEffect(() => {
    if (!loggedIn) return;
    function refreshUnread() {
      api.messages.unreadReplyCount().then((r) => setUnreadReplies(r.count)).catch(() => {});
    }
    refreshUnread();
    const interval = setInterval(refreshUnread, 30000);
    return () => clearInterval(interval);
  }, [loggedIn]);

  function handleLogoutClick() {
    setToken(null);
    setLoggedIn(false);
  }

  if (!loggedIn) {
    return <Login onLogin={() => { setLoggedIn(true); setIsAdmin(localStorage.getItem('wonder_is_admin') === 'true'); }} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </div>
          <div className="brand-name">
            Wonder Solutions
            <small>MESSAGE CONSOLE</small>
          </div>
        </div>
        <nav className="nav">
          {PAGES.filter((p) => p.key !== 'users' || isAdmin).map((p) => (
            <button
              key={p.key}
              className={`nav-item ${page === p.key ? 'active' : ''}`}
              onClick={() => setPage(p.key)}
              style={p.key === 'replies' && unreadReplies > 0 ? { color: '#fff', background: 'var(--danger)' } : undefined}
            >
              {t(`nav_${p.key === 'replies' ? 'conversations' : p.key}`)}{p.key === 'replies' && unreadReplies > 0 ? ` (${unreadReplies})` : ''}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="nav-item"
          onClick={toggleLang}
          style={{ marginTop: 'auto' }}
        >
          <i className="ti ti-language" /> {lang === 'he' ? 'English' : 'עברית'}
        </button>
        <button
          className="nav-item"
          onClick={handleLogoutClick}
        >
          <i className="ti ti-logout" /> {t('nav_logout')}
        </button>
      </aside>
      <main className={`main ${page === 'contacts' || page === 'history' ? 'main-wide' : ''}`}>
        {page === 'dashboard' && <Dashboard onNavigate={setPage} />}
        {page === 'contacts' && <Contacts />}
        {page === 'groups' && <Groups />}
        {page === 'messages' && <Messages />}
        {page === 'replies' && <Replies onRead={() => setUnreadReplies(0)} openContactId={openConversationContactId} onOpened={() => setOpenConversationContactId(null)} />}
        {page === 'send' && <Send />}
        {page === 'history' && <History isAdmin={isAdmin} onNavigateToConversation={(contactId) => { setOpenConversationContactId(contactId); setPage('replies'); }} />}
        {page === 'users' && <Users />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  );
}