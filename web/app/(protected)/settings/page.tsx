'use client'

import { useState, useEffect } from 'react'

interface Settings {
  llmProvider: string
  llmModel: string
  ollamaUrl: string
  openaiApiKey: string
  anthropicApiKey: string
}

const DEFAULT_SETTINGS: Settings = {
  llmProvider: 'ollama',
  llmModel: '',
  ollamaUrl: 'http://localhost:11434',
  openaiApiKey: '',
  anthropicApiKey: '',
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((d) => setSettings((prev) => ({ ...prev, ...d })))
      .catch(() => {})
  }, [])

  function update(key: keyof Settings, value: string) {
    setSettings((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
    setTestResult(null)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSaved(true)
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    const res = await fetch('/api/settings/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    const data = await res.json()
    setTestResult({ ok: data.ok, msg: data.message || (data.ok ? 'Connessione riuscita' : 'Connessione fallita') })
    setTesting(false)
  }

  return (
    <>
      <h1 className="page-title">Impostazioni</h1>

      <form onSubmit={handleSave} style={{ maxWidth: 560 }}>
        <div className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Provider LLM</h2>

          <div className="form-group">
            <label className="label">Provider</label>
            <select value={settings.llmProvider} onChange={(e) => update('llmProvider', e.target.value)}>
              <option value="ollama">Ollama (locale)</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </div>

          {settings.llmProvider === 'ollama' && (
            <div className="form-group">
              <label className="label">URL Ollama</label>
              <input
                type="url"
                value={settings.ollamaUrl}
                onChange={(e) => update('ollamaUrl', e.target.value)}
                placeholder="http://localhost:11434"
              />
            </div>
          )}

          {settings.llmProvider === 'openai' && (
            <div className="form-group">
              <label className="label">API Key OpenAI</label>
              <input
                type="password"
                value={settings.openaiApiKey}
                onChange={(e) => update('openaiApiKey', e.target.value)}
                placeholder="sk-..."
              />
            </div>
          )}

          {settings.llmProvider === 'anthropic' && (
            <div className="form-group">
              <label className="label">API Key Anthropic</label>
              <input
                type="password"
                value={settings.anthropicApiKey}
                onChange={(e) => update('anthropicApiKey', e.target.value)}
                placeholder="sk-ant-..."
              />
            </div>
          )}

          <div className="form-group">
            <label className="label">Modello</label>
            <input
              type="text"
              value={settings.llmModel}
              onChange={(e) => update('llmModel', e.target.value)}
              placeholder={settings.llmProvider === 'ollama' ? 'es. llama3' : settings.llmProvider === 'openai' ? 'es. gpt-4o' : 'es. claude-sonnet-4-6'}
            />
          </div>

          {testResult && (
            <div className={`alert ${testResult.ok ? 'alert-success' : 'alert-error'}`}>
              {testResult.msg}
            </div>
          )}

          <button type="button" className="btn btn-secondary" onClick={handleTest} disabled={testing}>
            {testing ? <><span className="spinner" /> Test...</> : 'Testa connessione'}
          </button>
        </div>

        {saved && <div className="alert alert-success">Impostazioni salvate.</div>}

        <button type="submit" className="btn btn-primary">Salva impostazioni</button>
      </form>
    </>
  )
}
