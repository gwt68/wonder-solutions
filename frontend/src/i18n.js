export const translations = {
  en: {
    nav_dashboard: 'Dashboard',
    nav_contacts: 'Contacts',
    nav_groups: 'Groups',
    nav_messages: 'Messages',
    nav_send: 'Send',
    nav_history: 'History',
    nav_conversations: 'Conversations',
    nav_users: 'Users',
    nav_settings: 'Settings',
    nav_logout: 'Log out',
    login_title: 'Wonder Solutions',
    login_subtitle: 'Message console',
    login_username: 'Username',
    login_password: 'Password',
    login_button: 'Log in',
    login_forgot: 'Forgot username or password?',
  },
  he: {
    nav_dashboard: 'לוח בקרה',
    nav_contacts: 'אנשי קשר',
    nav_groups: 'קבוצות',
    nav_messages: 'הודעות',
    nav_send: 'שליחה',
    nav_history: 'היסטוריה',
    nav_conversations: 'שיחות',
    nav_users: 'משתמשים',
    nav_settings: 'הגדרות',
    nav_logout: 'התנתקות',
    login_title: 'וונדר סולושנס',
    login_subtitle: 'קונסולת הודעות',
    login_username: 'שם משתמש',
    login_password: 'סיסמה',
    login_button: 'התחברות',
    login_forgot: 'שכחת שם משתמש או סיסמה?',
  },
};

export function getLang() {
  return localStorage.getItem('wonder_lang') || 'en';
}

export function setLang(lang) {
  localStorage.setItem('wonder_lang', lang);
  document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
}

export function t(key) {
  const lang = getLang();
  return translations[lang]?.[key] || translations.en[key] || key;
}