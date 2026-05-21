import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import Sidebar from './components/Sidebar.jsx'
import Extractor from './pages/Extractor.jsx'
import Settings from './pages/Settings.jsx'
import Contacts from './pages/Contacts.jsx'

export default function App() {
  const { i18n } = useTranslation()
  const [page, setPage] = useState('extractor')
  const [theme, setTheme] = useState('dark')

  useEffect(() => {
    const load = async () => {
      const s = await window.electronAPI.getSettings()
      if (s.theme) setTheme(s.theme)
      if (s.language) i18n.changeLanguage(s.language)
    }
    load()
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const handleThemeChange = (t) => setTheme(t)
  const handleLangChange = (l) => i18n.changeLanguage(l)

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
            <Extractor />
          </div>
          <div style={{ display: page === 'settings' ? 'contents' : 'none' }}>
            <Settings
              onThemeChange={handleThemeChange}
              onLangChange={handleLangChange}
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
