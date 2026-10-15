'use client'
import { useState, type ReactNode } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import { useConfirmPanel } from '@/components/ConfirmPanel'
import type { BatchSummary, JobSnapshot, ReprofileMode } from './types'
import { isActive, uiState } from './model'
import { RelaunchDialog, type RelaunchValues } from './RelaunchDialog'

// AZIONI SU UNA SELEZIONE MISTA della pagina Elaborazioni: batch interi (card)
// e polizze sparse (righe della ricerca, anche estrazioni singole). Stesse
// regole della barra collettiva dentro un batch (JobsTable/useJobActions):
// Estrai = abbinate, Procedi comunque = da decidere (mai le NON VALIDE),
// Riprova = errori, Annulla = in corso, Riabbina / Con profilo = tutte le non
// attive. Le chiamate sono le stesse route: /batch/[id]/bulk per batch,
// /job/[id]/<azione> per le estrazioni singole.

export type CrossAction = 'extract' | 'proceed' | 'retry' | 'cancel' | 'rematch' | 'rematchExtract' | 'reprofile'

/** Riga della ricerca globale selezionata. */
export interface SelHit { jobId: string; batchId: string | null; batchLabel: string | null; dossierName: string | null; status: string; error: string | null }

const notValidErr = (e: string | null | undefined) => /^Non valido\b/.test(String(e || ''))

// Idoneità di un job (snapshot completo, dai batch) per un'azione.
function eligible(a: CrossAction, j: JobSnapshot): boolean {
  const st = uiState(j)
  switch (a) {
    case 'extract': return st === 'matched'
    case 'proceed': return st === 'review' || st === 'mismatch' || st === 'discarded'
    case 'retry': return st === 'error'
    case 'cancel': return isActive(j)
    default: return !isActive(j)
  }
}
// Stessa regola per una riga della ricerca (ha solo stato ed errore).
function eligibleHit(a: CrossAction, h: SelHit): boolean {
  const active = h.status === 'queued' || h.status === 'running'
  switch (a) {
    case 'extract': return h.status === 'matched'
    case 'proceed': return h.status === 'review' || (h.status === 'mismatch' && !notValidErr(h.error))
    case 'retry': return !['done', 'matched', 'review', 'mismatch', 'canceled', 'queued', 'running'].includes(h.status)
    case 'cancel': return active
    default: return !active
  }
}
// Conteggio dal RIEPILOGO del batch (senza caricarne i job).
function eligibleInBatch(a: CrossAction, b: BatchSummary): number {
  const active = (b.queued || 0) + (b.running || 0)
  switch (a) {
    case 'extract': return b.matched || 0
    case 'proceed': return (b.review || 0) + Math.max(0, (b.mismatch || 0) - (b.notValid || 0))
    case 'retry': return b.error || 0
    case 'cancel': return active
    default: return Math.max(0, (b.total || 0) - active)
  }
}

export interface CrossActions {
  counts: Record<CrossAction, number>
  busy: boolean
  result: string | null
  clearResult: () => void
  run: (a: CrossAction) => Promise<void>
  dialog: ReactNode
  confirmPanel: ReactNode
}

