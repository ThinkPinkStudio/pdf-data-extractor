'use client'

import { useState, useRef } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

interface BatchResult {
  name: string
  status: 'pending' | 'processing' | 'done' | 'error'
  fields?: Record<string, string>
  error?: string
}

export default function BatchPage() {
  const [files, setFiles] = useState<File[]>([])
  const [fieldsDef, setFieldsDef] = useState('')
  const [results, setResults] = useState<BatchResult[]>([])
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done'>('idle')
  const inputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef(false)
  const t = useT()

  async function handleBatch(e: React.FormEvent) {
    e.preventDefault()
    if (!files.length) return
    setStatus('loading'); setProgress(0); cancelRef.current = false
    const init: BatchResult[] = files.map((f) => ({ name: f.name, status: 'pending' }))
    setResults(init)
    const acc = [...init]

    for (let i = 0; i < files.length; i++) {
      if (cancelRef.current) { acc[i] = { ...acc[i], status: 'error', error: 'Annullato' }; continue }
      acc[i] = { ...acc[i], status: 'processing' }; setResults([...acc])
      const form = new FormData()
      form.append('pdf', files[i]); form.append('fields', fieldsDef)
      try {
        const res = await fetch('/api/extract', { method: 'POST', body: form })
        if (res.ok) {
          const data = await res.json()
          const map: Record<string, string> = {}
          for (const f of data.fields as { name: string; value: string }[]) map[f.name] = f.value
          acc[i] = { name: files[i].name, status: 'done', fields: map }
        } else {
          acc[i] = { name: files[i].name, status: 'error', error: 'Errore estrazione' }
        }
      } catch {
        acc[i] = { name: files[i].name, status: 'error', error: 'Errore rete' }
      }
      setProgress(Math.round(((i + 1) / files.length) * 100))
      setResults([...acc])
    }
    setStatus('done')
  }

  const keys = results.find((r) => r.fields)?.fields ? Object.keys(results.find((r) => r.fields)!.fields!) : []

  function exportCsv() {
    const header = ['File', 'Stato', ...keys].join(',')
    const rows = results.map((r) => [r.name, r.status === 'done' ? 'OK' : 'Errore', ...keys.map((k) => `"${(r.fields?.[k] ?? '').replace(/"/g, '""')}"`)].join(','))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([[header, ...rows].join('\n')], { type: 'text/csv' }))
    a.download = 'estrazione_batch.csv'; a.click()
  }
  function exportXlsx() {
    fetch('/api/batch/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: results.map((r) => ({ name: r.name, success: r.status === 'done', fields: r.fields })), keys }) })
      .then((r) => r.blob()).then((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'estrazione_batch.xlsx'; a.click() })
  }

  const badge = (s: BatchResult['status']) => {
    const map = { pending: ['batch.stPending', 'var(--c-text-muted)'], processing: ['batch.stProcessing', 'var(--c-info)'], done: ['batch.stDone', 'var(--c-success)'], error: ['batch.stError', 'var(--c-error)'] } as const
    const [key, color] = map[s]
    return <span style={{ color, fontSize: 12, fontWeight: 600 }}>{t(key)}</span>
  }

  return (
    <>
      <h1 className="page-title">{t('batch.title')}</h1>

      <form onSubmit={handleBatch} style={{ maxWidth: 680 }}>
        <div className="form-group">
          <label className="label">{t('batch.filesLabel')}</label>
          <div className="card" style={{ cursor: 'pointer', textAlign: 'center', padding: 32, borderStyle: 'dashed' }} onClick={() => inputRef.current?.click()}>
            {files.length ? <span>{t('batch.filesSelected', { n: files.length })}</span> : <span style={{ color: 'var(--c-text-muted)' }}>{t('batch.dropEmpty')}</span>}
            <input ref={inputRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          </div>
        </div>

        <div className="form-group">
          <label className="label" htmlFor="fields-batch">{t('batch.fieldsLabel')}</label>
          <textarea id="fields-batch" rows={3} placeholder={t('batch.fieldsPlaceholder')} value={fieldsDef} onChange={(e) => setFieldsDef(e.target.value)} />
        </div>

        {status === 'loading' && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ height: 6, background: 'var(--c-bg-card-alt)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: 'var(--gradient-accent)', transition: 'width 0.3s' }} />
            </div>
            <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 4 }}>{t('batch.percent', { n: progress })}</p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary" disabled={!files.length || !fieldsDef.trim() || status === 'loading'}>
            {status === 'loading' ? <><span className="spinner" /> {t('batch.processing')}</> : t('batch.start')}
          </button>
          {status === 'loading' && <button type="button" className="btn btn-secondary" onClick={() => { cancelRef.current = true }}>{t('batch.cancel')}</button>}
          {status === 'done' && <><button type="button" className="btn btn-secondary" onClick={exportCsv}>{t('batch.exportCsv')}</button><button type="button" className="btn btn-secondary" onClick={exportXlsx}>{t('batch.exportXlsx')}</button></>}
        </div>
      </form>

      {results.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t('batch.results', { n: results.length })}</h2>
          <div className="card" style={{ padding: 0, overflow: 'auto' }}>
            <table>
              <thead><tr><th>{t('batch.colFile')}</th><th>{t('batch.colStatus')}</th>{keys.map((k) => <th key={k}>{k}</th>)}</tr></thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</td>
                    <td>{badge(r.status)}</td>
                    {keys.map((k) => <td key={k} style={{ color: r.fields?.[k] ? undefined : 'var(--c-text-muted)' }}>{r.fields?.[k] || '—'}</td>)}
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
