'use client'

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { DetailTab, FilterKey, JobSnapshot, ViewMode } from '@/components/jobs/types'
import { SINGLES_ID } from '@/components/jobs/types'
import {
  BATCH_STATE_LABEL_KEY, BATCH_STATE_PILL, FILTERS, batchStatus, countByFilter, filterOf, fmtDate,
  orderWithTests, shortName, summarizeJobs,
} from '@/components/jobs/model'
import { useJobActions } from '@/components/jobs/useJobActions'
import { KpiStrip } from '@/components/jobs/KpiStrip'
import { JobsTable } from '@/components/jobs/JobsTable'
import { JobsQueue } from '@/components/jobs/JobsQueue'
import { FolderSchema } from '@/components/jobs/FolderSchema'
import { JobDetail } from '@/components/jobs/JobDetail'
import { ActionMenu } from '@/components/jobs/ActionMenu'
import { IcChevDown, IcDownload, IcPlay, IcQueue, IcRefresh, IcSearch, IcTable, IcTree, IcZip } from '@/components/jobs/Icons'

const VIEW_KEY = 'jobsView'
const REASON_KEY = 'jobsReasonFull'
const isView = (v: string | null): v is ViewMode => v === 'tabella' || v === 'coda'
const isFilter = (v: string | null): v is FilterKey => !!v && (FILTERS as string[]).includes(v)

// PAGINA DEL BATCH (URL proprio): testata con le azioni di batch, striscia
// KPI = unico filtro, switch «Tabella | Coda» sotto. Lo stato (vista, filtro,
// polizza selezionata) sta nell'URL, così un link apre esattamente quella
// polizza; l'ultima vista scelta si ricorda per browser (localStorage).
export default function BatchJobsPage() {
  return (
    <Suspense fallback={<p style={{ fontSize: 13 }}><span className="spinner" /></p>}>
      <BatchView />
    </Suspense>
  )
}

