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
import { IcAlert, IcChevRight, IcDownload, IcSearch, IcZip } from '@/components/jobs/Icons'

// ELABORAZIONI — lista dei batch: una card per batch (barra segmentata,
// contatori, «cosa aspetta te») + la card delle estrazioni singole, che è un
// batch virtuale e apre la STESSA pagina di dettaglio (/polizza/jobs/singole).
export default function PolizzaJobsPage() {
  const t = useT()
  const [batches, setBatches] = useState<BatchSummary[] | null>(null)
  const [singles, setSingles] = useState<JobSnapshot[] | null>(null)
  const [query, setQuery] = useState('')

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
    <div style={{ maxWidth: 1400 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>{t('jobsDash.title')}</h1>
          <p style={{ fontSize: 12, color: 'var(--c-text-muted)', margin: 0 }}>{t('jobsDash.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="jb-search" style={{ width: 240 }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {shown.map((b) => <BatchCard key={b.id} b={b} href={`/polizza/jobs/${b.id}`} />)}
        {showSingles && singlesSummary && (
          <BatchCard b={singlesSummary} href={`/polizza/jobs/${SINGLES_ID}`} subtitle={t('jobsDash.singlesCardDesc')} virtual />
        )}
      </div>
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
