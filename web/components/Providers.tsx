'use client'

import { I18nextProvider } from 'react-i18next'
import i18n from '@/i18n'
import { createContext, useContext, useEffect, useState, useCallback } from 'react'

// Tema (dark/light), accent e lingua — come App.jsx del renderer.
// Persistiti in localStorage (lato web) e applicati a <html> (data-theme, --c-accent).

const DEFAULT_ACCENT = '#e91e8c'

function darkenHex(hex: string, amount = 0.1): string {
  try {
    const h = hex.replace('#', '')
    const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount)))
    const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount)))
    const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount)))
    const x = (n: number) => n.toString(16).padStart(2, '0')
    return `#${x(r)}${x(g)}${x(b)}`
  } catch {
    return hex
  }
}

function applyAccent(color: string) {
  const accent = color || DEFAULT_ACCENT
  document.documentElement.style.setProperty('--c-accent', accent)
  document.documentElement.style.setProperty('--c-accent-hover', darkenHex(accent, 0.1))
}

interface ChromeCtx {
  theme: string
  setTheme: (t: string) => void
  accent: string
  setAccent: (c: string) => void
  lang: string
  setLang: (l: string) => void
}

const Ctx = createContext<ChromeCtx>({
  theme: 'dark', setTheme: () => {}, accent: DEFAULT_ACCENT, setAccent: () => {}, lang: 'it', setLang: () => {},
})

export const useChrome = () => useContext(Ctx)

export default function Providers({ children }: { children: React.ReactNode }) {
  const [theme, setThemeS] = useState('dark')
  const [accent, setAccentS] = useState(DEFAULT_ACCENT)
  const [lang, setLangS] = useState('it')

  useEffect(() => {
    const t = localStorage.getItem('theme') || 'dark'
    const a = localStorage.getItem('accent') || DEFAULT_ACCENT
    const l = localStorage.getItem('lang') || 'it'
    setThemeS(t)
    setAccentS(a)
    setLangS(l)
    document.documentElement.setAttribute('data-theme', t)
    applyAccent(a)
    if (i18n.language !== l) i18n.changeLanguage(l)
  }, [])

  const setTheme = useCallback((t: string) => {
    setThemeS(t)
    localStorage.setItem('theme', t)
    document.documentElement.setAttribute('data-theme', t)
  }, [])
  const setAccent = useCallback((c: string) => {
    setAccentS(c)
    localStorage.setItem('accent', c)
    applyAccent(c)
  }, [])
  const setLang = useCallback((l: string) => {
    setLangS(l)
    localStorage.setItem('lang', l)
    i18n.changeLanguage(l)
  }, [])

  return (
    <I18nextProvider i18n={i18n}>
      <Ctx.Provider value={{ theme, setTheme, accent, setAccent, lang, setLang }}>{children}</Ctx.Provider>
    </I18nextProvider>
  )
}
