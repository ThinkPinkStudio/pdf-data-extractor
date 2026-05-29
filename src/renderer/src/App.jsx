import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Sidebar from './components/Sidebar.jsx'
import Extractor from './pages/Extractor.jsx'
import Settings from './pages/Settings.jsx'
import Contacts from './pages/Contacts.jsx'
import Batch from './pages/Batch.jsx'
import History from './pages/History.jsx'
import Polizza from './pages/Polizza.jsx'

const DEFAULT_ACCENT = '#e91e8c'

function darkenHex(hex, amount = 0.1) {
  try {
    const h = hex.replace('#', '')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const dr = Math.max(0, Math.round(r * (1 - amount)))
    const dg = Math.max(0, Math.round(g * (1 - amount)))
    const db = Math.max(0, Math.round(b * (1 - amount)))
    return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`
  } catch {
    return hex
  }
}

function applyAccentColor(color) {
  const accent = color || DEFAULT_ACCENT
  document.documentElement.style.setProperty('--c-accent', accent)
  document.documentElement.style.setProperty('--c-accent-hover', darkenHex(accent, 0.1))
}

export default function App() {
  const { i18n } = useTranslation()
  const [page, setPage] = useState('extractor')
  const [theme, setTheme] = useState('dark')
  const [restoredSession, setRestoredSession] = useState(null)

  useEffect(() => {
    const load = async () => {
      const s = await window.electronAPI.getSettings()
      if (s.theme) setTheme(s.theme)
      if (s.language) i18n.changeLanguage(s.language)
      applyAccentColor(s.accentColor)
    }
    load()
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const handleThemeChange = (t) => setTheme(t)
  const handleLangChange = (l) => i18n.changeLanguage(l)
  const handleAccentChange = useCallback((color) => applyAccentColor(color), [])

  const handleRestoreSession = useCallback((session) => {
    setRestoredSession(session)
    setPage('extractor')
  }, [])

  return (
    <>
      <a href="#main-content" className="skip-nav">
        Skip to main content
      </a>
      <div className="app-shell">
        <Sidebar
          page={page}
          onNavigate={setPage}
          theme={theme}
          onThemeChange={handleThemeChange}
          lang={i18n.language}
          onLangChange={handleLangChange}
        />
        <main
          id="main-content"
          className="main-content"
          role="main"
          aria-label={page}
          tabIndex={-1}
        >
          {/* Always mounted — CSS hides inactive pages to preserve state */}
          <div style={{ display: page === 'extractor' ? 'contents' : 'none' }}>
            <Extractor
              restoredSession={restoredSession}
              onSessionRestored={() => setRestoredSession(null)}
            />
          </div>
          <div style={{ display: page === 'polizza' ? 'contents' : 'none' }}>
            <Polizza visible={page === 'polizza'} />
          </div>
          <div style={{ display: page === 'batch' ? 'contents' : 'none' }}>
            <Batch />
          </div>
          <div style={{ display: page === 'history' ? 'contents' : 'none' }}>
            <History onRestoreSession={handleRestoreSession} />
          </div>
          <div style={{ display: page === 'settings' ? 'contents' : 'none' }}>
            <Settings
              onThemeChange={handleThemeChange}
              onLangChange={handleLangChange}
              onAccentChange={handleAccentChange}
              currentTheme={theme}
              currentLang={i18n.language}
            />
          </div>
          <div style={{ display: page === 'contacts' ? 'contents' : 'none' }}>
            <Contacts />
          </div>
        </main>
      </div>
    </>
  )
}
