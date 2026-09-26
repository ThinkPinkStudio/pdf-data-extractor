'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { NAV_EXTRACTOR_ITEMS, NAV_ALWAYS_VISIBLE } from '@/lib/navExtractor'
import { useI18n } from '@/lib/i18n/I18nProvider'
import GenericFieldsEditor from '@/components/GenericFieldsEditor'

interface Settings {
  llmProvider: string
  llmModel: string
  ollamaUrl: string
  ollamaModel?: string
  polizzaOcrEnabled?: boolean
  polizzaWholeDossier?: boolean
  polizzaPerField?: boolean
  polizzaConstrainedJson?: boolean
  polizzaBatchContext?: number
  bulkExcludedFolderNames?: string
  bulkIncludeKeywords?: string
  bulkExcludeKeywords?: string
  qdrantUrl?: string
  qdrantApiKey?: string
  qdrantCollection?: string
  embeddingModel?: string
  doclingUrl?: string
  // Verifica e qualità estrazione (GLOBALI, salvate col pulsante della pagina:
  // stavano nella card dei campi polizza e sembravano proprietà del profilo).
  polizzaWholeDossierModel?: string
  polizzaVerificaCampi?: string
  polizzaVerificaModel?: string
  polizzaConsensusPasses?: number
  polizzaStagedCascade?: boolean
  polizzaPrecheckMode?: 'off' | 'keywords' | 'semantic' | 'llm'
  polizzaThink?: 'off' | 'abbinamento' | 'estrazione' | 'tutto'
  polizzaOcrEngine?: string
  // Voci del menu PDF Extractor nascoste nella sidebar (href).
  navHiddenExtractor?: string[]
}

const DEFAULTS: Settings = {
  llmProvider: 'ollama', llmModel: '', ollamaUrl: 'http://localhost:11434',
  polizzaOcrEnabled: true, polizzaWholeDossier: false,
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}>
      <span style={{
        width: 38, height: 22, borderRadius: 999, position: 'relative', flexShrink: 0,
        background: checked ? 'var(--c-accent)' : 'var(--c-bg-card-alt)', border: '1px solid var(--c-border)', transition: 'background .2s',
      }}>
        <span style={{ position: 'absolute', top: 2, left: checked ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: checked ? '#fff' : 'var(--c-text-muted)', transition: 'left .2s' }} />
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ display: 'none' }} />
      <span style={{ fontSize: 14 }}>{label}</span>
    </label>
  )
}

