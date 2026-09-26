'use client'
import { useCallback, useState, type ReactNode } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import { useConfirmPanel } from '@/components/ConfirmPanel'
import type { JobSnapshot, ReprofileMode } from './types'
import { downloadBlob, isActive } from './model'
import { RelaunchDialog, type RelaunchValues } from './RelaunchDialog'

export type BulkAction = 'extract' | 'proceed' | 'retry' | 'reuse' | 'cancel' | 'rematch' | 'reprofile' | 'test'

// TUTTE le chiamate della pagina del batch in un solo posto: riga, pannello
// di dettaglio, coda e barra collettiva usano le stesse funzioni. Per il batch
// virtuale delle estrazioni singole (nessun /batch/[id]/bulk) le azioni
// collettive sono una chiamata per job sulle route per-job.
export interface JobActions {
  busy: boolean
  bulkResult: string | null
  dialogOpen: boolean
  cancel: (j: JobSnapshot) => Promise<void>
  retry: (j: JobSnapshot) => Promise<void>
  extract: (j: JobSnapshot) => Promise<void>
  proceed: (j: JobSnapshot) => Promise<void>
  reuse: (j: JobSnapshot) => Promise<void>
  rematchWith: (j: JobSnapshot, profileId: string) => Promise<void>
  openRematch: (jobs: JobSnapshot[]) => void
  openReprofile: (jobs: JobSnapshot[]) => void
  openTest: (jobs: JobSnapshot[]) => void
  exportExcel: (j: JobSnapshot) => Promise<void>
  extractAll: (n: number) => Promise<void>
  rematchAll: (jobs: JobSnapshot[]) => void
  retryFailed: (n: number) => Promise<void>
  bulk: (action: BulkAction, jobs: JobSnapshot[]) => Promise<void>
  exportBatch: () => Promise<void>
  pdfsUrl: string | null
  dialog: ReactNode
  confirmPanel: ReactNode
}

