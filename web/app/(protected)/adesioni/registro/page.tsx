'use client'

import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

interface Log { id: number; timestamp: string; email: string | null; action: string; resource: string | null; metadata: string | null; success: boolean }

export default function AdesioniRegistroPage() {
  const t = useT()
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 className="page-title" style={{ margin: 0 }}>{t('nav.adRegistro')}</h1>
          <p className="view-subtitle" style={{ margin: '4px 0 0' }}>{t('ad.registro.subtitle')}</p>
        </div>
        <button className="btn btn-secondary" onClick={exportCsv} disabled={!logs.length}>{t('batch.exportCsv')}</button>
      </div>
      <div className="card" style={{ overflowX: 'auto', padding: 0 }}>
        {logs.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--c-text-muted)' }}>{t('ad.registro.empty')}</div>
        ) : (
          <table>
            <thead><tr><th>{t('ad.registro.colDate')}</th><th>{t('ad.registro.colOperator')}</th><th>{t('ad.registro.colAction')}</th><th>{t('ad.registro.colResource')}</th><th>{t('ad.registro.colDetails')}</th><th>{t('ad.registro.colResult')}</th></tr></thead>
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
