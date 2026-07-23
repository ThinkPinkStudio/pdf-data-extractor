'use client'

import { useEffect, useState } from 'react'

interface Log { id: number; timestamp: string; email: string | null; action: string; resource: string | null; metadata: string | null; success: boolean }

export default function AdesioniRegistroPage() {
  const [logs, setLogs] = useState<Log[]>([])

  useEffect(() => {
    fetch('/api/adesioni/registro').then((r) => r.json()).then((d) => setLogs(d.logs || [])).catch(() => {})
  }, [])

  function exportCsv() {
    const head = ['timestamp', 'operatore', 'action', 'resource', 'metadata', 'success']
    const lines = [head.join(',')]
    logs.forEach((l) => {
      lines.push([l.timestamp, l.email || '', l.action, l.resource || '', (l.metadata || '').replace(/"/g, '""'), l.success].map((v) => `"${String(v)}"`).join(','))
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'registro_adesioni.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Registro</h1>
        <button className="btn btn-secondary" onClick={exportCsv} disabled={!logs.length}>Esporta CSV</button>
      </div>
      <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
        {logs.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--c-text-muted)' }}>Nessuna voce nel registro.</div>
        ) : (
          <table>
            <thead><tr><th>Data/ora</th><th>Operatore</th><th>Azione</th><th>Risorsa</th><th>Dettagli</th><th>Esito</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.timestamp).toLocaleString('it-IT')}</td>
                  <td style={{ fontSize: 12 }}>{l.email || '—'}</td>
                  <td>{l.action}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{l.resource || ''}</td>
                  <td style={{ fontSize: 11, color: 'var(--c-text-secondary)' }}>{l.metadata || ''}</td>
                  <td>{l.success ? '✓' : '✕'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
