'use client'

// Pannello "Manutenzione dati": vedere COSA occupa spazio e poterlo eliminare —
// job e batch da Postgres (PDF inclusi, con pulizia dei punti Qdrant collegati),
// cache OCR, e indice vettoriale (per fascicolo, per polizza o collezione intera).
// La SOVRASCRITTURA non serve come azione: «Rielabora» riusa gli stessi ID dei
// punti e li aggiorna (upsert deterministico) — qui si cancella, non si rifà.

import { useCallback, useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Stats {
  pg: { batches: number; jobs: number; jobsRunning: number; files: number; filesMb: number; ocrEntries: number; ocrMb: number }
  qdrant: { enabled: boolean; exists?: boolean; points?: number; collection?: string; error?: string }
  batches: { id: string; label: string; email: string; total: number; running: number }[]
  jobs: { id: string; label: string; files: string[] }[]
}

export default function DataAdminPage() {
  const t = useT()
  const [stats, setStats] = useState<Stats | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [delJobId, setDelJobId] = useState('')
  const [delBatchId, setDelBatchId] = useState('')
  const [qJobId, setQJobId] = useState('')
  const [qPolizza, setQPolizza] = useState('')

  const load = useCallback(async () => {
    try { setStats(await (await fetch('/api/admin/maintenance')).json()) } catch { setStats(null) }
  }, [])
  useEffect(() => { load() }, [load])

  async function run(action: string, params: Record<string, string> = {}, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...params }),
      })
      const d = await res.json()
      setMsg(res.ok ? `✓ ${t('data.done')}` : `✗ ${d.error || 'Errore'}`)
      await load()
    } catch (e) { setMsg(`✗ ${(e as Error).message}`) } finally { setBusy(false) }
  }

  const card: React.CSSProperties = { padding: 16, marginBottom: 16 }
  const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }

  return (
    <div style={{ maxWidth: 1100 }}>
      <h1 className="page-title">{t('data.title')}</h1>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 8 }}>{t('data.subtitle')}</p>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 16 }}>{t('data.overwriteNote')}</p>
      {msg && <div className="card" style={{ padding: 10, marginBottom: 12, fontSize: 13, color: msg.startsWith('✓') ? 'var(--c-success)' : 'var(--c-error)' }}>{msg}</div>}
      {!stats && <p><span className="spinner" /></p>}
      {stats && (
        <>
          {/* ── Database (Postgres) ── */}
          <div className="card" style={card}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t('data.pgTitle')}</h2>
            <p style={{ fontSize: 12.5 }}>
              {t('data.pgStats', {
                batches: String(stats.pg.batches), jobs: String(stats.pg.jobs),
                files: String(stats.pg.files), mb: String(stats.pg.filesMb),
              })}
              {stats.pg.jobsRunning > 0 && <strong> · {t('data.pgRunning', { n: String(stats.pg.jobsRunning) })}</strong>}
            </p>
            <div style={row}>
              <select value={delBatchId} onChange={(e) => setDelBatchId(e.target.value)} style={{ fontSize: 12, flex: '1 1 300px' }}>
                <option value="">{t('data.pickBatch')}</option>
                {stats.batches.map((b) => (
                  <option key={b.id} value={b.id} disabled={b.running > 0}>
                    {b.label} · {b.email} · {b.total} polizze{b.running > 0 ? ` (${b.running} attivi)` : ''}
                  </option>
                ))}
              </select>
              <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={busy || !delBatchId}
                onClick={() => run('delete-batch', { batchId: delBatchId }, t('data.confirmBatch'))}>
                🗑 {t('data.deleteBatch')}
              </button>
            </div>
            <div style={row}>
              <select value={delJobId} onChange={(e) => setDelJobId(e.target.value)} style={{ fontSize: 12, flex: '1 1 300px' }}>
                <option value="">{t('data.pickJob')}</option>
                {stats.jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
              </select>
              <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={busy || !delJobId}
                onClick={() => run('delete-job', { jobId: delJobId }, t('data.confirmJob'))}>
                🗑 {t('data.deleteJob')}
              </button>
            </div>
          </div>

          {/* ── Cache OCR ── */}
          <div className="card" style={card}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t('data.ocrTitle')}</h2>
            <p style={{ fontSize: 12.5 }}>{t('data.ocrStats', { n: String(stats.pg.ocrEntries), mb: String(stats.pg.ocrMb) })}</p>
            <div style={row}>
              <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={busy || !stats.pg.ocrEntries}
                onClick={() => run('clear-ocr-cache', {}, t('data.confirmOcr'))}>
                🗑 {t('data.clearOcr')}
              </button>
            </div>
          </div>

          {/* ── Indice vettoriale (Qdrant) ── */}
          <div className="card" style={card}>
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{t('data.qdrantTitle')}</h2>
            {!stats.qdrant.enabled && <p style={{ fontSize: 12.5, color: 'var(--c-text-muted)' }}>{t('data.qdrantOff')}</p>}
            {stats.qdrant.enabled && stats.qdrant.error && <p style={{ fontSize: 12.5, color: 'var(--c-warning, #e6a23c)' }}>⚠ {stats.qdrant.error}</p>}
            {stats.qdrant.enabled && !stats.qdrant.error && (
              <>
                <p style={{ fontSize: 12.5 }}>
                  {stats.qdrant.exists
                    ? t('data.qdrantStats', { collection: stats.qdrant.collection || '', points: String(stats.qdrant.points ?? 0) })
                    : t('data.qdrantEmpty')}
                </p>
                <div style={row}>
                  <select value={qJobId} onChange={(e) => setQJobId(e.target.value)} style={{ fontSize: 12, flex: '1 1 280px' }}>
                    <option value="">{t('data.pickJob')}</option>
                    {stats.jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
                  </select>
                  <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={busy || !qJobId}
                    onClick={() => run('qdrant-delete', { jobId: qJobId }, t('data.confirmQdrantScope'))}>
                    🗑 {t('data.qdrantDeleteJob')}
                  </button>
                </div>
                <div style={row}>
                  <input value={qPolizza} onChange={(e) => setQPolizza(e.target.value)} placeholder={t('chat.polizzaPlaceholder')}
                    style={{ fontSize: 12, flex: '0 1 220px', fontFamily: 'var(--font-mono)' }} />
                  <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={busy || !qPolizza.trim()}
                    onClick={() => run('qdrant-delete', { polizzaNumero: qPolizza.trim() }, t('data.confirmQdrantScope'))}>
                    🗑 {t('data.qdrantDeletePolizza')}
                  </button>
                </div>
                <div style={row}>
                  <button className="btn btn-secondary" style={{ fontSize: 12, color: 'var(--c-error)' }} disabled={busy}
                    onClick={() => run('qdrant-drop', {}, t('data.confirmQdrantDrop'))}>
                    ⚠ {t('data.qdrantDrop')}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
