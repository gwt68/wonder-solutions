import React, { useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard.jsx';
import Contacts from './pages/Contacts.jsx';
import Groups from './pages/Groups.jsx';
import GroupChat from './pages/GroupChat.jsx';
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
  { key: 'groupchat', label: 'Group Chat' },
  { key: 'messages', label: 'Messages' },
  { key: 'replies', label: 'Conversations' },
  { key: 'send', label: 'Send' },
  { key: 'history', label: 'History' },
  { key: 'users', label: 'Users' },
  { key: 'settings', label: 'Settings' },
];

// A 'groups' account is the group-chat-only tier: no broadcasting anywhere.
const GROUPS_TIER_PAGES = ['groupchat', 'contacts', 'groups', 'settings'];

export default function App() {
  const [accountType, setAccountType] = useState(
    () => localStorage.getItem('wonder_account_type') || 'full'
  );
  const [page, setPage] = useState(() =>
    (localStorage.getItem('wonder_account_type') || 'full') === 'groups' ? 'groupchat' : 'dashboard'
  );
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

  const isGroupsTier = accountType === 'groups';

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
    if (!loggedIn || isGroupsTier) return;
    function refreshUnread() {
      api.messages.unreadReplyCount().then((r) => setUnreadReplies(r.count)).catch(() => {});
    }
    refreshUnread();
    const interval = setInterval(refreshUnread, 30000);
    return () => clearInterval(interval);
  }, [loggedIn, isGroupsTier]);

  function handleLogoutClick() {
    setToken(null);
    setLoggedIn(false);
  }

  if (!loggedIn) {
    return (
      <Login
        onLogin={() => {
          setLoggedIn(true);
          setIsAdmin(localStorage.getItem('wonder_is_admin') === 'true');
          const type = localStorage.getItem('wonder_account_type') || 'full';
          setAccountType(type);
          setPage(type === 'groups' ? 'groupchat' : 'dashboard');
        }}
      />
    );
  }

  const visiblePages = PAGES.filter((p) => {
    if (isGroupsTier) return GROUPS_TIER_PAGES.includes(p.key);
    return p.key !== 'users' || isAdmin;
  });

  function navLabel(p) {
    if (p.key === 'groupchat') return 'Group Chat';
    return t(`nav_${p.key === 'replies' ? 'conversations' : p.key}`);
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
            <small>{isGroupsTier ? 'GROUP CHAT' : 'MESSAGE CONSOLE'}</small>
          </div>
        </div>
        <nav className="nav">
          {visiblePages.map((p) => (
            <button
              key={p.key}
              className={`nav-item ${page === p.key ? 'active' : ''}`}
              onClick={() => setPage(p.key)}
              style={p.key === 'replies' && unreadReplies > 0 ? { color: '#fff', background: 'var(--danger)' } : undefined}
            >
              {navLabel(p)}{p.key === 'replies' && unreadReplies > 0 ? ` (${unreadReplies})` : ''}
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
        {page === 'groupchat' && <GroupChat />}
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
