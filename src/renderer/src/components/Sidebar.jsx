import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import iconUrl from '../assets/icon.png'

/* global __APP_VERSION__ __UPDATE_URL__ */

const IconPDF = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
    <polyline points="10 9 9 9 8 9"/>
  </svg>
)

const IconSettings = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)

const IconUser = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
)

const IconSun = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
)

const IconMoon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
)

const IconBatch = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="3" width="6" height="6" rx="1"/>
    <rect x="9" y="3" width="6" height="6" rx="1"/>
    <rect x="16" y="3" width="6" height="6" rx="1"/>
    <rect x="2" y="12" width="6" height="6" rx="1"/>
    <rect x="9" y="12" width="6" height="6" rx="1"/>
    <rect x="16" y="12" width="6" height="6" rx="1"/>
  </svg>
)

const IconHistory = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="1 4 1 10 7 10"/>
    <path d="M3.51 15a9 9 0 1 0 .49-4.95"/>
    <polyline points="12 7 12 12 15 15"/>
  </svg>
)

const IconShield = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
)

const navItems = [
  { id: 'extractor', icon: <IconPDF />,     labelKey: 'nav.extractor' },
  { id: 'polizza',   icon: <IconShield />,  labelKey: 'nav.polizza'   },
  { id: 'batch',     icon: <IconBatch />,   labelKey: 'nav.batch'     },
  { id: 'history',   icon: <IconHistory />, labelKey: 'nav.history'   },
  { id: 'settings',  icon: <IconSettings />,labelKey: 'nav.settings'  },
  { id: 'contacts',  icon: <IconUser />,    labelKey: 'nav.contacts'  }
]

const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''
const isWindows = window.electronAPI?.platform === 'win32'
const isLinux = window.electronAPI?.platform === 'linux'
const showWindowControls = isWindows || isLinux

function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.electronAPI?.windowIsMaximized().then(setMaximized)
    window.electronAPI?.onWindowMaximizeChange(setMaximized)
    return () => window.electronAPI?.removeWindowMaximizeListeners()
  }, [])

  return (
    <div className="win-controls" style={{ WebkitAppRegion: 'no-drag' }}>
      <button
        className="win-btn win-btn-min"
        onClick={() => window.electronAPI?.windowMinimize()}
        title="Minimizza"
        aria-label="Minimizza"
      >
        <svg viewBox="0 0 10 1" width="10" height="1" fill="currentColor"><rect width="10" height="1"/></svg>
      </button>
      <button
        className="win-btn win-btn-max"
        onClick={() => window.electronAPI?.windowMaximize().then(() => window.electronAPI?.windowIsMaximized().then(setMaximized))}
        title={maximized ? 'Ripristina' : 'Ingrandisci'}
        aria-label={maximized ? 'Ripristina' : 'Ingrandisci'}
      >
        {maximized
          ? <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="2" y="0" width="8" height="8"/><rect x="0" y="2" width="8" height="8" fill="var(--c-bg-app)"/><rect x="0" y="2" width="8" height="8"/></svg>
          : <svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0" y="0" width="10" height="10"/></svg>
        }
      </button>
      <button
        className="win-btn win-btn-close"
        onClick={() => window.electronAPI?.windowClose()}
        title="Chiudi"
        aria-label="Chiudi"
      >
        <svg viewBox="0 0 10 10" width="10" height="10" stroke="currentColor" strokeWidth="1.2"><line x1="0" y1="0" x2="10" y2="10"/><line x1="10" y1="0" x2="0" y2="10"/></svg>
      </button>
    </div>
  )
}

export default function Sidebar({ page, onNavigate, theme, onThemeChange, lang, onLangChange }) {
  const { t } = useTranslation()
  const [updateInfo, setUpdateInfo] = useState(null)

  useEffect(() => {
    window.electronAPI?.checkForUpdate?.().then(info => {
      if (info?.hasUpdate) setUpdateInfo(info)
    }).catch(() => {})
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    onThemeChange(next)
    window.electronAPI.getSettings().then(s => {
      window.electronAPI.saveSettings({ ...s, theme: next })
    })
  }

  const setLang = (l) => {
    onLangChange(l)
    window.electronAPI.getSettings().then(s => {
      window.electronAPI.saveSettings({ ...s, language: l })
    })
  }

  return (
    <aside className="sidebar" role="navigation" aria-label={t('nav.extractor')}>
      <div className="sidebar-header">
        {showWindowControls && <WindowControls />}
        <div className="logo-row" role="banner">
          <img
            src={iconUrl}
            alt=""
            aria-hidden="true"
            className="logo-img"
          />
          <div className="logo-text">
            <span className="logo-name">{t('brand.name')}</span>
            <span className="logo-sub">{t('brand.subtitle')}</span>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="Main navigation">
        {navItems.map(item => (
          <button
            key={item.id}
            className={`nav-item${page === item.id ? ' active' : ''}`}
            onClick={() => onNavigate(item.id)}
            aria-current={page === item.id ? 'page' : undefined}
          >
            {item.icon}
            <span>{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="footer-brand-block">
          <span className="footer-brand" aria-label={t('brand.company')}>
            {t('brand.company')}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {appVersion && (
              <span className="footer-version">v{appVersion}</span>
            )}
            {updateInfo && (
              <button
                onClick={() => window.open(__UPDATE_URL__ || updateInfo.releaseUrl)}
                title={`v${updateInfo.latestVersion} disponibile`}
                aria-label={`Aggiornamento disponibile: v${updateInfo.latestVersion}`}
                style={{
                  background: 'var(--c-accent)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '1px 6px',
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: 'pointer',
                  lineHeight: '16px',
                  letterSpacing: '0.02em'
                }}
              >
                v{updateInfo.latestVersion} ↑
              </button>
            )}
          </div>
        </div>
        <div className="footer-actions">
          <button
            className={`lang-btn${lang === 'it' ? ' active' : ''}`}
            onClick={() => setLang('it')}
            aria-label="Italiano"
            aria-pressed={lang === 'it'}
          >IT</button>
          <button
            className={`lang-btn${lang === 'en' ? ' active' : ''}`}
            onClick={() => setLang('en')}
            aria-label="English"
            aria-pressed={lang === 'en'}
          >EN</button>
          <button
            className="theme-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t('settings.themeLight') : t('settings.themeDark')}
            title={theme === 'dark' ? t('settings.themeLight') : t('settings.themeDark')}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
        </div>
      </div>
    </aside>
  )
}
