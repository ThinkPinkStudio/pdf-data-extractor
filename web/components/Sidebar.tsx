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
const IconGrid = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
)
const IconCompare = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="7" height="16" rx="1" /><rect x="14" y="4" width="7" height="16" rx="1" />
    <line x1="10" y1="9" x2="14" y2="9" /><line x1="10" y1="15" x2="14" y2="15" />
  </svg>
)
const IconForm = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9 2h6a1 1 0 0 1 1 1v1h1a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h1V3a1 1 0 0 1 1-1z" />
    <line x1="9" y1="12" x2="15" y2="12" /><line x1="9" y1="16" x2="13" y2="16" />
  </svg>
)
const IconCalendar = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
  </svg>
)
const IconBook = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
)
const IconTable = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" />
    <line x1="15" y1="9" x2="15" y2="21" /><line x1="9" y1="9" x2="9" y2="21" />
  </svg>
)
const IconHome = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
  </svg>
)

/* ─── Sezioni separate: ogni sezione ha il proprio menu e le proprie
       Impostazioni. La sidebar mostra SOLO il menu della sezione corrente. ── */
type NavItem = { href: string; key: string; icon: React.ReactNode }
type Section = 'extractor' | 'compare' | 'adesioni' | 'premio' | 'hub'

const NAV_EXTRACTOR: NavItem[] = [
  { href: '/extractor', key: 'nav.extractor', icon: <IconPDF /> },
  { href: '/polizza', key: 'nav.polizza', icon: <IconShield /> },
  { href: '/polizza/bulk', key: 'nav.bulk', icon: <IconBatch /> },
  { href: '/polizza/jobs', key: 'nav.jobsDash', icon: <IconHistory /> },
  { href: '/batch', key: 'nav.batch', icon: <IconBatch /> },
  { href: '/archive', key: 'nav.archive', icon: <IconSearch /> },
  { href: '/chat', key: 'nav.chat', icon: <IconSearch /> },
  { href: '/maintenance', key: 'nav.data', icon: <IconBatch /> },
  { href: '/history', key: 'nav.history', icon: <IconHistory /> },
  { href: '/settings', key: 'nav.settings', icon: <IconSettings /> },
  { href: '/settings/technical', key: 'nav.settingsTech', icon: <IconActivity /> },
  { href: '/diagnostics', key: 'nav.security', icon: <IconActivity /> },
  { href: '/contacts', key: 'nav.contacts', icon: <IconUser /> },
]

const NAV_COMPARE: NavItem[] = [
  { href: '/compare', key: 'nav.cmpCompare', icon: <IconCompare /> },
  // «Ricerca» e «In Entrambi» sono FUSE in «Confronto righe» (/compare/both):
  // stessa operazione, due viste (esito per riga / dettaglio corrispondenze).
  { href: '/compare/both', key: 'nav.cmpBoth', icon: <IconSearch /> },
  { href: '/compare/settings', key: 'nav.cmpSettings', icon: <IconSettings /> },
  { href: '/compare/contacts', key: 'nav.contacts', icon: <IconUser /> },
]

const NAV_ADESIONI: NavItem[] = [
  { href: '/adesioni', key: 'nav.adAdesioni', icon: <IconForm /> },
  { href: '/adesioni/records', key: 'nav.adRecords', icon: <IconHistory /> },
  { href: '/adesioni/scadenze', key: 'nav.adScadenze', icon: <IconCalendar /> },
  { href: '/adesioni/registro', key: 'nav.adRegistro', icon: <IconBook /> },
  { href: '/adesioni/settings', key: 'nav.adSettings', icon: <IconSettings /> },
  { href: '/adesioni/contacts', key: 'nav.contacts', icon: <IconUser /> },
]

const NAV_PREMIO: NavItem[] = [
  { href: '/premio', key: 'nav.pmCalcolo', icon: <IconTable /> },
]

const NAV_HUB: NavItem[] = [
  { href: '/extractor', key: 'nav.secExtractor', icon: <IconPDF /> },
  { href: '/compare', key: 'nav.secCompare', icon: <IconCompare /> },
  { href: '/adesioni', key: 'nav.secAdesioni', icon: <IconForm /> },
  { href: '/premio', key: 'nav.secPremio', icon: <IconTable /> },
]

function sectionFor(pathname: string): Section {
  if (pathname === '/hub') return 'hub'
  if (pathname === '/compare' || pathname.startsWith('/compare/')) return 'compare'
  if (pathname === '/adesioni' || pathname.startsWith('/adesioni/')) return 'adesioni'
  if (pathname === '/premio' || pathname.startsWith('/premio/')) return 'premio'
  return 'extractor'
}

const SECTION_META: Record<Section, { name: string; subKey: string; nav: NavItem[] }> = {
  extractor: { name: 'PDF Extractor', subKey: 'nav.subExtractor', nav: NAV_EXTRACTOR },
  compare: { name: 'Portafoglio Compare', subKey: 'nav.subCompare', nav: NAV_COMPARE },
  adesioni: { name: 'CSA Adesioni', subKey: 'nav.subAdesioni', nav: NAV_ADESIONI },
  premio: { name: 'Premio Lordo', subKey: 'nav.subPremio', nav: NAV_PREMIO },
  hub: { name: 'CSA Suite', subKey: 'nav.subHub', nav: NAV_HUB },
}

export default function Sidebar({ email }: { email: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const { lang, setLang, t } = useI18n()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  const section = sectionFor(pathname)
  const meta = SECTION_META[section]
  const NAV = meta.nav

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
            <span className="logo-name">{meta.name}</span>
            <span className="logo-sub">{t(meta.subKey)}</span>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label={t('nav.ariaMain')}>
        {section !== 'hub' && (
          <Link href="/hub" className="nav-item" style={{ color: 'var(--c-text-muted)', marginBottom: 4 }}>
            <IconHome />
            <span>{t('nav.backHub')}</span>
          </Link>
        )}
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
