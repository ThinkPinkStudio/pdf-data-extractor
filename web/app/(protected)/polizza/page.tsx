'use client'

import { useState, useRef } from 'react'

export default function PolizzaPage() {
  const [file, setFile] = useState<File | null>(null)
  const [results, setResults] = useState<Record<string, string> | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const evtRef = useRef<EventSource | null>(null)

  async function handleExtract(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setStatus('loading')
    setResults(null)
    setLog([])
    setErrorMsg('')

    // Upload PDF first
    const form = new FormData()
    form.append('pdf', file)
    const uploadRes = await fetch('/api/polizza', { method: 'POST', body: form })

    if (!uploadRes.ok) {
      const data = await uploadRes.json().catch(() => ({}))
      setErrorMsg(data.error || 'Errore durante l\'elaborazione.')
      setStatus('error')
      return
    }

    const data = await uploadRes.json()
    setResults(data.fields)
    setLog(data.log ?? [])
    setStatus('done')
  }

  return (
    <>
      <h1 className="page-title">Polizza RC</h1>

      <form onSubmit={handleExtract} style={{ maxWidth: 640 }}>
        <div className="form-group">
          <label className="label">File PDF Polizza</label>
          <div
            className="card"
            style={{ cursor: 'pointer', textAlign: 'center', padding: 32, borderStyle: 'dashed' }}
            onClick={() => inputRef.current?.click()}
          >
            {file ? (
              <span>{file.name}</span>
            ) : (
              <span style={{ color: 'var(--c-text-muted)' }}>Clicca per selezionare la polizza PDF</span>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf"
              style={{ display: 'none' }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        {status === 'error' && <div className="alert alert-error">{errorMsg}</div>}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={!file || status === 'loading'}
        >
          {status === 'loading' ? <><span className="spinner" /> Analisi polizza...</> : 'Analizza polizza'}
        </button>
      </form>

      {log.length > 0 && (
        <div style={{ marginTop: 20, maxWidth: 640 }}>
          <div className="card" style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--c-text-muted)', maxHeight: 200, overflow: 'auto', padding: 12 }}>
            {log.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
      )}

      {results && (
        <div style={{ marginTop: 24, maxWidth: 640 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Dati estratti</h2>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead>
                <tr><th>Campo</th><th>Valore</th></tr>
              </thead>
              <tbody>
                {Object.entries(results).map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ fontWeight: 500 }}>{k}</td>
                    <td style={{ color: v ? 'var(--c-text)' : 'var(--c-text-muted)' }}>{v || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  )
}
