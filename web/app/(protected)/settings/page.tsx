'use client'

import { useState, useEffect } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import PolizzaFieldsEditor from '@/components/PolizzaFieldsEditor'

interface Settings {
  theme?: string
  language?: string
  accentColor?: string
}

const DEFAULTS: Settings = {}

export default function SettingsPage() {
  const { t, setLang } = useI18n()
  const [s, setS] = useState<Settings>(DEFAULTS)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((d) => setS((p) => ({ ...p, ...d }))).catch(() => {})
  }, [])

  function up<K extends keyof Settings>(k: K, v: Settings[K]) { setS((p) => ({ ...p, [k]: v })); setSaved(false) }

  // Chiavi gestite e salvate dagli editor dedicati (PolizzaFieldsEditor / generico):
  // vanno escluse dal salvataggio della pagina per non sovrascriverle con valori stale.
  const EDITOR_KEYS = new Set([
    'polizzaPromptExtra', 'polizzaFields', 'polizzaProfiles', 'polizzaWholeDossierModel',
    'polizzaActiveProfileId',
    'polizzaVerificaCampi', 'polizzaVerificaModel', 'polizzaConsensusPasses', 'extractions', 'profiles',
    // Switch strategia (card campi polizza, persiste da solo al cambio): senza
    // questa esclusione il "Salva impostazioni" della pagina lo sovrascriveva
    // col valore stantio caricato al mount → "torna sempre a gruppi".
    'polizzaStagedCascade',
  ])
  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const rest: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s as unknown as Record<string, unknown>)) if (!EDITOR_KEYS.has(k)) rest[k] = v
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rest) })
    setSaved(true)
  }

  return (
    <>
      {/* Versione DENTRO la pagina: elimina il dubbio "che build sto guardando?" */}
      <h1 className="page-title">
        {t('set.title')}{' '}
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--c-text-muted)' }}>
          v{process.env.NEXT_PUBLIC_APP_VERSION || 'n/d'}
        </span>
      </h1>
      {/* Larghezza piena SENZA tetto: l'editor campi (etichetta+descrizione+celle)
          e il prompt vivono qui — prima 620px, poi 1200, ma su schermi larghi
          restava comunque metà monitor vuota. Le card seguono la colonna. */}
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Editor campi polizza + prompt + profili JSON */}
        <PolizzaFieldsEditor />

        {/* Aspetto */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{t('set.appearanceSection')}</h2>
          <div className="form-group">
            <label className="label">{t('set.theme')}</label>
            <select value={s.theme || 'dark'} onChange={(e) => { up('theme', e.target.value); document.documentElement.setAttribute('data-theme', e.target.value); localStorage.setItem('theme', e.target.value) }}>
              <option value="dark">{t('set.dark')}</option>
              <option value="light">{t('set.light')}</option>
            </select>
          </div>
          <div className="form-group">
            <label className="label">{t('set.language')}</label>
            <select value={s.language || 'it'} onChange={(e) => { up('language', e.target.value); setLang(e.target.value as 'it' | 'en') }}>
              <option value="it">{t('set.italian')}</option>
              <option value="en">{t('set.english')}</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label">{t('set.accent')}</label>
            <input type="color" value={s.accentColor || '#e91e8c'} onChange={(e) => { up('accentColor', e.target.value); document.documentElement.style.setProperty('--c-accent', e.target.value); localStorage.setItem('accentColor', e.target.value) }} style={{ width: 60, height: 36, padding: 2 }} />
          </div>
        </div>

        {saved && <div className="alert alert-success">{t('set.saved')}</div>}
        <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>{t('set.saveBtn')}</button>
      </form>
    </>
  )
}