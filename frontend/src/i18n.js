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
    dashboard_title: 'Dashboard',
    dashboard_subtitle: 'An overview of your contacts, messages, and sends',
    stat_contacts: 'Contacts',
    stat_groups: 'Groups',
    stat_messages: 'Messages',
    stat_broadcasts_sent: 'Broadcasts sent',
    stat_scheduled: 'Scheduled',
    dashboard_upcoming: 'Upcoming scheduled broadcasts',
    dashboard_recent: 'Recent activity',
    dashboard_empty_title: 'Nothing sent yet',
    dashboard_empty_body: "Send your first message and it'll show up here.",
    label_untitled: 'Untitled',
    label_scheduled_pill: 'Scheduled',
    label_sent: 'sent',
    label_failed: 'failed',
    recipient_one: 'recipient',
    recipient_other: 'recipients',
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
    dashboard_title: 'לוח בקרה',
    dashboard_subtitle: 'סקירה כללית של אנשי הקשר, ההודעות והשליחות שלך',
    stat_contacts: 'אנשי קשר',
    stat_groups: 'קבוצות',
    stat_messages: 'הודעות',
    stat_broadcasts_sent: 'שידורים שנשלחו',
    stat_scheduled: 'מתוזמן',
    dashboard_upcoming: 'שידורים מתוזמנים קרובים',
    dashboard_recent: 'פעילות אחרונה',
    dashboard_empty_title: 'עדיין לא נשלח כלום',
    dashboard_empty_body: 'שלח את ההודעה הראשונה שלך והיא תופיע כאן.',
    label_untitled: 'ללא כותרת',
    label_scheduled_pill: 'מתוזמן',
    label_sent: 'נשלחו',
    label_failed: 'נכשלו',
    recipient_one: 'נמען',
    recipient_other: 'נמענים',
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

export function tRecipients(n) {
  return `${n} ${n === 1 ? t('recipient_one') : t('recipient_other')}`;
}