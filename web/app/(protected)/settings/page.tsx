'use client'

import { useState, useEffect, useCallback } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import PolizzaFieldsEditor from '@/components/PolizzaFieldsEditor'
import GenericFieldsEditor from '@/components/GenericFieldsEditor'

interface Settings {
  llmProvider: string
  llmModel: string
  ollamaUrl: string
  ollamaModel?: string
  ollamaVisionModel?: string
  polizzaOcrEnabled?: boolean
  polizzaWholeDossier?: boolean
  polizzaPerField?: boolean
  polizzaConstrainedJson?: boolean
  polizzaBatchContext?: number
  polizzaPromptExtra?: string
  bulkExcludedFolderNames?: string
  bulkIncludeKeywords?: string
  bulkExcludeKeywords?: string
  qdrantUrl?: string
  qdrantApiKey?: string
  qdrantCollection?: string
  embeddingModel?: string
  theme?: string
  language?: string
  accentColor?: string
}

const DEFAULTS: Settings = {
  llmProvider: 'ollama', llmModel: '', ollamaUrl: 'http://localhost:11434',
  polizzaOcrEnabled: true, polizzaWholeDossier: false,
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
      <span style={{
        width: 38, height: 22, borderRadius: 999, position: 'relative', flexShrink: 0,
        background: checked ? 'var(--c-accent)' : 'var(--c-bg-card-alt)', border: '1px solid var(--c-border)', transition: 'background .2s',
      }}>
        <span style={{ position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: checked ? '#fff' : 'var(--c-text-muted)', transition: 'left .2s' }} />
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ display: 'none' }} />
      <span style={{ fontSize: 14 }}>{label}</span>
    </label>
  )
}

