'use client'

import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { messages, type Lang } from './messages'

interface I18nCtx {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string, vars?: Record<string, string | number>) => string
}

const Ctx = createContext<I18nCtx | null>(null)

function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = messages[lang]?.[key] ?? messages.it[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  return s
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>('it')

  useEffect(() => {
    const saved = (localStorage.getItem('lang') as Lang | null) || 'it'
    if (saved !== 'it') setLangState(saved)
    document.documentElement.lang = saved
  }, [])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    localStorage.setItem('lang', l)
    document.documentElement.lang = l
    fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: l }) }).catch(() => {})
  }, [])

  const t = useCallback((key: string, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang])

  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>
}

export function useI18n(): I18nCtx {
  const c = useContext(Ctx)
  if (!c) return { lang: 'it', setLang: () => {}, t: (k) => messages.it[k] ?? k }
  return c
}

export function useT() {
  return useI18n().t
}
