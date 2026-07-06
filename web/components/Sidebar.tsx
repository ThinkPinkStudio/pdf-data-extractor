'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || ''

/* ─── Icone (allineate all'app desktop) ─────────────────────────────── */
const IconPDF = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
)
const IconShield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
)
const IconBatch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="6" height="6" rx="1" /><rect x="9" y="3" width="6" height="6" rx="1" /><rect x="16" y="3" width="6" height="6" rx="1" />
    <rect x="2" y="12" width="6" height="6" rx="1" /><rect x="9" y="12" width="6" height="6" rx="1" /><rect x="16" y="12" width="6" height="6" rx="1" />
  </svg>
)
const IconHistory = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 .49-4.95" /><polyline points="12 7 12 12 15 15" />
  </svg>
)
const IconSettings = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)
const IconActivity = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
)
const IconUser = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
)
const IconSun = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
)
const IconMoon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

const IconSearch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
)

const NAV = [
  { href: '/extractor', key: 'nav.extractor', icon: <IconPDF /> },
  { href: '/polizza', key: 'nav.polizza', icon: <IconShield /> },
  { href: '/polizza/bulk', key: 'nav.bulk', icon: <IconBatch /> },
  { href: '/polizza/jobs', key: 'nav.jobsDash', icon: <IconHistory /> },
  { href: '/batch', key: 'nav.batch', icon: <IconBatch /> },
  { href: '/archive', key: 'nav.archive', icon: <IconSearch /> },
  { href: '/history', key: 'nav.history', icon: <IconHistory /> },
  { href: '/settings', key: 'nav.settings', icon: <IconSettings /> },
  { href: '/diagnostics', key: 'nav.security', icon: <IconActivity /> },
  { href: '/contacts', key: 'nav.contacts', icon: <IconUser /> },
]

export default function Sidebar({ email }: { email: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const { lang, setLang, t } = useI18n()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  // Voce di nav "attiva" = il prefisso più lungo che corrisponde al path corrente,
  // per evitare che es. /polizza e /polizza/bulk risultino entrambi evidenziati.
  const activeHref = NAV
    .map((i) => i.href)
    .filter((h) => pathname === h || pathname.startsWith(h + '/'))
    .sort((a, b) => b.length - a.length)[0]

  useEffect(() => {
    const saved = (localStorage.getItem('theme') as 'dark' | 'light' | null) || 'dark'
    setTheme(saved)
    document.documentElement.setAttribute('data-theme', saved)
    const accent = localStorage.getItem('accentColor')
    if (accent) document.documentElement.style.setProperty('--c-accent', accent)
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/auth/login')
  }

  return (
    <aside className="sidebar" role="navigation" aria-label={t('nav.aria')}>
      <div className="sidebar-header">
        <div className="logo-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="" aria-hidden width={36} height={36} className="logo-img" />
          <div className="logo-text">
            <span className="logo-name">PDF Extractor</span>
            <span className="logo-sub">EXTRACTOR</span>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label={t('nav.ariaMain')}>
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`nav-item ${item.href === activeHref ? 'active' : ''}`}
            aria-current={item.href === activeHref ? 'page' : undefined}
          >
            {item.icon}
            <span>{t(item.key)}</span>
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="footer-top">
          <div className="footer-brand-block">
            <span className="footer-brand">ThinkPink Studio</span>
            {APP_VERSION && <span className="footer-version">v{APP_VERSION}</span>}
          </div>
          <div className="footer-actions">
            <button className={`lang-btn${lang === 'it' ? ' active' : ''}`} onClick={() => setLang('it')} aria-pressed={lang === 'it'}>IT</button>
            <button className={`lang-btn${lang === 'en' ? ' active' : ''}`} onClick={() => setLang('en')} aria-pressed={lang === 'en'}>EN</button>
            <button
              className="theme-btn"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? t('nav.themeLight') : t('nav.themeDark')}
              title={theme === 'dark' ? t('nav.themeLight') : t('nav.themeDark')}
            >
              {theme === 'dark' ? <IconSun /> : <IconMoon />}
            </button>
          </div>
        </div>
        <div className="footer-email" title={email}>{email}</div>
        <button className="btn btn-secondary" style={{ width: '100%', fontSize: 12 }} onClick={handleLogout}>
          {t('nav.logout')}
        </button>
      </div>
    </aside>
  )
}