export default function SettingsPage() {
  const { t, setLang } = useI18n()
  const [s, setS] = useState<Settings>(DEFAULTS)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [ollama, setOllama] = useState<{ connected: boolean; models: string[] } | null>(null)

  useEffect(() => {
    fetch('/api/settings').then((r) => r.json()).then((d) => setS((p) => ({ ...p, ...d }))).catch(() => {})
  }, [])

  const checkOllama = useCallback((url: string) => {
    fetch('/api/settings/ollama-status?url=' + encodeURIComponent(url)).then((r) => r.json()).then(setOllama).catch(() => setOllama({ connected: false, models: [] }))
  }, [])
  useEffect(() => { if (s.ollamaUrl) checkOllama(s.ollamaUrl) }, [s.ollamaUrl, checkOllama])

  function up<K extends keyof Settings>(k: K, v: Settings[K]) { setS((p) => ({ ...p, [k]: v })); setSaved(false); setTestResult(null) }

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
  async function handleTest() {
    setTesting(true); setTestResult(null)
    const res = await fetch('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ llmProvider: 'ollama', ollamaUrl: s.ollamaUrl, llmModel: s.ollamaModel || s.llmModel }) })
    const d = await res.json()
    setTestResult({ ok: d.ok, msg: d.message || (d.ok ? t('set.connOk') : t('set.connFail')) })
    setTesting(false)
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

        {/* Provider LLM — SOLO Ollama (locale) */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{t('set.providerSection')}</h2>

          <div className="form-group">
            <label className="label">{t('set.ollamaUrl')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input type="url" value={s.ollamaUrl} onChange={(e) => up('ollamaUrl', e.target.value)} placeholder="http://localhost:11434" />
              <button type="button" className="btn btn-secondary" onClick={() => checkOllama(s.ollamaUrl)} style={{ flexShrink: 0 }}>{t('set.verify')}</button>
            </div>
            {ollama && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: 'var(--c-text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: ollama.connected ? 'var(--c-success)' : 'var(--c-error)' }} />
                {ollama.connected ? t('set.connected', { n: ollama.models.length }) : t('set.notReachable')}
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="label">{t('set.textModel')}</label>
            {ollama?.models?.length
              ? <select value={s.ollamaModel || s.llmModel} onChange={(e) => { up('ollamaModel', e.target.value); up('llmModel', e.target.value) }}>
                  <option value="">{t('set.selectPlaceholder')}</option>
                  {ollama.models.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              : <input value={s.ollamaModel || s.llmModel} onChange={(e) => { up('ollamaModel', e.target.value); up('llmModel', e.target.value) }} placeholder="es. llama3.1" />}
          </div>

          {/* Il campo "Modello vision" è stato RIMOSSO: il percorso vision è
              dismesso — i PDF scansionati passano dall'OCR Tesseract e tutto va
              al modello di testo. Mai più errori "Multimodal data provided". */}

          {testResult && <div className={`alert ${testResult.ok ? 'alert-success' : 'alert-error'}`}>{testResult.msg}</div>}
          <button type="button" className="btn btn-secondary" onClick={() => handleTest()} disabled={testing}>
            {testing ? <><span className="spinner" /> {t('set.testing')}</> : t('set.testConn')}
          </button>
        </div>

        {/* Polizze */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{t('set.polizzeSection')}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Toggle checked={s.polizzaOcrEnabled !== false} onChange={(v) => up('polizzaOcrEnabled', v)} label={t('set.ocrEnabled')} />
            <Toggle checked={!!s.polizzaWholeDossier} onChange={(v) => up('polizzaWholeDossier', v)} label={t('set.wholeDossier')} />
            <Toggle checked={s.polizzaPerField !== false} onChange={(v) => up('polizzaPerField', v)} label={t('set.perField')} />
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', margin: 0 }}>{t('set.perFieldHelp')}</p>
            <Toggle checked={s.polizzaConstrainedJson !== false} onChange={(v) => up('polizzaConstrainedJson', v)} label={t('set.constrainedJson')} />
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', margin: 0 }}>{t('set.constrainedJsonHelp')}</p>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="label">{t('set.batchContext')}</label>
              <input
                type="number"
                min={1}
                step={1024}
                value={s.polizzaBatchContext || 24576}
                onChange={(e) => up('polizzaBatchContext', e.target.value ? parseInt(e.target.value, 10) || 24576 : undefined)}
              />
              <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>
                {t('set.batchContextHelp')}{' '}
                {(s.polizzaBatchContext || 24576) > 24576
                  ? <span style={{ color: 'var(--c-warning, #f0ad4e)' }}>{t('set.batchContextWarn')}</span>
                  : null}
              </p>
            </div>
          </div>
        </div>

        {/* Bulk (cartella intera di polizze) */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{t('set.bulkSection')}</h2>
          <div className="form-group">
            <label className="label">{t('set.bulkExcluded')}</label>
            <input
              value={s.bulkExcludedFolderNames || ''}
              onChange={(e) => up('bulkExcludedFolderNames', e.target.value)}
              placeholder={t('set.bulkExcludedPlaceholder')}
            />
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('set.bulkExcludedHelp')}</p>
          </div>
          <div className="form-group">
            <label className="label">{t('set.bulkInclude')}</label>
            <input
              value={s.bulkIncludeKeywords || ''}
              onChange={(e) => up('bulkIncludeKeywords', e.target.value)}
              placeholder={t('set.bulkIncludePlaceholder')}
            />
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('set.bulkIncludeHelp')}</p>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label">{t('set.bulkExcludeWords')}</label>
            <input
              value={s.bulkExcludeKeywords || ''}
              onChange={(e) => up('bulkExcludeKeywords', e.target.value)}
              placeholder={t('set.bulkExcludeWordsPlaceholder')}
            />
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('set.bulkExcludeWordsHelp')}</p>
          </div>
        </div>

        {/* Indice vettoriale (Qdrant + embeddings Ollama) */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>{t('set.vectorSection')}</h2>
          <div className="form-group">
            <label className="label">{t('set.qdrantUrl')}</label>
            <input value={s.qdrantUrl || ''} onChange={(e) => up('qdrantUrl', e.target.value)} placeholder="http://qdrant:6333" />
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('set.qdrantUrlHelp')}</p>
          </div>
          <div className="form-group">
            <label className="label">{t('set.qdrantApiKey')}</label>
            <input type="password" autoComplete="off" value={s.qdrantApiKey || ''} onChange={(e) => up('qdrantApiKey', e.target.value)} placeholder="API key (se il server la richiede)" />
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('set.qdrantApiKeyHelp')}</p>
          </div>
          <div className="form-group">
            <label className="label">{t('set.qdrantCollection')}</label>
            <input value={s.qdrantCollection || ''} onChange={(e) => up('qdrantCollection', e.target.value)} placeholder="documenti" />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label">{t('set.embeddingModel')}</label>
            <input value={s.embeddingModel || ''} onChange={(e) => up('embeddingModel', e.target.value)} placeholder="bge-m3" />
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('set.embeddingModelHelp')}</p>
          </div>
        </div>

        {/* Editor campi di estrazione generici + profili */}
        <GenericFieldsEditor />

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
