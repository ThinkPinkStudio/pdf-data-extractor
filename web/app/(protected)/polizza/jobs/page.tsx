'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { BatchSummary, JobSnapshot } from '@/components/jobs/types'
import { SINGLES_ID } from '@/components/jobs/types'
import {
  BATCH_STATE_LABEL_KEY, BATCH_STATE_PILL, FILTER_LABEL_KEY, batchProcessed, batchStatus, countsFromBatch,
  decisionCount, fmtDate, segmentsFromCounts, summarizeJobs,
} from '@/components/jobs/model'
import { StackedBar } from '@/components/jobs/StackedBar'
import { StatusPill } from '@/components/jobs/StatusPill'
import { IcAlert, IcChevRight, IcDownload, IcSearch, IcZip } from '@/components/jobs/Icons'

// ELABORAZIONI — lista dei batch: una card per batch (barra segmentata,
// contatori, «cosa aspetta te») + la card delle estrazioni singole, che è un
// batch virtuale e apre la STESSA pagina di dettaglio (/polizza/jobs/singole).
export default function PolizzaJobsPage() {
  const t = useT()
  const [batches, setBatches] = useState<BatchSummary[] | null>(null)
  const [singles, setSingles] = useState<JobSnapshot[] | null>(null)
  const [query, setQuery] = useState('')
  // RICERCA GLOBALE: dalla terza lettera cerca le polizze in TUTTI i batch
  // (cartella, file, n° polizza, contraente, P.IVA…), non solo i nomi dei batch.
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  useEffect(() => {
    const term = query.trim()
    if (term.length < 3) { setHits(null); return }
    let alive = true
    const id = setTimeout(() => {
      fetch(`/api/polizza/search?q=${encodeURIComponent(term)}`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => { if (alive) setHits(Array.isArray(d?.results) ? d.results : []) })
        .catch(() => { if (alive) setHits([]) })
    }, 250)
    return () => { alive = false; clearTimeout(id) }
  }, [query])

  const load = useCallback(async () => {
    try { const d = await (await fetch('/api/polizza/batch')).json(); setBatches(d.batches || []) } catch { setBatches((p) => p || []) }
    try { const d = await (await fetch('/api/polizza/job')).json(); setSingles(d.jobs || []) } catch { setSingles((p) => p || []) }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 4000)
    return () => clearInterval(id)
  }, [load])

  const q = query.trim().toLowerCase()
  const shown = (batches || []).filter((b) => !q || b.label.toLowerCase().includes(q) || (b.email || '').toLowerCase().includes(q))
  const singlesSummary = singles ? summarizeJobs(singles, SINGLES_ID, t('jobsDash.singlesShort')) : null
  const showSingles = singlesSummary && (!q || t('jobsDash.singlesShort').toLowerCase().includes(q))

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>{t('jobsDash.title')}</h1>
          <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: 0 }}>{t('jobsDash.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="jb-search" style={{ width: 340 }}>
            <IcSearch />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('jobsDash.searchBatches')} aria-label={t('jobsDash.searchBatches')} />
          </label>
          <button type="button" className="btn btn-secondary" style={{ fontSize: 12 }} onClick={load}>{t('jobsDash.refresh')}</button>
        </div>
      </div>

      {batches === null && <p style={{ fontSize: 13 }}><span className="spinner" /></p>}
      {batches !== null && batches.length === 0 && !(singles && singles.length) && (
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13, marginBottom: 16 }}>{t('jobsDash.empty')}</div>
      )}

      {hits !== null && <SearchResults hits={hits} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {shown.map((b) => <BatchCard key={b.id} b={b} href={`/polizza/jobs/${b.id}`} />)}
        {showSingles && singlesSummary && (
          <BatchCard b={singlesSummary} href={`/polizza/jobs/${SINGLES_ID}`} subtitle={t('jobsDash.singlesCardDesc')} virtual />
        )}
      </div>
    </div>
  )
}

interface SearchHit {
  jobId: string
  batchId: string | null
  batchLabel: string | null
  dossierName: string | null
  status: string
  error: string | null
  verdict: string | null
  profileName: string | null
  updatedAt: number
  matchedIn: { kind: 'folder' | 'file' | 'field'; label?: string; value: string }[]
}