export default function SettingsTechnicalPage() {
  const { t } = useI18n()
  const router = useRouter()
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

  const [docling, setDocling] = useState<{ connected: boolean; docling?: string | null; error?: string } | null>(null)
  const checkDocling = useCallback((url: string) => {
    if (!url) { setDocling(null); return }
    fetch('/api/settings/docling-status?url=' + encodeURIComponent(url)).then((r) => r.json()).then(setDocling).catch(() => setDocling({ connected: false, error: 'impossibile contattare' }))
  }, [])
  useEffect(() => { if (s.doclingUrl) checkDocling(s.doclingUrl) }, [s.doclingUrl, checkDocling])

  function up<K extends keyof Settings>(k: K, v: Settings[K]) { setS((p) => ({ ...p, [k]: v })); setSaved(false); setTestResult(null) }

  // Chiavi gestite e salvate dagli editor dedicati (PolizzaFieldsEditor / generico):
  // vanno escluse dal salvataggio della pagina per non sovrascriverle con valori stale.
  // Le chiavi di «Verifica e qualità» (modello fascicolo, consenso, arbitro,
  // strategia, pre-controllo) sono di QUESTA pagina dal 22/09/2026: si salvano
  // col pulsante come le altre.
  const EDITOR_KEYS = new Set([
    'polizzaPromptExtra', 'polizzaFields', 'polizzaProfiles',
    'polizzaActiveProfileId', 'extractions', 'profiles',
  ])
  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const rest: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s as unknown as Record<string, unknown>)) if (!EDITOR_KEYS.has(k)) rest[k] = v
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rest) })
    setSaved(true)
    // La sidebar è nel layout server: senza refresh le voci di menu
    // nascoste/mostrate cambierebbero solo al prossimo caricamento.
    router.refresh()
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
        {t('nav.settingsTech')}{' '}
        <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--c-text-muted)' }}>
          v{process.env.NEXT_PUBLIC_APP_VERSION || 'n/d'}
        </span>
      </h1>
      {/* Larghezza piena SENZA tetto: l'editor campi (etichetta+descrizione+celle)
          e il prompt vivono qui — prima 620px, poi 1200, ma su schermi larghi
          restava comunque metà monitor vuota. Le card seguono la colonna. */}
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Voci di menu della sidebar PDF Extractor: uno switch per voce
            (22/09/2026, richiesta dell'utente). «Impostazioni tecniche» non
            si può nascondere: è la pagina da cui si riaccendono le altre. */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('set.navSection')}</h2>
          <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 14 }}>{t('set.navHint')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {NAV_EXTRACTOR_ITEMS.map((item) => {
              const locked = NAV_ALWAYS_VISIBLE.has(item.href)
              const hidden = s.navHiddenExtractor || []
              const on = locked || !hidden.includes(item.href)
              return (
                <Toggle key={item.href} checked={on} disabled={locked}
                  label={locked ? `${t(item.key)} (${t('set.navLocked')})` : t(item.key)}
                  onChange={(v) => up('navHiddenExtractor', v ? hidden.filter((h) => h !== item.href) : [...hidden.filter((h) => h !== item.href), item.href])} />
              )
            })}
          </div>
        </div>

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
                min={2048}
                max={131072}
                step={1024}
                value={s.polizzaBatchContext ?? ''}
                placeholder="8192"
                onChange={(e) => up('polizzaBatchContext', e.target.value === '' ? undefined : (parseInt(e.target.value, 10) || undefined))}
              />
              <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>
                {t('set.batchContextHelp')}{' '}
                {(s.polizzaBatchContext ?? 8192) > 32768
                  ? <span style={{ color: 'var(--c-warning, #f0ad4e)' }}>{t('set.batchContextWarn')}</span>
                  : null}
              </p>
            </div>
          </div>
        </div>

        {/* Verifica e qualità estrazione: impostazioni GLOBALI (valgono per ogni
            profilo e ogni job), spostate qui dalla card dei campi polizza. */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('set.qualityTitle')}</h2>
          <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 14 }}>{t('set.qualitySubtitle')}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">{t('set.wholeDossierModel')}</label>
              <input value={s.polizzaWholeDossierModel ?? ''} onChange={(e) => up('polizzaWholeDossierModel', e.target.value)}
                placeholder="qwen2.5:7b-instruct" style={{ fontFamily: 'var(--font-mono)' }} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">{t('set.consensusPasses')}</label>
              <input type="number" min={2} max={5} value={s.polizzaConsensusPasses ?? 3}
                onChange={(e) => up('polizzaConsensusPasses', Math.max(2, Math.min(5, parseInt(e.target.value, 10) || 3)))} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">{t('set.verificaCampi')}</label>
              <input value={s.polizzaVerificaCampi ?? ''} onChange={(e) => up('polizzaVerificaCampi', e.target.value)} placeholder={t('set.verificaCampiPlaceholder')} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="label">{t('set.verificaModel')}</label>
              <input value={s.polizzaVerificaModel ?? ''} onChange={(e) => up('polizzaVerificaModel', e.target.value)}
                placeholder="claude-sonnet-4-6" style={{ fontFamily: 'var(--font-mono)' }} />
            </div>
            <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className="label">{t('set.stagedStrategy')}</label>
              <select value={s.polizzaStagedCascade ? 'cascade' : 'groups'} onChange={(e) => up('polizzaStagedCascade', e.target.value === 'cascade')}>
                <option value="groups">{t('set.stagedStrategyGroups')}</option>
                <option value="cascade">{t('set.stagedStrategyCascade')}</option>
              </select>
              <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('set.stagedStrategyHint')}</p>
            </div>
            <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className="label">{t('set.precheckMode')}</label>
              <select value={s.polizzaPrecheckMode ?? 'llm'} onChange={(e) => up('polizzaPrecheckMode', e.target.value as Settings['polizzaPrecheckMode'])}>
                <option value="llm">{t('set.precheckModeLlm')}</option>
                <option value="semantic">{t('set.precheckModeSemantic')}</option>
                <option value="keywords">{t('set.precheckModeKeywords')}</option>
                <option value="off">{t('set.precheckModeOff')}</option>
              </select>
              <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('set.precheckModeHint')}</p>
            </div>
            <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className="label">{t('set.think')}</label>
              <select value={s.polizzaThink ?? 'off'} onChange={(e) => up('polizzaThink', e.target.value as Settings['polizzaThink'])}>
                <option value="off">{t('set.thinkOff')}</option>
                <option value="abbinamento">{t('set.thinkMatch')}</option>
                <option value="estrazione">{t('set.thinkExtract')}</option>
                <option value="tutto">{t('set.thinkAll')}</option>
              </select>
              <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('set.thinkHint')}</p>
            </div>
            <div className="form-group" style={{ margin: 0, gridColumn: '1 / -1' }}>
              <label className="label">{t('set.ocrEngine')}</label>
              <input value={s.polizzaOcrEngine ?? ''} onChange={(e) => up('polizzaOcrEngine', e.target.value)} placeholder="tesseract" style={{ fontFamily: 'var(--font-mono)' }} />
              <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>{t('set.ocrEngineHint')}</p>
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
          <div className="form-group">
            <label className="label">Docling (markdown layout-aware)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input style={{ flex: 1 }} value={s.doclingUrl || ''} onChange={(e) => up('doclingUrl', e.target.value)} placeholder="http://host:8101" />
              <button type="button" className="btn btn-secondary" onClick={() => checkDocling(s.doclingUrl || '')} style={{ flexShrink: 0 }}>{t('set.verify')}</button>
            </div>
            {docling && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, fontSize: 12, color: 'var(--c-text-secondary)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: docling.connected ? 'var(--c-success)' : 'var(--c-error)' }} />
                {docling.connected
                  ? `Docling connesso${docling.docling ? ` · v${docling.docling}` : ''}`
                  : `Docling non raggiungibile${docling.error ? ` (${docling.error})` : ''}`}
              </div>
            )}
            <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 6 }}>URL del microservizio Docling (POST /parse). Vuoto = usa @firecrawl/pdf-inspector o OCR.</p>
          </div>
        </div>

        {/* Editor campi di estrazione generici + profili */}
        <GenericFieldsEditor />

        {saved && <div className="alert alert-success">{t('set.saved')}</div>}
        <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>{t('set.saveBtn')}</button>
      </form>
    </>
  )
}