function BatchView() {
  const t = useT()
  const params = useParams<{ id: string }>()
  const id = String(params?.id || '')
  const sp = useSearchParams()
  const isSingles = id === SINGLES_ID

  const [meta, setMeta] = useState<{ label: string; owner: string; createdAt: number } | null>(null)
  const [jobs, setJobs] = useState<JobSnapshot[] | null>(null)
  const [missing, setMissing] = useState(false)
  const [view, setViewState] = useState<ViewMode>('tabella')
  const [filter, setFilterState] = useState<FilterKey>(() => (isFilter(sp.get('stato')) ? (sp.get('stato') as FilterKey) : 'all'))
  const [selectedId, setSelectedId] = useState<string | null>(() => sp.get('polizza'))
  const [tab, setTab] = useState<DetailTab>('precheck')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [reasonFull, setReasonFullState] = useState(false)
  const [schemaOpen, setSchemaOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const ready = useRef(false)

  // Vista iniziale: URL, poi l'ultima scelta salvata, poi Tabella. In un
  // effetto (non in un initializer) per non divergere dal render server.
  useEffect(() => {
    const v = sp.get('vista')
    let vm: ViewMode = 'tabella'
    if (isView(v)) vm = v
    else { try { const saved = localStorage.getItem(VIEW_KEY); if (isView(saved)) vm = saved } catch { /* privato */ } }
    setViewState(vm)
    try { setReasonFullState(localStorage.getItem(REASON_KEY) === '1') } catch { /* privato */ }
    ready.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setView = (v: ViewMode) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* privato */ } }
  const setFilter = (k: FilterKey) => { setFilterState(k); setChecked(new Set()) }
  const setReasonFull = (v: boolean) => { setReasonFullState(v); try { localStorage.setItem(REASON_KEY, v ? '1' : '0') } catch { /* privato */ } }

  // Stato nell'URL (senza navigazione: replaceState).
  useEffect(() => {
    if (!ready.current) return
    // Si toccano SOLO i propri parametri: gli altri (se mai ce ne fossero) restano.
    const p = new URLSearchParams(window.location.search)
    p.delete('vista'); p.delete('stato'); p.delete('polizza')
    if (view !== 'tabella') p.set('vista', view)
    if (filter !== 'all') p.set('stato', filter)
    if (selectedId) p.set('polizza', selectedId)
    const qs = p.toString()
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, '', url)
  }, [view, filter, selectedId])

  const reload = useCallback(async () => {
    try {
      if (isSingles) {
        const d = await (await fetch('/api/polizza/job')).json()
        setJobs(d.jobs || [])
        setMeta({ label: t('jobsDash.singlesShort'), owner: '', createdAt: 0 })
      } else {
        const res = await fetch(`/api/polizza/batch/${id}`)
        if (res.status === 404) { setMissing(true); setJobs([]); return }
        const d = await res.json()
        setMeta({ label: d.label || '', owner: d.owner || '', createdAt: d.createdAt || 0 })
        setJobs(d.jobs || [])
      }
      setNow(Date.now())
    } catch { /* transitorio: il prossimo giro ricarica */ }
  }, [id, isSingles, t])

  useEffect(() => {
    reload()
    const iv = setInterval(reload, 4000)
    return () => clearInterval(iv)
  }, [reload])

  const label = meta?.label || ''
  const A = useJobActions({ batchId: id, batchLabel: label, isSingles, reload })

  const all = useMemo(() => jobs || [], [jobs])
  const counts = useMemo(() => countByFilter(all), [all])
  const summary = useMemo(() => summarizeJobs(all, id, label, meta?.owner || ''), [all, id, label, meta])
  const q = query.trim().toLowerCase()
  const visible = useMemo(() => orderWithTests(all).filter((j) =>
    (filter === 'all' || filterOf(j) === filter)
    && (!q || shortName(j, label).toLowerCase().includes(q) || (j.scannedFiles || []).some((f) => f.toLowerCase().includes(q)))
  ), [all, filter, q, label])
  const selected = selectedId ? all.find((j) => j.jobId === selectedId) || null : null
  const pos = selected ? visible.findIndex((j) => j.jobId === selected.jobId) : -1
  const position = pos >= 0 ? { i: pos + 1, n: visible.length } : null
  const goPrev = useCallback(() => { if (pos > 0) setSelectedId(visible[pos - 1].jobId) }, [pos, visible])
  const goNext = useCallback(() => { if (pos >= 0 && pos < visible.length - 1) setSelectedId(visible[pos + 1].jobId); else if (pos < 0 && visible.length) setSelectedId(visible[0].jobId) }, [pos, visible])

  // Coda: c'è sempre una polizza selezionata tra quelle visibili.
  useEffect(() => {
    if (view === 'coda' && jobs && pos < 0 && visible.length) setSelectedId(visible[0].jobId)
  }, [view, jobs, pos, visible])

  const openTab = (j: JobSnapshot, tb: DetailTab) => { setSelectedId(j.jobId); setTab(tb) }
  const state = batchStatus(summary)
  const lastUpdate = all.reduce((m, j) => Math.max(m, j.updatedAt || 0), 0)
  const minsAgo = lastUpdate ? Math.max(0, Math.floor((now / 1000 - lastUpdate) / 60)) : null

  if (missing) {
    return (
      <div>
        <p style={{ fontSize: 12, marginBottom: 12 }}><Link href="/polizza/jobs">← {t('jobsDash.backToBatches')}</Link></p>
        <div className="card" style={{ padding: 24, textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13 }}>{t('jobsDash.notFound')}</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: 'calc(100vh - 48px)', minHeight: 560 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
        <Link href="/polizza/jobs" style={{ color: 'var(--c-text-secondary)' }}>{t('jobsDash.backToBatches')}</Link>
        <span style={{ color: 'var(--c-text-muted)' }}>/</span>
        <span style={{ fontWeight: 600 }}>{label || '…'}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label || '…'}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--c-text-secondary)', flexWrap: 'wrap' }}>
            {jobs && all.length > 0 && <span className={`jb-pill ${BATCH_STATE_PILL[state]}`}>{t(BATCH_STATE_LABEL_KEY[state])}</span>}
            {meta?.owner && <span>{meta.owner}</span>}
            {!!meta?.createdAt && <span>· {t('jobsDash.startedAt', { date: fmtDate(meta.createdAt) })}</span>}
            {isSingles && <span>{t('jobsDash.singlesCardDesc')}</span>}
            {minsAgo != null && <span>· {t('jobsDash.lastUpdate', { n: minsAgo })}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {!isSingles && counts.matched > 0 && (
            <button type="button" className="jb-btn btn-primary" disabled={A.busy} title={t('jobsDash.extractTitle')} onClick={() => void A.extractAll(counts.matched)}>
              <IcPlay />{t('jobsDash.extractAll', { n: counts.matched }).replace(/^▶\s*/, '')}
            </button>
          )}
          {!isSingles && (
            <button type="button" className="jb-btn btn-secondary" disabled={A.busy || all.length === 0} title={t('jobsDash.rematchAllTitle')} onClick={() => A.rematchAll(all)}>
              <IcRefresh />{t('jobsDash.rematchAll').replace(/^🔁\s*/, '')}
            </button>
          )}
          {!isSingles && summary.error > 0 && (
            <button type="button" className="jb-btn btn-secondary" disabled={A.busy} onClick={() => void A.retryFailed(summary.error)}>
              <IcRefresh />{t('jobsDash.retryFailedAll', { n: summary.error })}
            </button>
          )}
          {!isSingles && (
            <ActionMenu ariaLabel={t('jobsDash.export')} className="btn-secondary" trigger={<><IcDownload />{t('jobsDash.export')}<IcChevDown /></>} items={[
              { id: 'excel', label: t('jobsDash.excelBatch'), icon: <IcDownload />, onClick: () => void A.exportBatch() },
              { id: 'zip', label: t('jobsDash.zipBatch'), icon: <IcZip />, onClick: () => { if (A.pdfsUrl) window.location.href = A.pdfsUrl }, title: t('jobsDash.downloadPdfsTitle') },
            ]} />
          )}
          <button type="button" className="jb-btn ghost" onClick={() => void reload()}>{t('jobsDash.refresh')}</button>
        </div>
      </div>

      <KpiStrip counts={counts} active={filter} onChange={setFilter} />

      <div className="card" style={{ padding: 0, flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderBottom: '1px solid var(--c-border)' }}>
          <label className="jb-search" style={{ width: 260 }}>
            <IcSearch />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('jobsDash.searchJobs')} aria-label={t('jobsDash.searchJobs')} />
          </label>
          <div className="jb-seg" role="group" aria-label={t('jobsDash.viewHint')} title={t('jobsDash.viewHint')}>
            <button type="button" className={view === 'tabella' ? 'active' : ''} aria-pressed={view === 'tabella'} onClick={() => setView('tabella')}><IcTable />{t('jobsDash.viewTable')}</button>
            <button type="button" className={view === 'coda' ? 'active' : ''} aria-pressed={view === 'coda'} onClick={() => setView('coda')}><IcQueue />{t('jobsDash.viewQueue')}</button>
          </div>
          {view === 'tabella' && (
            <button type="button" className={`jb-btn ghost${reasonFull ? ' active' : ''}`} aria-pressed={reasonFull} title={t('jobsDash.reasonExpandHint')} onClick={() => setReasonFull(!reasonFull)}>
              {t('jobsDash.reasonFull')}
            </button>
          )}
          <button type="button" className="jb-btn ghost" title={t('jobsDash.treeHint')} onClick={() => setSchemaOpen(true)}><IcTree />{t('jobsDash.schema')}</button>
          <div style={{ flex: '1 1 0' }} />
          <span style={{ fontSize: 11, color: 'var(--c-text-secondary)' }}>
            {jobs === null ? <span className="spinner" style={{ width: 12, height: 12 }} /> : checked.size > 0 ? t('jobsDash.selectedN', { n: checked.size }) : t('jobsDash.rowsN', { n: visible.length })}
          </span>
        </div>

        {view === 'tabella' ? (
          <div style={{ display: 'flex', flex: '1 1 0', minHeight: 0 }}>
            <JobsTable jobs={visible} allJobs={all} batchLabel={label} selectedId={selectedId} onSelect={(jid) => setSelectedId(jid === selectedId ? null : jid)}
              checked={checked} onChecked={setChecked} A={A} onOpenTab={openTab} reasonFull={reasonFull} />
            {selected && (
              <JobDetail variant="drawer" job={selected} batchLabel={label} position={position} onPrev={goPrev} onNext={goNext}
                onClose={() => setSelectedId(null)} tab={tab} onTab={setTab} A={A} />
            )}
          </div>
        ) : (
          <JobsQueue jobs={visible} batchLabel={label} selected={selected} position={position} onSelect={setSelectedId} onPrev={goPrev} onNext={goNext}
            A={A} tab={tab} onTab={setTab} checked={checked} onChecked={setChecked} />
        )}
      </div>

      {schemaOpen && <FolderSchema jobs={all} batchLabel={label} onClose={() => setSchemaOpen(false)} />}
      {A.dialog}
      {A.confirmPanel}
    </div>
  )
}