// Polizze trovate dalla ricerca globale: cartella finale + percorso, batch,
// stato, profilo e DOVE è stata trovata la ricerca. Un clic apre la polizza
// nella pagina del suo batch (?polizza=…).
function SearchResults({ hits }: { hits: SearchHit[] }) {
  const t = useT()
  return (
    <div className="card" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--c-border)', fontSize: 12, fontWeight: 600 }}>
        {hits.length ? t('jobsDash.searchHits', { n: hits.length }) : t('jobsDash.searchNoHits')}
      </div>
      {hits.map((h) => {
        const segs = (h.dossierName || h.jobId).split('/').map((x) => x.trim()).filter(Boolean)
        const name = segs[segs.length - 1] || h.jobId
        const path = segs.slice(0, -1).join(' / ')
        const href = `/polizza/jobs/${h.batchId || SINGLES_ID}?polizza=${encodeURIComponent(h.jobId)}`
        const where = h.matchedIn.map((m) => m.kind === 'field' ? `${m.label}: ${m.value}` : m.kind === 'file' ? `${t('jobsDash.searchInFile')}: ${m.value}` : t('jobsDash.searchInFolder'))
        return (
          <Link key={h.jobId} href={href} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px', borderBottom: '1px solid var(--c-border)', color: 'inherit', textDecoration: 'none' }}>
            <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <span style={{ fontSize: 11, color: 'var(--c-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[h.batchLabel || t('jobsDash.singlesShort'), path].filter(Boolean).join(' / ')}
              </span>
              {where.length > 0 && <span style={{ fontSize: 11, color: 'var(--c-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{where.join(' · ')}</span>}
            </div>
            <span className="jb-pill neutral" style={{ flex: 'none' }}>{h.profileName || t('jobsDash.profileNone')}</span>
            <span style={{ flex: 'none' }}><StatusPill job={{ jobId: h.jobId, dossierName: h.dossierName, status: h.status, error: h.error, values: {}, precheck: h.verdict ? { verdict: h.verdict } : null }} /></span>
            <span style={{ flex: 'none', fontSize: 11, color: 'var(--c-text-muted)', width: 120, textAlign: 'right' }}>{fmtDate(h.updatedAt)}</span>
            <IcChevRight />
          </Link>
        )
      })}
    </div>
  )
}

function BatchCard({ b, href, subtitle, virtual }: { b: BatchSummary; href: string; subtitle?: string; virtual?: boolean }) {
  const t = useT()
  const state = batchStatus(b)
  const counts = countsFromBatch(b)
  const segments = segmentsFromCounts(counts)
  const decisions = decisionCount(b)
  const processed = batchProcessed(b)
  return (
    <div className={`jb-card${decisions > 0 ? ' attention' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <Link href={href} className="title">{b.label}</Link>
          <span style={{ fontSize: 11, color: 'var(--c-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subtitle || `${b.email} · ${fmtDate(b.created_at)}`}
          </span>
        </div>
        {b.total > 0 && <span className={`jb-pill ${BATCH_STATE_PILL[state]}`} style={{ flex: 'none' }}>{t(BATCH_STATE_LABEL_KEY[state])}</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
          <span style={{ color: 'var(--c-text-secondary)' }}>{t('jobsDash.progressLabel')}</span>
          <b>{t('jobsDash.doneOf', { done: processed, total: b.total })}</b>
        </div>
        <StackedBar segments={segments} height={10} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px' }}>
          {segments.map((s) => (
            <span key={s.key} className="jb-leg"><span className="jb-dot" style={{ background: s.color, opacity: s.opacity ?? 1 }} />{t(FILTER_LABEL_KEY[s.key])} <b>{s.n}</b></span>
          ))}
          {segments.length === 0 && <span className="jb-leg">{virtual ? t('jobsDash.singlesEmpty') : t('jobsDash.bQueued')}</span>}
        </div>
      </div>
      {decisions > 0 ? (
        <div className="jb-callout">
          <span className="jb-c-warn" style={{ display: 'inline-flex' }}><IcAlert /></span>
          <span style={{ flex: '1 1 0' }}>
            <b>{decisions === 1 ? t('jobsDash.pending1') : t('jobsDash.pendingN', { n: decisions })}</b>
            {(b.matched || 0) > 0 ? ` · ${t('jobsDash.matchedToStart', { n: b.matched })}` : ''}
          </span>
          <Link href={href} className="jb-btn btn-primary">{t('jobsDash.openBatch')}<IcChevRight /></Link>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
          <span className="jb-leg">{state === 'running' || state === 'queued' ? '' : t('jobsDash.nothingPending')}</span>
          <div style={{ flex: '1 1 0' }} />
          {!virtual && (b.done || 0) > 0 && (
            <a className="jb-btn btn-secondary" href={`/api/polizza/batch/${b.id}/export`} download title={t('jobsDash.excelBatch')}><IcDownload />Excel</a>
          )}
          {!virtual && b.total > 0 && (
            <a className="jb-btn btn-secondary" href={`/api/polizza/batch/${b.id}/pdfs`} download title={t('jobsDash.downloadPdfsTitle')}><IcZip />ZIP</a>
          )}
          <Link href={href} className="jb-btn btn-secondary">{t('jobsDash.open')}<IcChevRight /></Link>
        </div>
      )}
    </div>
  )
}
