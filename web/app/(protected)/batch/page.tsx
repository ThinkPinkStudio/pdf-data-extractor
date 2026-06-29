'use client'

import { useState, useRef } from 'react'

interface BatchResult {
  name: string
  success: boolean
  fields?: Record<string, string>
  error?: string
}

export default function BatchPage() {
  const [files, setFiles] = useState<FileList | null>(null)
  const [fieldsDef, setFieldsDef] = useState('')
  const [results, setResults] = useState<BatchResult[]>([])
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleBatch(e: React.FormEvent) {
    e.preventDefault()
    if (!files?.length) return
    setStatus('loading')
    setResults([])
    setProgress(0)

    const total = files.length
    const batchResults: BatchResult[] = []

    for (let i = 0; i < total; i++) {
      const file = files[i]
      const form = new FormData()
      form.append('pdf', file)
      form.append('fields', fieldsDef)

      const res = await fetch('/api/extract', { method: 'POST', body: form })
      if (res.ok) {
        const data = await res.json()
        batchResults.push({ name: file.name, success: true, fields: data.fields })
      } else {
        batchResults.push({ name: file.name, success: false, error: 'Errore estrazione' })
      }
      setProgress(Math.round(((i + 1) / total) * 100))
      setResults([...batchResults])
    }
    setStatus('done')
  }

  function exportCsv() {
    if (!results.length) return
    const keys = Object.keys(results[0].fields ?? {})
    const header = ['File', ...keys].join(',')
    const rows = results.map((r) =>
      [r.name, ...keys.map((k) => `"${(r.fields?.[k] ?? '').replace(/"/g, '""')}"`)]
        .join(',')
    )
    const csv = [header, ...rows].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'estrazione_batch.csv'
    a.click()
  }

  return (
    <>
      <h1 className="page-title">Elaborazione Batch</h1>

      <form onSubmit={handleBatch} style={{ maxWidth: 640 }}>
        <div className="form-group">
          <label className="label">File PDF (multipli)</label>
          <div
            className="card"
            style={{ cursor: 'pointer', textAlign: 'center', padding: 32, borderStyle: 'dashed' }}
            onClick={() => inputRef.current?.click()}
          >
            {files?.length ? (
              <span>{files.length} file selezionati</span>
            ) : (
              <span style={{ color: 'var(--c-text-muted)' }}>Clicca per selezionare più PDF</span>
            )}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => setFiles(e.target.files)}
            />
          </div>
        </div>

        <div className="form-group">
          <label className="label" htmlFor="fields-batch">Campi da estrarre</label>
          <textarea
            id="fields-batch"
            rows={3}
            placeholder="es. nome, cognome, importo"
            value={fieldsDef}
            onChange={(e) => setFieldsDef(e.target.value)}
          />
        </div>

        {status === 'loading' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ height: 6, background: 'var(--c-surface-2)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: 'var(--c-accent)', transition: 'width 0.3s' }} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 4 }}>{progress}% completato</p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!files?.length || !fieldsDef.trim() || status === 'loading'}
          >
            {status === 'loading' ? <><span className="spinner" /> Elaborazione...</> : 'Avvia batch'}
          </button>
          {status === 'done' && (
            <button type="button" className="btn btn-secondary" onClick={exportCsv}>
              Esporta CSV
            </button>
          )}
        </div>
      </form>

      {results.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Risultati ({results.length})</h2>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Stato</th>
                  {results[0].fields && Object.keys(results[0].fields).map((k) => <th key={k}>{k}</th>)}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</td>
                    <td>
                      <span style={{ color: r.success ? 'var(--c-success)' : 'var(--c-danger)', fontSize: 12 }}>
                        {r.success ? '✓ OK' : '✗ Errore'}
                      </span>
                    </td>
                    {r.fields && Object.values(r.fields).map((v, j) => (
                      <td key={j} style={{ color: v ? undefined : 'var(--c-text-muted)' }}>{v || '—'}</td>
                    ))}
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
