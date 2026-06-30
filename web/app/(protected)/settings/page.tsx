'use client'

import { useState, useEffect, useCallback } from 'react'

interface Settings {
  llmProvider: string
  llmModel: string
  ollamaUrl: string
  openaiApiKey: string
  anthropicApiKey: string
  openaiModel?: string
  anthropicModel?: string
  ollamaModel?: string
  ollamaVisionModel?: string
  anthropicVisionModel?: string
  polizzaOcrEnabled?: boolean
  polizzaWholeDossier?: boolean
  polizzaPromptExtra?: string
  theme?: string
  language?: string
  accentColor?: string
}

const DEFAULTS: Settings = {
  llmProvider: 'ollama', llmModel: '', ollamaUrl: 'http://localhost:11434',
  openaiApiKey: '', anthropicApiKey: '', polizzaOcrEnabled: true, polizzaWholeDossier: false,
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
  useEffect(() => { if (s.llmProvider === 'ollama' && s.ollamaUrl) checkOllama(s.ollamaUrl) }, [s.llmProvider, s.ollamaUrl, checkOllama])

  function up<K extends keyof Settings>(k: K, v: Settings[K]) { setS((p) => ({ ...p, [k]: v })); setSaved(false); setTestResult(null) }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
    setSaved(true)
  }
  async function handleTest() {
    setTesting(true); setTestResult(null)
    const res = await fetch('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
    const d = await res.json()
    setTestResult({ ok: d.ok, msg: d.message || (d.ok ? 'Connessione riuscita' : 'Connessione fallita') })
    setTesting(false)
  }

  const isCloud = s.llmProvider === 'openai' || s.llmProvider === 'anthropic'

  return (
    <>
      <h1 className="page-title">Impostazioni</h1>
      <form onSubmit={handleSave} style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Provider LLM */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Provider LLM</h2>
          <div className="form-group">
            <label className="label">Provider</label>
            <select value={s.llmProvider} onChange={(e) => up('llmProvider', e.target.value)}>
              <option value="ollama">Ollama (locale)</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>
          {isCloud && (
            <div className="alert alert-error" style={{ marginBottom: 16 }}>
              ⚠ Provider cloud: i documenti verranno inviati a server esterni. Verifica la conformità GDPR prima dell&apos;uso.
            </div>
          )}

          {s.llmProvider === 'ollama' && (
            <>
              <div className="form-group">
                <label className="label">URL Ollama</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="url" value={s.ollamaUrl} onChange={(e) => up('ollamaUrl', e.target.value)} placeholder="http://localhost:11434" />
                  <button type="button" className="btn btn-secondary" onClick={() => checkOllama(s.ollamaUrl)} style={{ flexShrink: 0 }}>Verifica</button>
                </div>
                {ollama && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 12, color: 'var(--c-text-secondary)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: ollama.connected ? 'var(--c-success)' : 'var(--c-error)' }} />
                    {ollama.connected ? `Connesso · ${ollama.models.length} modelli` : 'Non raggiungibile'}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="label">Modello testo</label>
                {ollama?.models?.length
                  ? <select value={s.ollamaModel || s.llmModel} onChange={(e) => { up('ollamaModel', e.target.value); up('llmModel', e.target.value) }}>
                      <option value="">— seleziona —</option>
                      {ollama.models.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  : <input value={s.ollamaModel || s.llmModel} onChange={(e) => { up('ollamaModel', e.target.value); up('llmModel', e.target.value) }} placeholder="es. llama3" />}
              </div>
              <div className="form-group">
                <label className="label">Modello vision (PDF scansionati)</label>
                <input value={s.ollamaVisionModel || ''} onChange={(e) => up('ollamaVisionModel', e.target.value)} placeholder="es. llama3.2-vision" />
              </div>
            </>
          )}

          {s.llmProvider === 'openai' && (
            <>
              <div className="form-group"><label className="label">API Key OpenAI</label>
                <input type="password" value={s.openaiApiKey} onChange={(e) => up('openaiApiKey', e.target.value)} placeholder="sk-..." /></div>
              <div className="form-group"><label className="label">Modello</label>
                <input value={s.openaiModel || s.llmModel} onChange={(e) => { up('openaiModel', e.target.value); up('llmModel', e.target.value) }} placeholder="es. gpt-4o" /></div>
            </>
          )}

          {s.llmProvider === 'anthropic' && (
            <>
              <div className="form-group"><label className="label">API Key Anthropic</label>
                <input type="password" value={s.anthropicApiKey} onChange={(e) => up('anthropicApiKey', e.target.value)} placeholder="sk-ant-..." /></div>
              <div className="form-group"><label className="label">Modello</label>
                <input value={s.anthropicModel || s.llmModel} onChange={(e) => { up('anthropicModel', e.target.value); up('llmModel', e.target.value) }} placeholder="es. claude-sonnet-4-6" /></div>
              <div className="form-group"><label className="label">Modello vision (OCR)</label>
                <input value={s.anthropicVisionModel || ''} onChange={(e) => up('anthropicVisionModel', e.target.value)} placeholder="es. claude-sonnet-4-6" /></div>
            </>
          )}

          {testResult && <div className={`alert ${testResult.ok ? 'alert-success' : 'alert-error'}`}>{testResult.msg}</div>}
          <button type="button" className="btn btn-secondary" onClick={handleTest} disabled={testing}>
            {testing ? <><span className="spinner" /> Test…</> : 'Testa connessione'}
          </button>
        </div>

        {/* Polizze */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Polizze</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Toggle checked={s.polizzaOcrEnabled !== false} onChange={(v) => up('polizzaOcrEnabled', v)} label="OCR Tesseract abilitato (PDF scansionati)" />
            <Toggle checked={!!s.polizzaWholeDossier} onChange={(v) => up('polizzaWholeDossier', v)} label="Modalità fascicolo intero (OCR di tutte le pagine → 1 chiamata)" />
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="label">Istruzioni extra per l&apos;AI (prompt)</label>
              <textarea value={s.polizzaPromptExtra || ''} onChange={(e) => up('polizzaPromptExtra', e.target.value)} rows={3} placeholder="Indicazioni aggiuntive per l'estrazione delle polizze…" style={{ resize: 'vertical' }} />
            </div>
          </div>
        </div>

        {/* Aspetto */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Aspetto</h2>
          <div className="form-group">
            <label className="label">Tema</label>
            <select value={s.theme || 'dark'} onChange={(e) => { up('theme', e.target.value); document.documentElement.setAttribute('data-theme', e.target.value); localStorage.setItem('theme', e.target.value) }}>
              <option value="dark">Scuro</option>
              <option value="light">Chiaro</option>
            </select>
          </div>
          <div className="form-group">
            <label className="label">Lingua</label>
            <select value={s.language || 'it'} onChange={(e) => { up('language', e.target.value); localStorage.setItem('lang', e.target.value); document.documentElement.lang = e.target.value }}>
              <option value="it">Italiano</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label">Colore accento</label>
            <input type="color" value={s.accentColor || '#e91e8c'} onChange={(e) => { up('accentColor', e.target.value); document.documentElement.style.setProperty('--c-accent', e.target.value); localStorage.setItem('accentColor', e.target.value) }} style={{ width: 60, height: 36, padding: 2 }} />
          </div>
        </div>

        {saved && <div className="alert alert-success">Impostazioni salvate.</div>}
        <button type="submit" className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>Salva impostazioni</button>
      </form>
    </>
  )
}
