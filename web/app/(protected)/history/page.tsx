'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface SessionRow {
  id: number
  file_name: string
  num_pages: number
  created_at: number
}

const IconFile = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
)

export default function HistoryPage() {
  const [rows, setRows] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [opening, setOpening] = useState<number | null>(null)
  const router = useRouter()

  function load() {
    fetch('/api/history').then((r) => r.json()).then((d) => { setRows(d.sessions ?? []); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(load, [])

  async function open(id: number) {
    setOpening(id)
    try {
      const s = await fetch(`/api/history/${id}`).then((r) => r.json())
      sessionStorage.setItem('restoreSession', JSON.stringify(s))
      router.push('/extractor')
    } finally {
      setOpening(null)
    }
  }
  async function del(id: number) {
    await fetch(`/api/history/${id}`, { method: 'DELETE' })
    setRows((p) => p.filter((r) => r.id !== id))
  }
  async function clearAll() {
    if (!confirm('Eliminare tutta la cronologia?')) return
    await fetch('/api/history', { method: 'DELETE' })
    setRows([])
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Cronologia</h1>
        {rows.length > 0 && <button className="btn btn-secondary" onClick={clearAll}>Svuota tutto</button>}
      </div>
      <p style={{ color: 'var(--c-text-muted)', marginBottom: 20, fontSize: 13 }}>Sessioni di estrazione salvate — riaprile per ripristinare PDF, dati e chat.</p>

      {loading ? <span className="spinner" />
        : rows.length === 0 ? <p style={{ color: 'var(--c-text-muted)' }}>Nessuna sessione salvata. Salva un&apos;estrazione dall&apos;Estrattore.</p>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 720 }}>
            {rows.map((r) => (
              <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 14 }}>
                <span style={{ width: 36, height: 36, borderRadius: 'var(--r-md)', background: 'var(--c-accent-faint)', border: '1px solid var(--c-accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-accent)', flexShrink: 0 }}><IconFile /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.file_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{r.num_pages} pagine · {new Date(r.created_at * 1000).toLocaleString('it-IT')}</div>
                </div>
                <button className="btn btn-primary" style={{ padding: '7px 14px' }} onClick={() => open(r.id)} disabled={opening === r.id}>{opening === r.id ? <span className="spinner" /> : 'Apri'}</button>
                <button className="btn btn-secondary" style={{ padding: '7px 12px' }} onClick={() => del(r.id)}>Elimina</button>
              </div>
            ))}
          </div>
        )}
    </>
  )
}
