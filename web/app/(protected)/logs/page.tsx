'use client'

import { useEffect, useState } from 'react'

interface LogEntry {
  id: number
  timestamp: string
  email: string | null
  action: string
  resource: string | null
  metadata: string | null
  ip: string | null
  success: number
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/logs?limit=200')
      .then((r) => {
        if (r.status === 403) throw new Error('Accesso riservato agli amministratori.')
        if (!r.ok) throw new Error('Errore caricamento log.')
        return r.json()
      })
      .then((d) => { setLogs(d.logs ?? []); setLoading(false) })
      .catch((err) => { setError(err.message); setLoading(false) })
  }, [])

  return (
    <>
      <h1 className="page-title">Log Azioni</h1>

      {loading && <span className="spinner" />}
      {error && <div className="alert alert-error">{error}</div>}
      {!loading && !error && logs.length === 0 && (
        <p style={{ color: 'var(--c-text-muted)' }}>Nessun log disponibile.</p>
      )}

      {logs.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ minWidth: 800 }}>
            <thead>
              <tr>
                <th>Data/Ora</th>
                <th>Utente</th>
                <th>Azione</th>
                <th>Risorsa</th>
                <th>IP</th>
                <th>Dati</th>
                <th>Esito</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 11 }}>
                    {new Date(l.timestamp).toLocaleString('it-IT')}
                  </td>
                  <td style={{ fontSize: 12 }}>{l.email ?? '—'}</td>
                  <td><code style={{ fontSize: 11 }}>{l.action}</code></td>
                  <td style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{l.resource ?? '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{l.ip ?? '—'}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--c-text-muted)' }}>
                    {l.metadata ?? '—'}
                  </td>
                  <td>
                    <span style={{ color: l.success ? 'var(--c-success)' : 'var(--c-danger)', fontSize: 12 }}>
                      {l.success ? '✓' : '✗'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
