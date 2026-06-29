'use client'

import { useEffect, useState } from 'react'

interface HistoryEntry {
  id: number
  timestamp: string
  email: string | null
  action: string
  resource: string | null
  success: number
}

export default function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/logs?limit=100')
      .then((r) => r.json())
      .then((d) => {
        setEntries(d.logs ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  return (
    <>
      <h1 className="page-title">Cronologia</h1>
      <p style={{ color: 'var(--c-text-muted)', marginBottom: 20, fontSize: 13 }}>
        Ultime azioni registrate (100 più recenti).
      </p>

      {loading ? (
        <span className="spinner" />
      ) : entries.length === 0 ? (
        <p style={{ color: 'var(--c-text-muted)' }}>Nessuna azione registrata.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Data/Ora</th>
                <th>Utente</th>
                <th>Azione</th>
                <th>Risorsa</th>
                <th>Esito</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    {new Date(e.timestamp).toLocaleString('it-IT')}
                  </td>
                  <td style={{ fontSize: 12 }}>{e.email ?? '—'}</td>
                  <td><code style={{ fontSize: 11 }}>{e.action}</code></td>
                  <td style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>{e.resource ?? '—'}</td>
                  <td>
                    <span style={{ color: e.success ? 'var(--c-success)' : 'var(--c-danger)', fontSize: 12 }}>
                      {e.success ? '✓' : '✗'}
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
