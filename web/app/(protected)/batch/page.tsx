'use client'

import { useEffect, useState, useCallback } from 'react'

interface RunRow {
  id: number
  status: string
  total_items: number
  done_items: number
  error_items: number
  created_at: string
  started_at: string | null
  finished_at: string | null
  paused_until: string | null
}
interface Progress {
  docIndex: number
  docTotal: number
  pageIndex: number
  pageTotal: number
  docName: string
  totalPagesProcessed: number
}
interface Detail {
  run: RunRow | null
  counts: Record<string, number>
  current: { id: number; folder_path: string; progress: Progress | null } | null
  errors: Array<{ folder_path: string; last_error: string | null; attempts: number }>
  etaMs: number | null
}

const STATUS_COLOR: Record<string, string> = {
  running: 'var(--c-accent)',
  queued: 'var(--c-text-muted)',
  paused: '#d08700',
  done: 'var(--c-success)',
  cancelled: 'var(--c-text-muted)',
  error: 'var(--c-danger)',
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
const baseName = (p: string) => p.split('/').filter(Boolean).pop() || p
function fmtEta(ms: number | null): string {
  if (!ms || ms <= 0) return '—'
  const s = Math.round(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `~${h}h ${m}m`
  if (m > 0) return `~${m}m`
  return `~${s}s`
}

function Bar({ value, color }: { value: number; color?: string }) {
  return (
    <div style={{ height: 8, background: 'var(--c-surface-2)', borderRadius: 4, overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${value}%`, background: color || 'var(--c-accent)', transition: 'width .3s' }} />
    </div>
  )
}
function Badge({ status }: { status: string }) {
  return <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[status] || 'var(--c-text-muted)' }}>{status}</span>
}

export default function BatchPage() {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async (selId: number | null) => {
    try {
      const r = await fetch('/api/batch/runs', { cache: 'no-store' })
      if (r.ok) {
        const d = await r.json()
        const list: RunRow[] = d.runs ?? []
        setRuns(list)
        if (selId == null && list.length) {
          const running = list.find((x) => x.status === 'running')
          setSelected((running ?? list[0]).id)
        }
      }
      if (selId != null) {
        const rd = await fetch(`/api/batch/runs/${selId}`, { cache: 'no-store' })
        if (rd.ok) setDetail(await rd.json())
      }
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    let active = true
    const tick = () => { if (active) refresh(selected) }
    tick()
    const t = setInterval(tick, 2000)
    return () => { active = false; clearInterval(t) }
  }, [selected, refresh])

  const r = detail?.run ?? null
  const c = detail?.counts ?? {}
  const total = r?.total_items || (c.pending || 0) + (c.processing || 0) + (c.done || 0) + (c.error || 0)
  const done = c.done || 0
  const prog = detail?.current?.progress ?? null

  return (
    <>
      <h1 className="page-title">Batch — Stato elaborazione</h1>

      {ready && runs.length === 0 && (
        <div className="card" style={{ color: 'var(--c-text-muted)' }}>
          Nessun batch in coda. Avvia una discovery con il worker: <code>npm run scan</code>.
        </div>
      )}

      {runs.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'auto', marginBottom: 16 }}>
          <table style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th>Run</th>
                <th>Stato</th>
                <th>Avanzamento</th>
                <th>Errori</th>
                <th>Avvio</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const t = run.total_items || run.done_items + run.error_items
                return (
                  <tr
                    key={run.id}
                    onClick={() => setSelected(run.id)}
                    style={{ cursor: 'pointer', background: run.id === selected ? 'var(--c-surface-2)' : undefined }}
                  >
                    <td>#{run.id}</td>
                    <td><Badge status={run.status} /></td>
                    <td style={{ minWidth: 170 }}>
                      <div style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 3 }}>
                        {run.done_items}/{t || '—'} ({pct(run.done_items, t)}%)
                      </div>
                      <Bar value={pct(run.done_items, t)} />
                    </td>
                    <td style={{ color: run.error_items ? 'var(--c-danger)' : 'var(--c-text-muted)' }}>{run.error_items}</td>
                    <td style={{ fontSize: 11, color: 'var(--c-text-muted)', whiteSpace: 'nowrap' }}>
                      {run.started_at ? new Date(Number(run.started_at)).toLocaleString('it-IT') : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {r && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600 }}>Run #{r.id} · <Badge status={r.status} /></h2>
            <div style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>ETA {fmtEta(detail?.etaMs ?? null)}</div>
          </div>

          {/* MACRO — polizze X / N */}
          <div style={{ marginBottom: 6, fontSize: 13 }}>
            <strong>{done}</strong> / {total || '—'} polizze ·{' '}
            <span style={{ color: 'var(--c-danger)' }}>{c.error || 0} errori</span> ·{' '}
            {c.pending || 0} in coda · {c.processing || 0} in corso
          </div>
          <Bar value={pct(done, total)} />

          {/* MICRO — la barra blu: file/pagina della polizza in corso */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 4 }}>Polizza in corso</div>
            {detail?.current && prog ? (
              <>
                <div style={{ fontSize: 13, marginBottom: 4 }}>
                  {baseName(detail.current.folder_path)} · file {prog.docIndex + 1}/{prog.docTotal} · pag {prog.pageIndex}/{prog.pageTotal}{' '}
                  <span style={{ color: 'var(--c-text-muted)' }}>({prog.docName})</span>
                </div>
                <Bar value={pct(prog.pageIndex, prog.pageTotal)} />
              </>
            ) : detail?.current ? (
              <div style={{ fontSize: 13 }}>
                {baseName(detail.current.folder_path)} <span style={{ color: 'var(--c-text-muted)' }}>· avvio…</span>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>
                {r.status === 'running' ? 'in attesa…' : r.status === 'paused' ? 'in pausa (provider non raggiungibile)' : '—'}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <a className="btn btn-secondary" href={`/api/batch/runs/${r.id}/report?type=manifest`}>Scarica manifest</a>
            {(c.error || 0) > 0 && (
              <a className="btn btn-secondary" href={`/api/batch/runs/${r.id}/report?type=errors`}>Scarica errori</a>
            )}
          </div>
        </div>
      )}

      {detail && detail.errors.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'auto' }}>
          <table style={{ minWidth: 560 }}>
            <thead>
              <tr>
                <th>Cartella</th>
                <th>Tent.</th>
                <th>Errore</th>
              </tr>
            </thead>
            <tbody>
              {detail.errors.map((e, i) => (
                <tr key={i}>
                  <td style={{ fontSize: 12 }}>{e.folder_path}</td>
                  <td style={{ fontSize: 12 }}>{e.attempts}</td>
                  <td
                    style={{ fontSize: 11, color: 'var(--c-danger)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={e.last_error || ''}
                  >
                    {e.last_error || '—'}
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