export function useCrossActions({ batches, hits, reload }: { batches: BatchSummary[]; hits: SelHit[]; reload: () => Promise<void> }): CrossActions {
  const t = useT()
  const { ask, panel } = useConfirmPanel()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [dial, setDial] = useState<{ mode: ReprofileMode; action: CrossAction; jobs: JobSnapshot[] } | null>(null)
  const [dialogError, setDialogError] = useState('')
  // Gruppi del dialogo aperto (risolti all'apertura, usati alla conferma).
  const [dialGroups, setDialGroups] = useState<Map<string | null, JobSnapshot[]> | null>(null)
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([])
  const [models, setModels] = useState<string[]>([])

  // Una polizza selezionata nella ricerca che sta anche in un batch selezionato
  // conta una volta sola (vince il batch).
  const selBatchIds = new Set(batches.map((b) => b.id))
  const looseHits = hits.filter((h) => !h.batchId || !selBatchIds.has(h.batchId))
  const ACTIONS: CrossAction[] = ['extract', 'proceed', 'retry', 'cancel', 'rematch', 'rematchExtract', 'reprofile']
  const counts = Object.fromEntries(ACTIONS.map((a) => [a,
    batches.reduce((n, b) => n + eligibleInBatch(a, b), 0) + looseHits.filter((h) => eligibleHit(a, h)).length,
  ])) as Record<CrossAction, number>

  const post = (url: string, body?: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })

  // Job idonei, raggruppati per batch (null = estrazioni singole). I batch si
  // leggono ADESSO: lo stato può essere cambiato dall'ultimo aggiornamento.
  async function resolve(a: CrossAction): Promise<{ groups: Map<string | null, JobSnapshot[]>; all: JobSnapshot[] }> {
    const groups = new Map<string | null, JobSnapshot[]>()
    for (const b of batches) {
      try {
        const d = await (await fetch(`/api/polizza/batch/${b.id}`)).json()
        const js = ((d.jobs || []) as JobSnapshot[]).filter((j) => eligible(a, j))
        if (js.length) groups.set(b.id, js)
      } catch { /* batch illeggibile: si salta, il risultato lo dice */ }
    }
    for (const h of looseHits) {
      if (!eligibleHit(a, h)) continue
      const j = { jobId: h.jobId, dossierName: h.dossierName, status: h.status, error: h.error, values: {}, precheck: null } as unknown as JobSnapshot
      const k = h.batchId
      groups.set(k, [...(groups.get(k) || []), j])
    }
    return { groups, all: [...groups.values()].flat() }
  }

  // Esecuzione: una chiamata bulk per batch, una per job per le singole.
  async function execute(action: string, groups: Map<string | null, JobSnapshot[]>, body: Record<string, unknown> = {}) {
    let ok = 0, skipped = 0, notValid = 0
    const refused: string[] = []
    for (const [batchId, jobs] of groups) {
      if (batchId) {
        const res = await post(`/api/polizza/batch/${batchId}/bulk`, { action, jobIds: jobs.map((j) => j.jobId), ...body })
        const d = await res.json().catch(() => ({}))
        if (res.ok) { ok += d.done || 0; skipped += d.skipped || 0; notValid += d.notValid || 0 }
        else {
          // Rifiuto del batch (es. «Riconciliazione non avviata: N dossier in corso»): si dice quale e perché.
          skipped += jobs.length
          const label = batches.find((b) => b.id === batchId)?.label || looseHits.find((h) => h.batchId === batchId)?.batchLabel || batchId
          if (d?.error) refused.push(`${label}: ${d.error}`)
        }
      } else {
        for (const j of jobs) {
          const r = await post(`/api/polizza/job/${j.jobId}/${action}`, body)
          if (r.ok) { ok++; continue }
          const d = await r.json().catch(() => ({}))
          if (d?.code === 'not-valid') notValid++; else skipped++
        }
      }
    }
    const msg = t('jobsDash.bulkResult', { ok, skipped })
    setResult([notValid > 0 ? `${msg} · ${t('jobsDash.bulkResultNotValid', { n: notValid })}` : msg, ...refused].join(' · '))
  }

  async function loadDialogData() {
    if (!profiles.length) {
      try {
        const s = await (await fetch('/api/settings')).json()
        setProfiles((s.polizzaProfiles || []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
      } catch { /* senza profili resta «profilo attuale» */ }
    }
    if (!models.length) {
      try { setModels(((await (await fetch('/api/polizza/models')).json())?.models) || []) } catch { /* testo libero */ }
    }
  }

  const nameList = (jobs: JobSnapshot[]) => {
    const names = jobs.map((j) => `• ${String(j.dossierName || j.jobId).split('/').filter(Boolean).pop()}`)
    return names.slice(0, 10).join('\n') + (names.length > 10 ? `\n… +${names.length - 10}` : '')
  }

  async function run(a: CrossAction) {
    setResult(null)
    setBusy(true)
    let resolved: Awaited<ReturnType<typeof resolve>>
    try { resolved = await resolve(a) } finally { setBusy(false) }
    const { groups, all } = resolved
    if (!all.length) { setResult(t('jobsDash.crossNone')); return }
    // Riabbina / Riabbina ed estrai / Con profilo: il dialogo di sempre.
    if (a === 'rematch' || a === 'rematchExtract' || a === 'reprofile') {
      const mode: ReprofileMode = a === 'reprofile' ? (all.length > 1 ? 'reprofileBatch' : 'reprofile') : (all.length > 1 ? 'rematchBatch' : 'rematch')
      setDialogError('')
      setDial({ mode, action: a, jobs: all })
      setDialGroups(groups)
      void loadDialogData()
      return
    }
    // Azioni dirette: conferma con quante e quali (le lunghe liste si accorciano).
    const conf: Record<string, { title: string; ok: string; danger?: boolean }> = {
      extract: { title: t('jobsDash.crossExtractConfirm', { n: all.length }), ok: t('jobsDash.extract') },
      proceed: { title: t('jobsDash.crossProceedConfirm', { n: all.length }), ok: t('jobsDash.proceedAnyway') },
      retry: { title: t('jobsDash.crossRetryConfirm', { n: all.length }), ok: t('jobsDash.retry') },
      cancel: { title: t('jobsDash.crossCancelConfirm', { n: all.length }), ok: t('jobsDash.cancel'), danger: true },
    }
    const c = conf[a]
    if (!(await ask(`${c.title}\n\n${nameList(all)}`, { okLabel: c.ok, danger: !!c.danger }))) return
    setBusy(true)
    try { await execute(a, groups) } finally { setBusy(false); await reload() }
  }

  async function submitDialog(v: RelaunchValues) {
    if (!dial || !dialGroups) return
    const isReprofile = dial.action === 'reprofile'
    if (isReprofile && !v.profileId) { setDialogError(t('jobsDash.reprofileRequired')); return }
    const body: Record<string, unknown> = {}
    if (v.profileId) body.profileId = v.profileId
    if (!isReprofile && v.extractAfter) body.extract = true
    // Riunisci per numero di polizza: per batch (una chiamata bulk per batch); le
    // estrazioni singole non hanno un batch da riconciliare (la route per job la ignora).
    if (!isReprofile && v.reconcile) body.reconcile = true
    if (isReprofile) {
      if (v.model.trim()) body.model = v.model.trim()
      if (v.strategy === 'perfield') body.perField = true
      else if (v.strategy === 'groups') { body.perField = false; body.stagedCascade = false }
      else if (v.strategy === 'cascade') { body.perField = false; body.stagedCascade = true }
      if (v.prompt) body.promptExtra = v.prompt
    }
    setBusy(true)
    try {
      await execute(isReprofile ? 'reprofile' : 'rematch', dialGroups, body)
      setDial(null)
      setDialGroups(null)
    } catch (e) {
      setDialogError((e as Error).message || 'Errore')
    } finally {
      setBusy(false)
      await reload()
    }
  }

  const dialog = dial ? (
    <RelaunchDialog mode={dial.mode} jobs={dial.jobs} profiles={profiles} models={models} busy={busy} error={dialogError}
      canReconcile initialExtractAfter={dial.action === 'rematchExtract' ? true : dial.action === 'rematch' ? false : undefined}
      onCancel={() => { setDial(null); setDialGroups(null) }} onSubmit={submitDialog} />
  ) : null

  return { counts, busy, result, clearResult: () => setResult(null), run, dialog, confirmPanel: panel }
}
