'use client'

import { useState, useRef } from 'react'

interface ExtractedField {
  name: string
  value: string
}

export default function ExtractorPage() {
  const [file, setFile] = useState<File | null>(null)
  const [fields, setFields] = useState('')
  const [results, setResults] = useState<ExtractedField[] | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleExtract(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setStatus('loading')
    setResults(null)
    setErrorMsg('')

    const form = new FormData()
    form.append('pdf', file)
    form.append('fields', fields)

    const res = await fetch('/api/extract', { method: 'POST', body: form })
    if (res.ok) {
      const data = await res.json()
      setResults(data.fields)
      setStatus('done')
    } else {
      const data = await res.json().catch(() => ({}))
      setErrorMsg(data.error || 'Errore durante l\'estrazione.')
      setStatus('error')
    }
  }

  return (
    <>
      <h1 className="page-title">Estrazione PDF</h1>

      <form onSubmit={handleExtract} style={{ maxWidth: 640 }}>
        <div className="form-group">
          <label className="label">File PDF</label>
          <div
            className="card"
            style={{ cursor: 'pointer', textAlign: 'center', padding: 32, borderStyle: 'dashed' }}
            onClick={() => inputRef.current?.click()}
          >
            {file ? (
              <span style={{ color: 'var(--c-text)' }}>{file.name}</span>
            ) : (
              <span style={{ color: 'var(--c-text-muted)' }}>Clicca per selezionare un PDF</span>
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

        <div className="form-group">
          <label className="label" htmlFor="fields">Campi da estrarre</label>
          <textarea
            id="fields"
            rows={4}
            placeholder="es. nome, cognome, data di nascita, importo totale"
            value={fields}
            onChange={(e) => setFields(e.target.value)}
          />
          <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 4 }}>
            Inserisci i campi separati da virgola
          </p>
        </div>

        {status === 'error' && <div className="alert alert-error">{errorMsg}</div>}

        <button
          type="submit"
          className="btn btn-primary"
          disabled={!file || !fields.trim() || status === 'loading'}
        >
          {status === 'loading' ? <><span className="spinner" /> Estrazione in corso...</> : 'Estrai dati'}
        </button>
      </form>

      {results && (
        <div style={{ marginTop: 32, maxWidth: 640 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Risultati</h2>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead>
                <tr>
                  <th>Campo</th>
                  <th>Valore</th>
                </tr>
              </thead>
              <tbody>
                {results.map((f, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{f.name}</td>
                    <td style={{ color: f.value ? 'var(--c-text)' : 'var(--c-text-muted)' }}>
                      {f.value || '—'}
                    </td>
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
