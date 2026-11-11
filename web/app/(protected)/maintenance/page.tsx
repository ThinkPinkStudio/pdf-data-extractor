'use client'

// Pannello "Manutenzione dati": vedere COSA occupa spazio e poterlo eliminare —
// job e batch da Postgres (PDF inclusi, con pulizia dei punti Qdrant collegati),
// cache OCR, e indice vettoriale (per fascicolo, per polizza o collezione intera).
// La SOVRASCRITTURA non serve come azione: «Rielabora» riusa gli stessi ID dei
// punti e li aggiorna (upsert deterministico) — qui si cancella, non si rifà.

import { useCallback, useEffect, useState } from 'react'
import { useConfirmPanel } from '@/components/ConfirmPanel'
import { useT } from '@/lib/i18n/I18nProvider'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Stats {
  pg: { batches: number; jobs: number; jobsRunning: number; files: number; filesMb: number; ocrEntries: number; ocrMb: number }
  qdrant: { enabled: boolean; exists?: boolean; points?: number; collection?: string; error?: string }
  batches: { id: string; label: string; email: string; total: number; running: number; createdAt?: number | string | null }[]
  jobs: { id: string; label: string; files: string[] }[]
}

export default function DataAdminPage() {
  const t = useT()
  const [stats, setStats] = useState<Stats | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [delJobId, setDelJobId] = useState('')
  const [batchFilter, setBatchFilter] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [qJobId, setQJobId] = useState('')
  const [qPolizza, setQPolizza] = useState('')
  const { ask: askConfirm, panel: confirmPanel } = useConfirmPanel()

  const load = useCallback(async () => {
    try { setStats(await (await fetch('/api/admin/maintenance')).json()) } catch { setStats(null) }
  }, [])
  useEffect(() => { load() }, [load])

  async function run(action: string, params: Record<string, string> = {}, confirmText?: string) {
    if (confirmText && !(await askConfirm(confirmText, { danger: true }))) return
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

  async function deleteSelected() {
    const ids = [...picked]
    if (!ids.length || !(await askConfirm(t('data.confirmBatches', { n: String(ids.length) }), { danger: true }))) return
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/maintenance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete-batches', batchIds: ids }),
      })
      const d = await res.json()
      if (res.ok) {
        const parts = [t('data.batchesDeleted', { n: String(d.deleted ?? 0), jobs: String(d.jobs ?? 0) })]
        if (d.skipped?.length) parts.push(t('data.batchesSkipped', { n: String(d.skipped.length) }))
        setMsg(`✓ ${parts.join(' ')}`)
        setPicked(new Set(d.skipped || []))
      } else setMsg(`✗ ${d.error || 'Errore'}`)
      await load()
    } catch (e) { setMsg(`✗ ${(e as Error).message}`) } finally { setBusy(false) }
  }

  const fq = batchFilter.trim().toLowerCase()
  const shownBatches = (stats?.batches || []).filter((b) => !fq || `${b.label} ${b.email}`.toLowerCase().includes(fq))
  const selectable = shownBatches.filter((b) => b.running === 0)

  const card: React.CSSProperties = { padding: 16, marginBottom: 16 }
  const row: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }

  return (
    <div style={{ maxWidth: 1100 }}>
      {confirmPanel}
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
              <input value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)} placeholder={t('data.batchFilter')}
                style={{ fontSize: 12, flex: '1 1 260px' }} />
              <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={busy || !selectable.length}
                onClick={() => setPicked(new Set(selectable.map((b) => b.id)))}>
                {t('data.selectFiltered', { n: String(selectable.length) })}
              </button>
              <button className="btn btn-secondary" style={{ fontSize: 12 }} disabled={busy || !picked.size}
                onClick={() => setPicked(new Set())}>
                {t('data.selectNone')}
              </button>
              <button className="btn btn-secondary" style={{ fontSize: 12, color: 'var(--c-error)' }} disabled={busy || !picked.size}
                onClick={deleteSelected}>
                🗑 {t('data.deleteSelected', { n: String(picked.size) })}
              </button>
            </div>
            <div style={{ marginTop: 8, maxHeight: 320, overflowY: 'auto', border: '1px solid var(--c-border)', borderRadius: 6 }}>
              {shownBatches.map((b) => {
                const active = b.running > 0
                return (
                  <label key={b.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 10px', fontSize: 12, borderBottom: '1px solid var(--c-border)', opacity: active ? 0.5 : 1, cursor: active ? 'not-allowed' : 'pointer' }}>
                    <input type="checkbox" disabled={active || busy} checked={picked.has(b.id)}
                      onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(b.id); else n.delete(b.id); return n })} />
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</span>
                    <span style={{ color: 'var(--c-text-muted)', whiteSpace: 'nowrap' }}>{b.email} · {b.total} polizze{b.createdAt ? ` · ${new Date(typeof b.createdAt === 'number' && b.createdAt < 1e12 ? b.createdAt * 1000 : b.createdAt).toLocaleDateString()}` : ''}{active ? ` · ${t('data.batchActive')}` : ''}</span>
                  </label>
                )
              })}
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
