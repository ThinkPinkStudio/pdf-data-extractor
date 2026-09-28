'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { BatchSummary, JobSnapshot } from '@/components/jobs/types'
import { SINGLES_ID } from '@/components/jobs/types'
import {
  BATCH_STATE_LABEL_KEY, BATCH_STATE_PILL, FILTER_LABEL_KEY, batchProcessed, batchStatus, countsFromBatch,
  batchWhen, decisionCount, fmtDate, segmentsFromCounts, summarizeJobs,
} from '@/components/jobs/model'
import { StackedBar } from '@/components/jobs/StackedBar'
import { StatusPill } from '@/components/jobs/StatusPill'
import { IcAlert, IcChevRight, IcDownload, IcPlay, IcRefresh, IcSearch, IcSwap, IcTrash, IcX, IcZip } from '@/components/jobs/Icons'
import { useConfirmPanel } from '@/components/ConfirmPanel'
import { ActionMenu } from '@/components/jobs/ActionMenu'
import { useCrossActions } from '@/components/jobs/useCrossActions'

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

  // SELEZIONE per le azioni in blocco: batch (card) e polizze (righe della ricerca).
  // Le polizze selezionate si ricordano con i loro dati anche se la ricerca cambia.
  const [selB, setSelB] = useState<Set<string>>(new Set())
  const [selJ, setSelJ] = useState<Set<string>>(new Set())
  const [hitMemo, setHitMemo] = useState<Map<string, SearchHit>>(new Map())
  useEffect(() => { if (hits?.length) setHitMemo((m) => { const n = new Map(m); for (const h of hits) n.set(h.jobId, h); return n }) }, [hits])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const { ask, panel } = useConfirmPanel()
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n }

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
  const singlesActive = !!singlesSummary && ((singlesSummary.queued || 0) + (singlesSummary.running || 0)) > 0
  const batchActive = (b: BatchSummary) => ((b.queued || 0) + (b.running || 0)) > 0
  const jobActive = (h: SearchHit) => h.status === 'queued' || h.status === 'running'
  const selectableB = shown
  const selectableJ = hits || []
  const nSel = selB.size + selJ.size
  const selBatches = (batches || []).filter((b) => selB.has(b.id))
  const selHits = [...selJ].map((id) => hitMemo.get(id)).filter((h): h is SearchHit => !!h)
  const X = useCrossActions({ batches: selBatches, hits: selHits, reload: load })
  const nActiveSel = selBatches.filter(batchActive).length + selHits.filter(jobActive).length
  // «1 batch, 3 polizze»: numeri e plurali giusti in barra, conferme e risultati.
  const nouns = (b: number, j: number) => [b ? (b === 1 ? t('jobsDash.nBatch1') : t('jobsDash.nBatchN', { n: b })) : '', j ? (j === 1 ? t('jobsDash.nJob1') : t('jobsDash.nJobN', { n: j })) : ''].filter(Boolean).join(', ')

  async function deleteSelected() {
    const b = [...selB], j = [...selJ]
    const what = nouns(b.length, j.length)
    // Nomi di ciò che si elimina (i primi 12): la ricerca trova anche polizze vere
    // («ATTESTATO» contiene «test»), meglio vederle prima di confermare.
    const names = [
      ...(batches || []).filter((x) => b.includes(x.id)).map((x) => `• ${x.label}`),
      ...(hits || []).filter((h) => j.includes(h.jobId)).map((h) => `• ${(h.dossierName || h.jobId).split('/').filter(Boolean).pop()}${h.batchLabel ? ` (${h.batchLabel})` : ''}`),
    ]
    const list = names.slice(0, 12).join('\n') + (names.length > 12 ? `\n… +${names.length - 12}` : '')
    const activeNote = nActiveSel ? `\n\n${t('jobsDash.selSkipActive', { n: nActiveSel })}` : ''
    if (!(await ask(`${t('jobsDash.selConfirm', { what })}\n\n${list}${activeNote}`, { danger: true, okLabel: t('jobsDash.selectDelete') }))) return
    setBusy(true); setMsg(null)
    const post = async (body: Record<string, unknown>) => {
      const res = await fetch('/api/admin/maintenance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
      return d
    }
    try {
      let db = 0, dj = 0
      const skipped: string[] = []
      if (b.length) { const d = await post({ action: 'delete-batches', batchIds: b }); db = d.deleted || 0; skipped.push(...(d.skipped || [])) }
      if (j.length) { const d = await post({ action: 'delete-jobs', jobIds: j }); dj = d.deleted || 0; skipped.push(...(d.skipped || [])) }
      setMsg(`${t('jobsDash.selDeleted', { what: nouns(db, dj) || '0' })}${skipped.length ? ` ${t('jobsDash.selSkipped', { n: skipped.length })}` : ''}`)
      setSelB(new Set(b.filter((id) => skipped.includes(id))))
      setSelJ(new Set(j.filter((id) => skipped.includes(id))))
      {
        // ricerca rifatta dopo ogni eliminazione: spariscono le polizze eliminate
        // (anche quelle dei batch) e compaiono le successive (60 per volta)
        const term = query.trim()
        const r = term.length >= 3 ? await fetch(`/api/polizza/search?q=${encodeURIComponent(term)}`).then((x) => (x.ok ? x.json() : null)).catch(() => null) : null
        if (term.length >= 3) setHits(r && Array.isArray(r.results) ? r.results : (prev) => (prev ? prev.filter((h) => !j.includes(h.jobId) || skipped.includes(h.jobId)) : prev))
      }
      await load()
    } catch (e) { setMsg(`✗ ${(e as Error).message}`) } finally { setBusy(false) }
  }

  return (
    <div>
      {panel}
      {X.confirmPanel}
      {X.dialog}
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

      {(nSel > 0 || msg || X.result) && (
        <div className="jb-selbar" role="toolbar" aria-label={t('jobsDash.bulkTitle', { n: nSel })}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', width: '100%' }}>
            {nSel > 0 && <b>{t('jobsDash.selLabel', { what: nouns(selB.size, selJ.size) })}</b>}
            {(msg || X.result) && <span role="status" style={{ color: (msg || '').startsWith('✗') ? 'var(--c-error)' : 'var(--c-text-secondary)' }}>{[msg, X.result].filter(Boolean).join(' · ')}</span>}
            <div style={{ flex: '1 1 0' }} />
            {selectableB.length > 0 && (
              <button type="button" className="jb-btn ghost" disabled={busy || X.busy} onClick={() => setSelB(new Set(selectableB.map((b) => b.id)))}>
                {t('jobsDash.selectShown', { n: selectableB.length })}
              </button>
            )}
            {selectableJ.length > 0 && (
              <button type="button" className="jb-btn ghost" disabled={busy || X.busy} onClick={() => setSelJ(new Set(selectableJ.map((h) => h.jobId)))}>
                {t('jobsDash.selectHits', { n: selectableJ.length })}
              </button>
            )}
            {nSel > 0 && <button type="button" className="jb-btn ghost" disabled={busy || X.busy} onClick={() => { setSelB(new Set()); setSelJ(new Set()) }}>{t('jobsDash.selectClear')}</button>}
            {nSel === 0 && <button type="button" className="jb-btn ghost icon" aria-label={t('jobsDash.close')} title={t('jobsDash.close')} onClick={() => { setMsg(null); X.clearResult() }}><IcX /></button>}
          </div>
          {nSel > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', width: '100%', paddingTop: 8, borderTop: '1px solid var(--c-border)' }}>
              {X.counts.extract > 0 && (
                <button type="button" className="jb-btn btn-primary" disabled={X.busy} title={t('jobsDash.extractTitle')} onClick={() => void X.run('extract')}>
                  <IcPlay />{t('jobsDash.extract')} ({X.counts.extract})
                </button>
              )}
              <button type="button" className="jb-btn btn-secondary" disabled={X.busy || !X.counts.rematchExtract} title={t('jobsDash.rematchExtractTitle')} onClick={() => void X.run('rematchExtract')}>
                <IcRefresh />{t('jobsDash.rematchExtractDots')} ({X.counts.rematchExtract})
              </button>
              <button type="button" className="jb-btn btn-secondary" disabled={X.busy || !X.counts.rematch} title={t('jobsDash.rematchTitle')} onClick={() => void X.run('rematch')}>
                <IcRefresh />{t('jobsDash.rematchDots')} ({X.counts.rematch})
              </button>
              {X.counts.proceed > 0 && (
                <button type="button" className="jb-btn btn-secondary tone-warn" disabled={X.busy} title={t('jobsDash.proceedTitle')} onClick={() => void X.run('proceed')}>
                  <IcPlay />{t('jobsDash.proceedAnyway')} ({X.counts.proceed})
                </button>
              )}
              {X.counts.retry > 0 && (
                <button type="button" className="jb-btn btn-secondary" disabled={X.busy} onClick={() => void X.run('retry')}>
                  <IcRefresh />{t('jobsDash.retry')} ({X.counts.retry})
                </button>
              )}
              <ActionMenu ariaLabel={t('jobsDash.moreActions')} items={[
                { id: 'reprofile', label: `${t('jobsDash.withProfile')} (${X.counts.reprofile})`, icon: <IcSwap />, onClick: () => void X.run('reprofile'), title: t('jobsDash.reprocessWithProfileTitle'), disabled: X.busy || !X.counts.reprofile },
                ...(X.counts.cancel > 0 ? [{ id: 'cancel', label: `${t('jobsDash.cancel')} (${X.counts.cancel})`, icon: <IcX />, onClick: () => void X.run('cancel'), danger: true, disabled: X.busy }] : []),
              ]} />
              {X.busy && <span className="spinner" aria-label="…" />}
              <div style={{ flex: '1 1 0' }} />
              <button type="button" className="jb-btn btn-secondary tone-danger" disabled={busy || X.busy} onClick={deleteSelected} title={t('jobsDash.selectDeleteTitle')}>
                {busy ? <span className="spinner" /> : <IcTrash />}{t('jobsDash.selectDelete')}
              </button>
            </div>
          )}
        </div>
      )}

      {hits !== null && <SearchResults hits={hits} selected={selJ} onToggle={(id) => setSelJ((p) => toggle(p, id))} isActive={jobActive} />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 16 }}>
        {/* Estrazioni singole (e run di test) IN CIMA quando hanno lavoro in corso o
            in coda: in fondo, dopo decine di batch, non si vedevano (25/09/2026). */}
        {showSingles && singlesSummary && singlesActive && (
          <BatchCard b={singlesSummary} href={`/polizza/jobs/${SINGLES_ID}`} subtitle={t('jobsDash.singlesCardDesc')} virtual />
        )}
        {shown.map((b) => <BatchCard key={b.id} b={b} href={`/polizza/jobs/${b.id}`} selected={selB.has(b.id)} active={batchActive(b)} onToggle={() => setSelB((p) => toggle(p, b.id))} />)}
        {showSingles && singlesSummary && !singlesActive && (
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
function SearchResults({ hits, selected, onToggle, isActive }: { hits: SearchHit[]; selected: Set<string>; onToggle: (id: string) => void; isActive: (h: SearchHit) => boolean }) {
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
          <div key={h.jobId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 0 0 14px', borderBottom: '1px solid var(--c-border)', background: selected.has(h.jobId) ? 'var(--c-accent-faint)' : undefined }}>
          <input type="checkbox" className="jb-check" style={{ margin: 0 }} checked={selected.has(h.jobId)}
            title={isActive(h) ? t('jobsDash.selectActive') : t('jobsDash.selectJob')} aria-label={t('jobsDash.selectJob')}
            onChange={() => onToggle(h.jobId)} />
          <Link href={href} style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, padding: '8px 14px 8px 0', color: 'inherit', textDecoration: 'none' }}>
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
          </div>
        )
      })}
    </div>
  )
}

