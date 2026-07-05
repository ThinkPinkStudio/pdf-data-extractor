'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'

interface BatchSummary {
  id: string
  label: string
  created_at: number
  total: number
  queued: number
  running: number
  done: number
  error: number
  canceled: number
}

interface ProfileCandidate {
  profileId?: string | null
  profileName?: string | null
  ramo?: string | null
  confidence: number
  motivo?: string
  source: 'path' | 'llm'
}

interface JobSnapshot {
  jobId: string
  dossierName: string | null
  status: string
  values: Record<string, string>
  error: string | null
  profileId: string | null
  profileCandidates: ProfileCandidate[]
  profileLocked: boolean
}

function fmtDate(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toLocaleString()
}

function batchStatus(b: BatchSummary): 'running' | 'error' | 'done' | 'queued' {
  if (b.running > 0 || (b.queued > 0 && b.done + b.error + b.canceled > 0)) return 'running'
  if (b.queued > 0 && b.done === 0 && b.error === 0) return 'queued'
  if (b.error > 0) return 'error'
  return 'done'
}

export default function PolizzaJobsPage() {
  const t = useT()
  const [batches, setBatches] = useState<BatchSummary[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<JobSnapshot[] | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([])
  const [rerunning, setRerunning] = useState<string | null>(null)

  const loadBatches = useCallback(async () => {
    try {
      const res = await fetch('/api/polizza/batch')
      const d = await res.json()
      setBatches(d.batches || [])
    } catch { setBatches([]) }
  }, [])

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => setProfiles((s.polizzaProfiles || []).map((p: any) => ({ id: p.id, name: p.name }))))
      .catch(() => setProfiles([]))
  }, [])

  // Cambio profilo + ri-estrazione dal testo già acquisito (o dai PDF salvati).
  async function rerunWithProfile(jobId: string, profileId: string) {
    if (!profileId) return
    setRerunning(jobId)
    try {
      const res = await fetch(`/api/polizza/job/${jobId}/rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      })
      if (!res.ok) throw new Error()
      if (openId) await toggleReload(openId)
    } catch { alert(t('jobsDash.rerunFailed')) } finally { setRerunning(null) }
  }

  async function toggleReload(id: string) {
    try {
      const res = await fetch(`/api/polizza/batch/${id}`)
      const d = await res.json()
      setDetail(d.jobs || [])
    } catch { /* mantiene la vista corrente */ }
  }

  useEffect(() => {
    loadBatches()
    const id = setInterval(loadBatches, 4000)
    return () => clearInterval(id)
  }, [loadBatches])

  async function toggleOpen(id: string) {
    if (openId === id) { setOpenId(null); setDetail(null); return }
    setOpenId(id); setDetail(null); setLoadingDetail(true)
    try {
      const res = await fetch(`/api/polizza/batch/${id}`)
      const d = await res.json()
      setDetail(d.jobs || [])
    } catch { setDetail([]) } finally { setLoadingDetail(false) }
  }

  const statusLabel = (s: string) => (
    s === 'running' ? t('jobsDash.statusRunning')
      : s === 'error' ? t('jobsDash.statusError')
        : s === 'queued' ? t('jobsDash.statusQueued')
          : t('jobsDash.statusDone')
  )
  const statusColor = (s: string) => (
    s === 'running' ? 'var(--c-info)' : s === 'error' ? 'var(--c-error)' : s === 'queued' ? 'var(--c-text-muted)' : 'var(--c-success)'
  )

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h1 className="page-title">{t('jobsDash.title')}</h1>
        <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={loadBatches}>{t('jobsDash.refresh')}</button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--c-text-muted)', marginBottom: 20 }}>{t('jobsDash.subtitle')}</p>

      {batches === null && <p style={{ fontSize: 13 }}><span className="spinner" /></p>}
      {batches !== null && batches.length === 0 && (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13 }}>
          {t('jobsDash.empty')}
        </div>
      )}

      {batches !== null && batches.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th style={{ padding: '10px 14px' }}>{t('jobsDash.colLabel')}</th>
                <th style={{ padding: '10px 14px' }}>{t('jobsDash.colStatus')}</th>
                <th style={{ padding: '10px 14px' }}>{t('jobsDash.colProgress')}</th>
                <th style={{ padding: '10px 14px' }}>{t('jobsDash.colDate')}</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const st = batchStatus(b)
                const isOpen = openId === b.id
                return (
                  <Fragment key={b.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => toggleOpen(b.id)}>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{b.label}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: statusColor(st), fontWeight: 600 }}>{statusLabel(st)}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12 }}>{t('jobsDash.progressCount', { done: b.done + b.error + b.canceled, total: b.total })}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--c-text-muted)' }}>{fmtDate(b.created_at)}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={4} style={{ padding: '0 14px 14px', background: 'var(--c-bg-card-alt)' }}>
                          {loadingDetail && <p style={{ fontSize: 12 }}><span className="spinner" /></p>}
                          {!loadingDetail && detail && (
                            <table style={{ marginTop: 8 }}>
                              <thead>
                                <tr>
                                  <th style={{ fontSize: 10 }}>{t('jobsDash.dossierName')}</th>
                                  <th style={{ fontSize: 10 }}>{t('jobsDash.dossierStatus')}</th>
                                  <th style={{ fontSize: 10 }}>{t('jobsDash.dossierProfile')}</th>
                                  <th style={{ fontSize: 10 }}>{t('jobsDash.dossierFields')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detail.map((j) => (
                                  <tr key={j.jobId}>
                                    <td style={{ fontSize: 12 }}>{j.dossierName || '—'}</td>
                                    <td style={{ fontSize: 12, color: statusColor(j.status === 'canceled' ? 'error' : j.status) }}>
                                      {statusLabel(j.status === 'canceled' ? 'error' : j.status)}
                                      {j.error ? ` — ${j.error}` : ''}
                                    </td>
                                    <td style={{ fontSize: 12 }}>
                                      <ProfileCell
                                        job={j}
                                        profiles={profiles}
                                        busy={rerunning === j.jobId}
                                        onRerun={(pid) => rerunWithProfile(j.jobId, pid)}
                                        t={t}
                                      />
                                    </td>
                                    <td style={{ fontSize: 12 }}>{Object.keys(j.values || {}).length}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Chip del profilo rilevato + cambio profilo con ri-estrazione. Il rilevamento
// sceglie solo tra i profili salvati: se per il ramo non ne esiste uno, mostra
// l'informazione e lascia i campi correnti.
function ProfileCell({ job, profiles, busy, onRerun, t }: {
  job: JobSnapshot
  profiles: { id: string; name: string }[]
  busy: boolean
  onRerun: (profileId: string) => void
  t: (k: string, v?: Record<string, string | number>) => string
}) {
  const [selected, setSelected] = useState('')
  const candidates = job.profileCandidates || []
  const top = candidates.find((c) => c.profileId) || null
  const current = job.profileId
    ? (profiles.find((p) => p.id === job.profileId)?.name
      || candidates.find((c) => c.profileId === job.profileId)?.profileName
      || job.profileId)
    : null
  const ramoOnly = !current && candidates.length > 0 ? candidates[0]?.ramo : null
  const conf = top && job.profileId === top.profileId ? Math.round(top.confidence * 100) : null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {current && (
        <span title={candidates.map((c) => `${c.profileName || c.ramo || '—'} ${Math.round(c.confidence * 100)}% (${c.source === 'path' ? t('jobsDash.profileFromPath') : t('jobsDash.profileFromLlm')})${c.motivo ? ` — ${c.motivo}` : ''}`).join('\n')}
          style={{ padding: '2px 8px', borderRadius: 10, background: 'var(--c-bg-card-alt)', border: '1px solid var(--c-border)', fontSize: 11, fontWeight: 600 }}>
          {current}{conf !== null ? ` · ${conf}%` : ''}{job.profileLocked ? ' 🔒' : ''}
        </span>
      )}
      {!current && ramoOnly && (
        <span style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{t('jobsDash.profileRamoOnly', { ramo: ramoOnly })}</span>
      )}
      {!current && !ramoOnly && <span style={{ color: 'var(--c-text-muted)' }}>—</span>}
      {profiles.length > 0 && (job.status === 'done' || job.status === 'error' || job.status === 'canceled') && (
        <>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ fontSize: 11, maxWidth: 140 }}>
            <option value="">{t('jobsDash.profileChange')}</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: '2px 8px' }}
            disabled={!selected || busy} onClick={() => onRerun(selected)}>
            {busy ? '…' : t('jobsDash.rerun')}
          </button>
        </>
      )}
    </div>
  )
}