export function useJobActions({ batchId, batchLabel, isSingles, reload }: { batchId: string; batchLabel: string; isSingles: boolean; reload: () => Promise<void> }): JobActions {
  const t = useT()
  const { ask, panel } = useConfirmPanel()
  const [busy, setBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)
  const [dial, setDial] = useState<{ mode: ReprofileMode; jobs: JobSnapshot[] } | null>(null)
  const [dialogError, setDialogError] = useState('')
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([])
  const [models, setModels] = useState<string[]>([])

  const post = (url: string, body?: unknown) => fetch(url, body === undefined
    ? { method: 'POST' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const jobPost = (j: JobSnapshot, path: string, body?: unknown) => post(`/api/polizza/job/${j.jobId}/${path}`, body)

  // Ogni azione: busy durante la chiamata, ricarica SEMPRE dopo (anche se fallisce).
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch { /* la ricarica mostra lo stato vero */ } finally { setBusy(false) }
    await reload()
  }, [reload])

  // Rifiuto del server con il suo PERCHÉ (409 code 'not-valid': fascicolo senza
  // polizza, non forzabile): prima la risposta si perdeva e il click sembrava
  // non fare nulla. Avviso nel pannellino, senza bloccare la ricarica.
  const showRefusal = async (res: Response) => {
    if (res.ok) return
    const d = await res.json().catch(() => ({}))
    if (d?.code === 'not-valid') void ask(d.error || t('jobsDash.notValidTitle'), { title: t('jobsDash.stNotValid'), okLabel: 'OK', hideCancel: true })
  }

  const cancel = (j: JobSnapshot) => run(async () => { await jobPost(j, 'cancel') })
  const retry = (j: JobSnapshot) => run(async () => { await jobPost(j, 'retry') })
  const extract = (j: JobSnapshot) => run(async () => { await showRefusal(await jobPost(j, 'extract')) })
  const proceed = (j: JobSnapshot) => run(async () => { await showRefusal(await jobPost(j, 'proceed')) })
  const reuse = (j: JobSnapshot) => run(async () => { await showRefusal(await jobPost(j, 'reuse')) })
  const rematchWith = (j: JobSnapshot, profileId: string) => run(async () => { await jobPost(j, 'rematch', { profileId }) })

  async function loadDialogData() {
    if (!profiles.length) {
      try {
        const s = await (await fetch('/api/settings')).json()
        setProfiles((s.polizzaProfiles || []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
      } catch { /* senza profili resta "campi del job" */ }
    }
    if (!models.length) {
      try { setModels(((await (await fetch('/api/polizza/models')).json())?.models) || []) } catch { /* free-text */ }
    }
  }
  function openDialog(mode: ReprofileMode, jobs: JobSnapshot[]) {
    if (!jobs.length) return
    setDialogError('')
    setDial({ mode, jobs })
    void loadDialogData()
  }
  // Riabbina: le righe in corso/in coda non si riabbinano.
  const openRematch = (jobs: JobSnapshot[]) => { const el = jobs.filter((j) => !isActive(j)); openDialog(el.length > 1 ? 'rematchBatch' : 'rematch', el) }
  const openReprofile = (jobs: JobSnapshot[]) => openDialog(jobs.length > 1 ? 'reprofileBatch' : 'reprofile', jobs)
  const openTest = (jobs: JobSnapshot[]) => openDialog('test', jobs)

  async function submitDialog(v: RelaunchValues) {
    if (!dial) return
    const { mode, jobs } = dial
    const isRematch = mode === 'rematch' || mode === 'rematchBatch'
    const isReprofile = mode === 'reprofile' || mode === 'reprofileBatch'
    if (isReprofile && !v.profileId) { setDialogError(t('jobsDash.reprofileRequired')); return }
    const body: Record<string, unknown> = {}
    if (v.profileId) body.profileId = v.profileId
    if (isRematch && v.extractAfter) body.extract = true
    if (isRematch && v.reconcile && !isSingles) body.reconcile = true
    if (!isRematch) {
      if (v.model.trim()) body.model = v.model.trim()
      if (v.strategy === 'perfield') body.perField = true
      else if (v.strategy === 'groups') { body.perField = false; body.stagedCascade = false }
      else if (v.strategy === 'cascade') { body.perField = false; body.stagedCascade = true }
      if (v.prompt !== (jobs[0]?.promptExtra || '')) body.promptExtra = v.prompt
    }
    const action = isRematch ? 'rematch' : mode === 'test' ? 'test' : 'reprofile'
    setBusy(true)
    try {
      let ok = true
      let errMsg = ''
      if (jobs.length > 1 && !isSingles) {
        const res = await post(`/api/polizza/batch/${batchId}/bulk`, { action, jobIds: jobs.map((j) => j.jobId), ...body })
        const d = await res.json().catch(() => ({}))
        ok = res.ok; errMsg = d.error || ''
        if (ok) setBulkResult(t('jobsDash.bulkResult', { ok: d.done || 0, skipped: d.skipped || 0 }))
      } else if (jobs.length > 1) {
        let n = 0, ko = 0
        for (const j of jobs) { const r = await jobPost(j, action, body); if (r.ok) n++; else ko++ }
        setBulkResult(t('jobsDash.bulkResult', { ok: n, skipped: ko }))
        ok = n > 0 || ko === 0
      } else {
        const res = await jobPost(jobs[0], action, body)
        ok = res.ok
        if (!ok) errMsg = (await res.json().catch(() => ({})))?.error || ''
      }
      if (!ok) { setDialogError(errMsg || 'Errore'); return }
      setDial(null)
    } finally {
      setBusy(false)
      await reload()
    }
  }

  async function bulk(action: BulkAction, jobs: JobSnapshot[]) {
    if (!jobs.length) return
    if (action === 'rematch') { openRematch(jobs); return }
    if (action === 'reprofile') { openReprofile(jobs); return }
    if (action === 'test') { openTest(jobs); return }
    setBulkResult(null)
    await run(async () => {
      // I NON VALIDI saltati si contano a parte, col perché: non si forzano.
      const withNotValid = (msg: string, n: number) => (n > 0 ? `${msg} · ${t('jobsDash.bulkResultNotValid', { n })}` : msg)
      if (!isSingles) {
        const res = await post(`/api/polizza/batch/${batchId}/bulk`, { action, jobIds: jobs.map((j) => j.jobId) })
        const d = await res.json().catch(() => ({}))
        setBulkResult(res.ok ? withNotValid(t('jobsDash.bulkResult', { ok: d.done || 0, skipped: d.skipped || 0 }), d.notValid || 0) : (d.error || 'Errore'))
      } else {
        let n = 0, ko = 0, nv = 0
        for (const j of jobs) {
          const r = await jobPost(j, action)
          if (r.ok) { n++; continue }
          const d = await r.json().catch(() => ({}))
          if (d?.code === 'not-valid') nv++; else ko++
        }
        setBulkResult(withNotValid(t('jobsDash.bulkResult', { ok: n, skipped: ko }), nv))
      }
    })
  }

  async function exportExcel(j: JobSnapshot) {
    // I campi del JOB: l'Excel segue il profilo con cui è stato estratto il dossier.
    const name = (j.dossierName || 'polizza').split('/').pop()
    const res = await fetch('/api/polizza/export-new', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: j.values || {}, fields: j.fieldDefs || [], suggestedName: name }),
    })
    if (res.ok) downloadBlob(await res.blob(), `${name}.xlsx`)
  }

  async function exportBatch() {
    if (isSingles) return
    const res = await fetch(`/api/polizza/batch/${batchId}/export`)
    if (res.ok) downloadBlob(await res.blob(), `${batchLabel.replace(/[^a-zA-Z0-9_-]/g, '_')}_risultati.xlsx`)
  }

  async function extractAll(n: number) {
    if (isSingles) return
    if (!(await ask(t('jobsDash.extractAllConfirm', { n }), { okLabel: t('jobsDash.extractAllOk'), title: t('jobsDash.extractAll', { n }) }))) return
    await run(async () => { await post(`/api/polizza/batch/${batchId}/extract-all`) })
  }

  const rematchAll = (jobs: JobSnapshot[]) => openRematch(jobs)

  async function retryFailed(n: number) {
    if (isSingles) return
    if (!(await ask(t('jobsDash.retryFailedAll', { n }), { okLabel: t('jobsDash.retry') }))) return
    await run(async () => { await post(`/api/polizza/batch/${batchId}/retry-failed`, {}) })
  }

  const dialog = dial ? (
    <RelaunchDialog mode={dial.mode} jobs={dial.jobs} profiles={profiles} models={models} busy={busy} error={dialogError}
      initialProfileId={dial.mode === 'reprofile' ? dial.jobs[0]?.profileId : ''} canReconcile={!isSingles} onCancel={() => setDial(null)} onSubmit={submitDialog} />
  ) : null

  return {
    busy, bulkResult, dialogOpen: !!dial,
    cancel, retry, extract, proceed, reuse, rematchWith, openRematch, openReprofile, openTest, exportExcel,
    extractAll, rematchAll, retryFailed, bulk, exportBatch,
    pdfsUrl: isSingles ? null : `/api/polizza/batch/${batchId}/pdfs`,
    dialog, confirmPanel: panel,
  }
}