function BatchCard({ b, href, subtitle, virtual, selected, active, onToggle }: { b: BatchSummary; href: string; subtitle?: string; virtual?: boolean; selected?: boolean; active?: boolean; onToggle?: () => void }) {
  const t = useT()
  const state = batchStatus(b)
  const counts = countsFromBatch(b)
  const segments = segmentsFromCounts(counts)
  const decisions = decisionCount(b)
  const processed = batchProcessed(b)
  // Data mostrata: l'ultimo lancio (chi e quando), non il caricamento, che resta nel tooltip.
  const when = batchWhen(Number(b.created_at) || 0, b.last_launch_at, b.last_launch_by, b.last_run_at)
  const uploaded = t('jobsDash.uploadedBy', { date: fmtDate(Number(b.created_at) || 0), by: b.email })
  const whenText = when.kind === 'launch'
    ? `${b.email} · ${when.by ? t('jobsDash.lastLaunchBy', { date: fmtDate(when.at), by: when.by }) : t('jobsDash.lastLaunch', { date: fmtDate(when.at) })}`
    : when.kind === 'run' ? `${b.email} · ${t('jobsDash.lastRun', { date: fmtDate(when.at) })}`
    : `${b.email} · ${fmtDate(when.at)}`
  return (
    <div className={`jb-card${decisions > 0 ? ' attention' : ''}${selected ? ' selected' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        {!virtual && onToggle && (
          <input type="checkbox" className="jb-check" checked={!!selected} onChange={onToggle}
            title={active ? t('jobsDash.selectActive') : t('jobsDash.selectBatch')} aria-label={t('jobsDash.selectBatch')} />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: '1 1 0' }}>
          <Link href={href} className="title">{b.label}</Link>
          <span title={subtitle ? undefined : uploaded} style={{ fontSize: 11, color: 'var(--c-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {subtitle || whenText}
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
          {segments.length === 0 && <span className="jb-leg jb-leg-wrap">{virtual ? t('jobsDash.singlesEmpty') : t('jobsDash.bQueued')}</span>}
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
