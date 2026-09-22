'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import { useConfirmPanel } from '@/components/ConfirmPanel'

interface BatchSummary {
  id: string
  label: string
  email: string
  created_at: number
  total: number
  queued: number
  running: number
  done: number
  error: number
  canceled: number
  mismatch: number
  matched: number
  review: number
}

interface JobSnapshot {
  precheck?: Record<string, unknown> | null
  jobId: string
  batchId?: string | null
  owner?: string
  dossierName: string | null
  status: string
  scannedFiles?: string[]
  values: Record<string, string>
  sources?: Record<string, { file: string; page: number | string }>
  fieldDefs?: { id: string; label: string }[]
  progress?: { docIndex: number; docTotal: number; pageIndex: number; pageTotal: number; docName: string } | null
  duplicateOf?: string | null
  sourceJobId?: string | null
  profileId?: string | null
  profileName?: string | null
  promptExtra?: string | null
  logs?: string[]
  updatedAt?: number
  error: string | null
}

function fmtDate(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toLocaleString()
}

function batchStatus(b: BatchSummary): 'running' | 'error' | 'done' | 'queued' | 'mismatch' | 'review' | 'matched' {
  if (b.running > 0 || (b.queued > 0 && b.done + b.error + b.canceled + (b.matched || 0) + (b.review || 0) > 0)) return 'running'
  if (b.queued > 0 && b.done === 0 && b.error === 0) return 'queued'
  if (b.error > 0) return 'error'
  // Dossier fermi: «da verificare» (operatività in dubbio) prima del
  // «da confermare» (non pertinente), poi gli abbinati in attesa del ▶.
  if ((b.review || 0) > 0) return 'review'
  if ((b.mismatch || 0) > 0) return 'mismatch'
  if ((b.matched || 0) > 0) return 'matched'
  return 'done'
}

function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

// Minuti trascorsi dall'ultimo aggiornamento del job (per l'indicatore di stallo).
function minutesSince(epochSeconds?: number): number | null {
  if (!epochSeconds) return null
  return Math.floor((Date.now() / 1000 - epochSeconds) / 60)
}

export default function PolizzaJobsPage() {
  const t = useT()
  const [batches, setBatches] = useState<BatchSummary[] | null>(null)
  const [singles, setSingles] = useState<JobSnapshot[] | null>(null) // estrazioni fuori batch
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<JobSnapshot[] | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [showValues, setShowValues] = useState<Set<string>>(new Set())   // jobId → risultati aperti
  const [showLog, setShowLog] = useState<Set<string>>(new Set())         // jobId → log aperto
  const [showFiles, setShowFiles] = useState<Set<string>>(new Set())     // jobId → elenco PDF aperto
  const [retryExcluded, setRetryExcluded] = useState<Set<string>>(new Set()) // jobId esclusi dal rilancio
  const [busy, setBusy] = useState(false)
  // Dialog universale di rilancio: "run di TEST" (crea una COPIA) oppure
  // "rielabora con profilo" (singolo o batch) — lo STESSO job torna in coda coi
  // field_defs del profilo scelto al posto di quelli congelati all'upload.
  // 'rematch' / 'rematchBatch': RIABBINA — rifà solo OCR (cache) + pertinenza
  // col profilo attuale, uno scelto o Automatico; l'estrazione aspetta il ▶.
  type ReprofileMode = 'test' | 'reprofile' | 'reprofileBatch' | 'rematch' | 'rematchBatch'
  const [dial, setDial] = useState<{ mode: ReprofileMode; jobs: JobSnapshot[] } | null>(null)
  // Filtro per stato nel dettaglio batch (chip cliccabili): null = tutte le righe.
  const [chipFilter, setChipFilter] = useState<string | null>(null)
  const { ask: askConfirm, panel: confirmPanel } = useConfirmPanel()
  const [testProfileId, setTestProfileId] = useState('')
  const [testModel, setTestModel] = useState('')
  const [testStrategy, setTestStrategy] = useState('')      // '' = come da impostazioni
  const [testPrompt, setTestPrompt] = useState('')
  const [testModels, setTestModels] = useState<string[]>([])
  const [testProfiles, setTestProfiles] = useState<{ id: string; name: string }[]>([])
  // Selezione multipla per le AZIONI IN BULK nel dettaglio batch: un solo set di
  // jobId spuntati, condiviso da tutte le azioni (Rielabora, con profilo, Test,
  // Riusa, Procedi comunque, Annulla, Riprova). Funziona su TUTTI gli stati.
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [reprofileError, setReprofileError] = useState('')
  const [bulkResult, setBulkResult] = useState<string | null>(null)

  const loadBatches = useCallback(async () => {
    try {
      const res = await fetch('/api/polizza/batch')
      const d = await res.json()
      setBatches(d.batches || [])
    } catch { setBatches([]) }
    // Estrazioni singole (fuori batch), di tutti: stessa dashboard dei batch.
    try {
      const res = await fetch('/api/polizza/job')
      const d = await res.json()
      setSingles(d.jobs || [])
    } catch { setSingles([]) }
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/polizza/batch/${id}`)
      const d = await res.json()
      setDetail(d.jobs || [])
    } catch { setDetail([]) }
  }, [])

  // Polling: elenco batch sempre; dettaglio del batch aperto insieme (progresso live).
  useEffect(() => {
    loadBatches()
    const id = setInterval(() => {
      loadBatches()
      if (openId) loadDetail(openId)
    }, 4000)
    return () => clearInterval(id)
  }, [loadBatches, loadDetail, openId])

  async function toggleOpen(id: string) {
    if (openId === id) { setOpenId(null); setDetail(null); return }
    setOpenId(id); setDetail(null); setLoadingDetail(true)
    setShowValues(new Set()); setShowLog(new Set()); setRetryExcluded(new Set()); setBulkSelected(new Set()); setChipFilter(null)
    await loadDetail(id)
    setLoadingDetail(false)
  }

  const toggleIn = (set: Set<string>, v: string) => {
    const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n
  }

  async function cancelJobRow(jobId: string) {
    await fetch(`/api/polizza/job/${jobId}/cancel`, { method: 'POST' }).catch(() => {})
    if (openId) await loadDetail(openId)
    await loadBatches()
  }

  async function retryJobRow(jobId: string) {
    setBusy(true)
    try {
      await fetch(`/api/polizza/job/${jobId}/retry`, { method: 'POST' })
      if (openId) await loadDetail(openId)
      await loadBatches()
    } finally { setBusy(false) }
  }

  // Apre il dialog universale di rilancio. Carica (una volta) profili e modelli;
  // i default sono "campi del job" e "modello/strategia correnti". Per i modi
  // "rielabora con profilo" il profilo è OBBLIGATORIO (si sostituiscono i campi
  // congelati): si preseleziona l'ultimo scelto, se ancora esiste.
  async function openDialog(mode: ReprofileMode, jobs: JobSnapshot[]) {
    setDial({ mode, jobs }); setTestProfileId(''); setTestModel(''); setTestStrategy(''); setReprofileError('')
    setTestPrompt(mode === 'reprofileBatch' ? '' : (jobs[0]?.promptExtra || ''))
    if (!testProfiles.length) {
      try {
        const s = await (await fetch('/api/settings')).json()
        setTestProfiles((s.polizzaProfiles || []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })))
        // Preselezione: per il singolo l'ultimo profilo usato da QUESTO job
        // (resetJobForRetry NON rifà i campi se si lascia "campi del job").
        if (mode === 'reprofile') {
          const pid = jobs[0]?.profileId
          if (pid && (s.polizzaProfiles || []).some((p: { id: string }) => p.id === pid)) setTestProfileId(pid)
        }
        // Riabbina: default «profilo attuale del job» ('' = nessuna sostituzione).
      } catch { /* senza profili resta "campi del job" */ }
    }
    if (!testModels.length) {
      try { setTestModels(((await (await fetch('/api/polizza/models')).json())?.models) || []) } catch { /* free-text */ }
    }
  }

  // Sottomissione del dialog: TEST (copia, profilo opzionale) oppure
  // REPROFILE/REPROFILE_BATCH (stesso job in coda, profilo OBBLIGATORIO).
  async function submitDialog() {
    if (!dial) return
    const { mode, jobs } = dial
    const isRematch = mode === 'rematch' || mode === 'rematchBatch'
    if (!isRematch && mode !== 'test' && !testProfileId) { setReprofileError(t('jobsDash.reprofileRequired')); return }
    setBusy(true)
    try {
      if (isRematch) {
        // Solo abbinamento: profilo attuale ('' → nessun profileId), Automatico o scelto.
        const url = mode === 'rematch' ? `/api/polizza/job/${jobs[0].jobId}/rematch` : `/api/polizza/batch/${jobs[0].batchId}/bulk`
        const rbody: Record<string, unknown> = mode === 'rematch'
          ? (testProfileId ? { profileId: testProfileId } : {})
          : { action: 'rematch', jobIds: jobs.map((j) => j.jobId), ...(testProfileId ? { profileId: testProfileId } : {}) }
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rbody) })
        if (!res.ok) { setReprofileError(((await res.json())?.error) || 'Errore'); return }
        setDial(null)
        if (mode === 'rematchBatch') setBulkSelected(new Set())
        if (openId) await loadDetail(openId)
        await loadBatches()
        return
      }
      const body: Record<string, unknown> = {}
      if (testProfileId) body.profileId = testProfileId
      if (testModel.trim()) body.model = testModel.trim()
      if (testStrategy === 'perfield') { body.perField = true }
      else if (testStrategy === 'groups') { body.perField = false; body.stagedCascade = false }
      else if (testStrategy === 'cascade') { body.perField = false; body.stagedCascade = true }
      if (testPrompt !== (jobs[0]?.promptExtra || '')) body.promptExtra = testPrompt
      const url = mode === 'test'
        ? `/api/polizza/job/${jobs[0].jobId}/test`
        : mode === 'reprofile'
          ? `/api/polizza/job/${jobs[0].jobId}/reprofile`
          : `/api/polizza/batch/${jobs[0].batchId}/reprofile`
      if (mode === 'reprofileBatch') body.jobIds = jobs.map((j) => j.jobId)
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!res.ok) { setReprofileError(((await res.json())?.error) || 'Errore'); return }
      setDial(null)
      if (mode === 'reprofileBatch') setBulkSelected(new Set())
      if (openId) await loadDetail(openId)
      await loadBatches()
    } finally { setBusy(false) }
  }

  // Fascicolo identico a un job già completato: copia i risultati senza rifare
  // OCR né estrazione (azione esplicita — il default resta rielaborare).
  async function reuseJobRow(jobId: string) {
    setBusy(true)
    try {
      await fetch(`/api/polizza/job/${jobId}/reuse`, { method: 'POST' })
      if (openId) await loadDetail(openId)
      await loadBatches()
    } finally { setBusy(false) }
  }

  async function retryFailed(batchId: string) {
    setBusy(true)
    try {
      await fetch(`/api/polizza/batch/${batchId}/retry-failed`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ excludeJobIds: [...retryExcluded] }),
      })
      setRetryExcluded(new Set())
      await loadDetail(batchId)
      await loadBatches()
    } finally { setBusy(false) }
  }

  // Job selezionabili per la rielaborazione collettiva con profilo.
  const selectableForReprofile = (j: JobSnapshot) => j.status !== 'done' && j.status !== 'canceled'

  // Apre il dialog "rielabora con profilo" per tutti i job selezionati del batch.
  function openBatchReprofile(batchId: string) {
    const jobs = (detail || []).filter((j) => selectableForReprofile(j) && bulkSelected.has(j.jobId))
      .map((j) => ({ ...j, batchId }))
    if (jobs.length) openDialog('reprofileBatch', jobs)
  }

  // Azione in BULK su tutti i job spuntati del batch: delega alla route
  // /api/polizza/batch/[id]/bulk con { action, jobIds, ...override }. Le azioni
  // non applicabili a un dato stato vengono saltate lato server.
  async function runBulkAction(batchId: string, action: string) {
    const jobs = (detail || []).filter((j) => bulkSelected.has(j.jobId))
    if (!jobs.length) return
    setBusy(true); setBulkResult(null)
    try {
      const body: Record<string, unknown> = { action, jobIds: jobs.map((j) => j.jobId) }
      if (action === 'reprofile') {
        // Rielabora con profilo richiede un profilo: riusa il dialog universale.
        // Niente setBusy qui: il dialog gestisce il proprio busy.
        openDialog('reprofileBatch', jobs.map((j) => ({ ...j, batchId })))
        return
      }
      if (action === 'rematch') {
        // Riabbina: scelta del profilo (attuale / Automatico / uno) nel dialog.
        // Le righe in corso/in coda non si riabbinano: senza righe idonee niente dialog.
        const eligible = jobs.filter((j) => j.status !== 'running' && j.status !== 'queued').map((j) => ({ ...j, batchId }))
        if (!eligible.length) { setBulkResult(t('jobsDash.bulkResult', { ok: 0, skipped: jobs.length })); return }
        openDialog('rematchBatch', eligible)
        return
      }
      const res = await fetch(`/api/polizza/batch/${batchId}/bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setBulkResult(d.error || 'Errore'); return }
      setBulkResult(t('jobsDash.bulkResult', { ok: d.done || 0, skipped: d.skipped || 0 }))
      if (openId) await loadDetail(openId)
      await loadBatches()
    } finally { setBusy(false) }
  }

  // Export Excel del singolo dossier (riusa il tracciato della pagina Polizze).
  async function exportJobExcel(j: JobSnapshot) {
    const res = await fetch('/api/polizza/export-new', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // i campi del JOB: l'Excel segue il profilo con cui è stato estratto il
      // dossier, non quello attivo nelle Impostazioni (usciva vuoto se diverso)
      body: JSON.stringify({ data: j.values || {}, fields: j.fieldDefs || [], suggestedName: (j.dossierName || 'polizza').split('/').pop() }),
    })
    if (res.ok) downloadBlob(await res.blob(), `${(j.dossierName || 'polizza').split('/').pop()}.xlsx`)
  }

  // Export consolidato del batch: una riga per dossier.
  async function exportBatch(batchId: string, label: string) {
    const res = await fetch(`/api/polizza/batch/${batchId}/export`)
    if (res.ok) downloadBlob(await res.blob(), `${label.replace(/[^a-zA-Z0-9_-]/g, '_')}_risultati.xlsx`)
  }

  // Un job in stato 'mismatch' può essere un "da confermare" (falso allarme
  // del pre-check) oppure uno "Scartato" perché una parola del contenuto da
  // evitare è stata trovata nel testo: lo distingue l'errore scritto dal worker
  // ("Scartato — …"). Il motivo è esplicito nella colonna stato.
  const isDiscarded = (j: JobSnapshot) => j.status === 'mismatch' && (j.error || '').startsWith('Scartato')
  // "Accantonato — …": cartella senza polizza principale (niente da estrarre);
  // resta in stato 'mismatch' (stesso flusso "Procedi comunque"), etichetta sua.
  const isSetAside = (j: JobSnapshot) => j.status === 'mismatch' && (j.error || '').startsWith('Accantonato')
  const statusLabel = (s: string) => (
    s === 'running' ? t('jobsDash.statusRunning')
      : s === 'error' ? t('jobsDash.statusError')
        : s === 'queued' ? t('jobsDash.statusQueued')
          : s === 'mismatch' ? t('jobsDash.statusMismatch')
            : s === 'review' ? t('jobsDash.statusReview')
              : s === 'matched' ? t('jobsDash.statusMatched')
                : t('jobsDash.statusDone')
  )
  // Etichetta di BATCH: gli stati «fermi» dicono cosa aspetta l'utente.
  const batchStatusLabel = (s: string) => (
    s === 'matched' ? t('jobsDash.statusMatchedBatch') : s === 'review' ? t('jobsDash.statusReviewBatch') : statusLabel(s)
  )
  const statusColor = (s: string) => (
    s === 'running' ? 'var(--c-info)'
      : s === 'error' ? 'var(--c-error)'
        : s === 'queued' ? 'var(--c-text-muted)'
          : s === 'mismatch' || s === 'review' ? 'var(--c-warning, #d97706)'
            : 'var(--c-success)'
  )

  // ▶ ESTRAI: avvia l'estrazione di un job ABBINATO (solo abbinamento riuscito).
  async function extractJobRow(jobId: string) {
    setBusy(true)
    try {
      await fetch(`/api/polizza/job/${jobId}/extract`, { method: 'POST' })
      if (openId) await loadDetail(openId)
      await loadBatches()
    } finally { setBusy(false) }
  }
  // «Usa e riabbina»: riabbina il dossier col profilo suggerito dal controllo.
  async function rematchWith(jobId: string, profileId: string) {
    setBusy(true)
    try {
      await fetch(`/api/polizza/job/${jobId}/rematch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId }) })
      if (openId) await loadDetail(openId)
      await loadBatches()
    } finally { setBusy(false) }
  }
  // ▶ AVVIA ESTRAZIONE su tutti gli abbinati del batch (conferma nel pannello).
  async function extractAll(batchId: string, n: number) {
    if (!(await askConfirm(t('jobsDash.extractAllConfirm', { n }), { okLabel: t('jobsDash.extractAllOk'), title: t('jobsDash.extractAll', { n }) }))) return
    setBusy(true)
    try {
      await fetch(`/api/polizza/batch/${batchId}/extract-all`, { method: 'POST' })
      await loadDetail(batchId)
      await loadBatches()
    } finally { setBusy(false) }
  }
  // Riabbina TUTTI i dossier del batch (non in corso): dialog di scelta profilo.
  function openBatchRematch(batchId: string) {
    const jobs = (detail || []).filter((j) => j.status !== 'running' && j.status !== 'queued').map((j) => ({ ...j, batchId }))
    if (jobs.length) openDialog('rematchBatch', jobs)
  }

  // Chip di stato nel dettaglio batch: quali righe rientrano in un gruppo.
  const chipOf = (j: JobSnapshot): string => (
    j.status === 'running' || j.status === 'queued' ? 'active'
      : j.status === 'matched' ? 'matched'
        : j.status === 'review' ? 'review'
          : j.status === 'mismatch' ? (isSetAside(j) ? 'setAside' : 'mismatch')
            : j.status === 'done' ? 'done'
              : 'error'
  )
  // Riga «Profilo»: nome (auto → nome se scelto dal riconoscimento), badge
  // «solo abbinamento», profilo suggerito con «Usa e riabbina».
  const profileCell = (j: JobSnapshot, activeRow: boolean) => {
    const pc = (j.precheck as any) || {}
    const name = j.profileName || (j.profileId ? j.profileId : t('jobsDash.profileNone'))
    const sugg = pc.suggestion && pc.suggestion.id && pc.suggestion.id !== j.profileId ? pc.suggestion : null
    return (
      <>
        <span>{pc.auto ? t('jobsDash.profileAuto', { name }) : name}</span>
        {pc.matchOnly && j.status !== 'matched' && (
          <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 999, background: 'var(--c-bg-card-alt)', color: 'var(--c-text-secondary)' }}>{t('jobsDash.matchOnlyBadge')}</span>
        )}
        {sugg && (
          <span style={{ display: 'block', fontSize: 10, color: 'var(--c-text-secondary)', marginTop: 2 }}>
            {t('jobsDash.suggested', { name: sugg.name })}{' '}
            <button type="button" className="btn btn-secondary" style={{ fontSize: 9, padding: '1px 6px' }} disabled={busy || activeRow}
              title={t('jobsDash.useSuggestedTitle')} onClick={() => rematchWith(j.jobId, sugg.id)}>
              🔁 {t('jobsDash.useSuggested')}
            </button>
          </span>
        )}
      </>
    )
  }
  // Motivazione della pertinenza sotto lo stato: con l'operatività due righe
  // strutturate (esito — Documento N pag. P: «prova» / motivo), altrimenti la
  // sintesi storica. Il testo completo resta nel title.
  const precheckLines = (j: JobSnapshot, max: number) => {
    const pc = (j.precheck as any) || {}
    const summary = typeof pc.summary === 'string' ? pc.summary : ''
    const op = pc.operativita
    if (op && op.esito) {
      // Esito del MODELLO + verdetto finale quando non coincidono (prova non
      // trovata/generica, batch contraddittori, parola da evitare): «Operante»
      // in grassetto su una riga «Da verificare» confondeva.
      const esitoBase = op.esito === 'operante' ? t('jobsDash.opOperante') : op.esito === 'non operante' ? t('jobsDash.opNonOperante') : t('jobsDash.opDubbio')
      const esito = pc.verdict === 'review' ? `${esitoBase} · ${t('jobsDash.chipReview').toLowerCase()}` : esitoBase
      const where = op.documento ? ` — ${t('jobsDash.evidenceAt', { doc: op.documento, page: op.pagina || '?' })}` : ''
      return (
        <span title={summary} style={{ display: 'block', fontSize: 11, color: 'var(--c-text-secondary)' }}>
          <span style={{ fontWeight: 600 }}>{esito}</span>{where}{op.evidenza ? `: «${String(op.evidenza).slice(0, 160)}»` : ''}
          {op.motivo ? <span style={{ display: 'block', color: 'var(--c-text-muted)' }}>{String(op.motivo).slice(0, 160)}</span> : null}
        </span>
      )
    }
    if (!summary) return null
    return (
      <span title={summary} style={{ display: 'block', fontSize: 11, color: 'var(--c-text-secondary)' }}>
        {summary.slice(0, max)}
      </span>
    )
  }

  // "Procedi comunque": sblocca un job fermato dal pre-check di pertinenza.
  async function proceedJobRow(jobId: string) {
    setBusy(true)
    try {
      await fetch(`/api/polizza/job/${jobId}/proceed`, { method: 'POST' })
      if (openId) await loadDetail(openId)
      await loadBatches()
    } finally { setBusy(false) }
  }
  const fieldLabel = (j: JobSnapshot, id: string) => j.fieldDefs?.find((f) => f.id === id)?.label || id

  // URL del PDF originale di un file del job: l'ordine di scanned_files coincide
  // con l'idx di polizza_job_files (entrambi nascono da files[] in createJob).
  // Con nomi duplicati indexOf prende il primo: accettabile, la pagina è nel
  // fragment. Se il nome non si trova → null e la fonte resta testo puro.
  const fileUrl = (j: JobSnapshot, name: string, page?: number | string) => {
    const idx = (j.scannedFiles || []).indexOf(name)
    if (idx < 0) return null
    return `/api/polizza/job/${j.jobId}/file/${idx}${page ? `#page=${page}` : ''}`
  }
  // Fonte di un campo come LINK che apre il PDF originale alla pagina citata
  // (verifica manuale dei valori: il cliente cerca il dato con i suoi occhi).
  const sourceCell = (j: JobSnapshot, k: string) => {
    const s = j.sources?.[k]
    if (!s) return ''
    const text = `${s.file}${s.page ? ` · pag. ${s.page}` : ''}`
    const url = fileUrl(j, s.file, s.page)
    if (!url) return text
    return (
      <a href={url} target="_blank" rel="noopener" title={t('jobsDash.openPdf')}
        style={{ color: 'inherit', textDecoration: 'underline dotted' }}>
        {text}
      </a>
    )
  }
  // Elenco dei PDF originali del job, ciascuno apribile in un nuovo tab.
  const filesList = (j: JobSnapshot, colSpan: number, indent: number) => (
    <tr>
      <td colSpan={colSpan} style={{ padding: `4px 14px 10px ${indent}px` }}>
        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11, fontFamily: 'var(--font-mono)' }}>
          {(j.scannedFiles || []).map((name, i) => (
            <li key={`${name}-${i}`} style={{ padding: '1px 0' }}>
              <a href={`/api/polizza/job/${j.jobId}/file/${i}`} target="_blank" rel="noopener"
                title={t('jobsDash.openPdf')} style={{ color: 'var(--c-text-secondary)', textDecoration: 'underline dotted' }}>
                📄 {name}
              </a>
            </li>
          ))}
        </ul>
      </td>
    </tr>
  )

  return (
    <div style={{ maxWidth: 1300 }}>
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
                <th style={{ padding: '10px 14px' }}>{t('jobsDash.colOwner')}</th>
                <th style={{ padding: '10px 14px' }}>{t('jobsDash.colStatus')}</th>
                <th style={{ padding: '10px 14px' }}>{t('jobsDash.colProgress')}</th>
                <th style={{ padding: '10px 14px' }}>{t('jobsDash.colDate')}</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const st = batchStatus(b)
                const isOpen = openId === b.id
                const failedCount = detail ? detail.filter((j) => j.status === 'error').length : b.error
                const retryCount = detail ? detail.filter((j) => j.status === 'error' && !retryExcluded.has(j.jobId)).length : 0
                const selectedCount = detail ? detail.filter((j) => bulkSelected.has(j.jobId)).length : 0
                const allSelected = detail ? detail.length > 0 && selectedCount === detail.length : false
                return (
                  <Fragment key={b.id}>
                    <tr style={{ cursor: 'pointer' }} onClick={() => toggleOpen(b.id)}>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>{b.label}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--c-text-secondary)' }}>{b.email}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: statusColor(st), fontWeight: 600 }}>{batchStatusLabel(st)}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12 }}>{t('jobsDash.progressCount', { done: b.done + b.error + b.canceled + (b.mismatch || 0) + (b.matched || 0) + (b.review || 0), total: b.total })}</td>
                      <td style={{ padding: '10px 14px', fontSize: 12, color: 'var(--c-text-muted)' }}>{fmtDate(b.created_at)}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} style={{ padding: '0 14px 14px', background: 'var(--c-bg-card-alt)' }}>
                          {loadingDetail && <p style={{ fontSize: 12 }}><span className="spinner" /></p>}
                          {!loadingDetail && detail && (() => {
                            // Contatori per stato (chip cliccabili = filtro righe) e
                            // abbinati in attesa del ▶.
                            const chips: { key: string; label: string; n: number; color: string }[] = [
                              { key: 'matched', label: t('jobsDash.chipMatched'), n: detail.filter((j) => chipOf(j) === 'matched').length, color: 'var(--c-success)' },
                              { key: 'review', label: t('jobsDash.chipReview'), n: detail.filter((j) => chipOf(j) === 'review').length, color: 'var(--c-warning, #d97706)' },
                              { key: 'mismatch', label: t('jobsDash.chipMismatch'), n: detail.filter((j) => chipOf(j) === 'mismatch').length, color: 'var(--c-warning, #d97706)' },
                              { key: 'setAside', label: t('jobsDash.chipSetAside'), n: detail.filter((j) => chipOf(j) === 'setAside').length, color: 'var(--c-text-secondary)' },
                              { key: 'done', label: t('jobsDash.chipDone'), n: detail.filter((j) => chipOf(j) === 'done').length, color: 'var(--c-success)' },
                              { key: 'error', label: t('jobsDash.chipError'), n: detail.filter((j) => chipOf(j) === 'error').length, color: 'var(--c-error)' },
                              { key: 'active', label: t('jobsDash.chipActive'), n: detail.filter((j) => chipOf(j) === 'active').length, color: 'var(--c-info)' },
                            ]
                            const matchedCount = chips[0].n
                            const visible = chipFilter ? detail.filter((j) => chipOf(j) === chipFilter) : detail
                            const allVisibleSelected = visible.length > 0 && visible.every((j) => bulkSelected.has(j.jobId))
                            return (
                            <>
                              <div style={{ display: 'flex', gap: 6, margin: '10px 0 4px', flexWrap: 'wrap', alignItems: 'center' }} onClick={(e) => e.stopPropagation()} title={t('jobsDash.chipsHint')}>
                                <button type="button" onClick={() => { setChipFilter(null); setBulkSelected(new Set()) }}
                                  style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: '1px solid var(--c-border)', background: chipFilter === null ? 'var(--c-accent)' : 'var(--c-bg-card)', color: chipFilter === null ? '#fff' : 'var(--c-text-secondary)', width: 'auto' }}>
                                  {t('jobsDash.chipAll')} {detail.length}
                                </button>
                                {chips.filter((c) => c.n > 0).map((c) => (
                                  <button key={c.key} type="button" onClick={() => { setChipFilter(chipFilter === c.key ? null : c.key); setBulkSelected(new Set()) }}
                                    style={{ fontSize: 11, padding: '2px 9px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${chipFilter === c.key ? c.color : 'var(--c-border)'}`, background: chipFilter === c.key ? c.color : 'var(--c-bg-card)', color: chipFilter === c.key ? '#fff' : c.color, fontWeight: 600, width: 'auto' }}>
                                    {c.label} {c.n}
                                  </button>
                                ))}
                              </div>
                              <div style={{ display: 'flex', gap: 8, margin: '6px 0 10px', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                                {matchedCount > 0 && (
                                  <button className="btn btn-primary" style={{ fontSize: 11 }} disabled={busy} onClick={() => extractAll(b.id, matchedCount)} title={t('jobsDash.extractTitle')}>
                                    {t('jobsDash.extractAll', { n: matchedCount })}
                                  </button>
                                )}
                                <button className="btn btn-secondary" style={{ fontSize: 11 }} disabled={busy} onClick={() => openBatchRematch(b.id)} title={t('jobsDash.rematchAllTitle')}>
                                  {t('jobsDash.rematchAll')}
                                </button>
                                <button className="btn btn-secondary" style={{ fontSize: 11 }} onClick={() => exportBatch(b.id, b.label)}>
                                  ⬇ {t('jobsDash.exportBatch')}
                                </button>
                                {/* PDF originali del batch in uno ZIP, divisi nelle cartelle
                                    di origine. LINK diretto e non fetch+blob: l'archivio
                                    arriva in streaming e finisce su disco senza passare
                                    per la memoria della pagina (un batch pesa gigabyte). */}
                                <a className="btn btn-secondary" style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}
                                  href={`/api/polizza/batch/${b.id}/pdfs`} download
                                  title={t('jobsDash.downloadPdfsTitle')}>
                                  🗂 {t('jobsDash.downloadPdfs')}
                                </a>
                                {/* Azioni IN BULK sui job spuntati (tutti gli stati):
                                    Estrai, Riabbina, Rielabora, Rielabora con profilo, Run di
                                    test, Riusa, Procedi comunque, Annulla, Riprova. */}
                                {selectedCount > 0 && (
                                  <>
                                    <button className="btn btn-secondary" style={{ fontSize: 11, fontWeight: 700 }} disabled={busy}
                                      title={t('jobsDash.extractTitle')} onClick={() => runBulkAction(b.id, 'extract')}>
                                      {t('jobsDash.bulkExtract')}
                                    </button>
                                    <button className="btn btn-secondary" style={{ fontSize: 11 }} disabled={busy}
                                      title={t('jobsDash.rematchTitle')} onClick={() => runBulkAction(b.id, 'rematch')}>
                                      {t('jobsDash.bulkRematch')}
                                    </button>
                                    <button className="btn btn-secondary" style={{ fontSize: 11 }} disabled={busy}
                                      title={t('jobsDash.bulkHint')} onClick={() => runBulkAction(b.id, 'retry')}>
                                      {t('jobsDash.bulkRetry')}
                                    </button>
                                    <button className="btn btn-secondary" style={{ fontSize: 11 }} disabled={busy}
                                      title={t('jobsDash.reprocessWithProfileTitle')} onClick={() => runBulkAction(b.id, 'reprofile')}>
                                      {t('jobsDash.bulkReprofile')}
                                    </button>
                                    <button className="btn btn-secondary" style={{ fontSize: 11 }} disabled={busy}
                                      title={t('jobsDash.testTitle')} onClick={() => runBulkAction(b.id, 'test')}>
                                      {t('jobsDash.bulkTest')}
                                    </button>
                                    <button className="btn btn-secondary" style={{ fontSize: 11 }} disabled={busy}
                                      title={t('jobsDash.reuseTitle')} onClick={() => runBulkAction(b.id, 'reuse')}>
                                      {t('jobsDash.bulkReuse')}
                                    </button>
                                    <button className="btn btn-secondary" style={{ fontSize: 11 }} disabled={busy}
                                      title={t('jobsDash.proceedTitle')} onClick={() => runBulkAction(b.id, 'proceed')}>
                                      {t('jobsDash.bulkProceed')}
                                    </button>
                                    <button className="btn btn-secondary" style={{ fontSize: 11 }} disabled={busy}
                                      onClick={() => runBulkAction(b.id, 'cancel')}>
                                      {t('jobsDash.bulkCancel')}
                                    </button>
                                  </>
                                )}
                                {bulkResult && <span style={{ fontSize: 11, color: 'var(--c-text-secondary)' }}>{bulkResult}</span>}
                                {failedCount > 0 && (
                                  <button className="btn btn-secondary" style={{ fontSize: 11 }} disabled={busy || retryCount === 0} onClick={() => retryFailed(b.id)}>
                                    ↻ {t('jobsDash.retryFailed', { n: retryCount })}
                                  </button>
                                )}
                              </div>
                              <table>
                                <thead>
                                  <tr>
                                    <th style={{ fontSize: 10 }}>
                                      <input type="checkbox" checked={allVisibleSelected}
                                        onChange={(e) => {
                                          // Solo le righe VISIBILI (filtro chip): mai spuntare righe nascoste.
                                          const n = new Set(bulkSelected)
                                          if (e.target.checked) for (const jd of visible) n.add(jd.jobId)
                                          else for (const jd of visible) n.delete(jd.jobId)
                                          setBulkSelected(n)
                                        }}
                                        title={t('jobsDash.selectAll')} />
                                    </th>
                                    <th style={{ fontSize: 10 }}>{t('jobsDash.dossierName')}</th>
                                    <th style={{ fontSize: 10 }}>{t('jobsDash.colProfile')}</th>
                                    <th style={{ fontSize: 10 }}>{t('jobsDash.dossierStatus')}</th>
                                    <th style={{ fontSize: 10 }}>{t('jobsDash.dossierFields')}</th>
                                    <th style={{ fontSize: 10, textAlign: 'right' }}>{t('jobsDash.colActions')}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {visible.map((j) => {
                                    const active = j.status === 'running' || j.status === 'queued'
                                    const failed = j.status === 'error'
                                    const selectable = selectableForReprofile(j)
                                    // Riuso possibile: fascicolo identico noto e job non in corso/completato
                                    const reusable = !!j.duplicateOf && (j.status === 'queued' || j.status === 'error' || j.status === 'canceled')
                                    const hasValues = Object.keys(j.values || {}).length > 0
                                    const stale = j.status === 'running' ? minutesSince(j.updatedAt) : null
                                    const valuesOpen = showValues.has(j.jobId)
                                    const logOpen = showLog.has(j.jobId)
                                    const filesOpen = showFiles.has(j.jobId)
                                    return (
                                      <Fragment key={j.jobId}>
                                        <tr>
                                          <td style={{ fontSize: 12 }}>
                                            <input type="checkbox" checked={bulkSelected.has(j.jobId)}
                                              onChange={() => setBulkSelected((p) => toggleIn(p, j.jobId))}
                                              title={t('jobsDash.selectAll')} />
                                          </td>
                                          <td style={{ fontSize: 12 }}>
                                            {hasValues && (
                                              <button type="button" onClick={() => setShowValues((p) => toggleIn(p, j.jobId))} title={t('jobsDash.showValues')}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-secondary)', fontSize: 11, padding: 0, marginRight: 6, width: 12 }}>
                                                {valuesOpen ? '▾' : '▸'}
                                              </button>
                                            )}
                                            {j.dossierName || '—'}
                                          </td>
                                          <td style={{ fontSize: 11 }}>{profileCell(j, active)}</td>
                                          <td style={{ fontSize: 12, color: statusColor(j.status === 'canceled' ? 'error' : j.status) }}>
                                            {isDiscarded(j) ? t('jobsDash.statusDiscarded') : isSetAside(j) ? t('jobsDash.statusSetAside') : statusLabel(j.status === 'canceled' ? 'error' : j.status)}
                                            {j.error ? <span title={j.error}>{` — ${j.status === 'review' ? j.error.slice(0, 260) : j.error}`}</span> : ''}
                                            {precheckLines(j, 220)}
                                            {j.status === 'running' && j.progress?.docName && (
                                              <span style={{ display: 'block', fontSize: 11, color: 'var(--c-text-secondary)' }}>
                                                {j.progress.docName}
                                                {j.progress.pageTotal ? ` · pag. ${j.progress.pageIndex}/${j.progress.pageTotal}` : ''}
                                                {j.progress.docTotal ? ` · doc ${j.progress.docIndex + 1}/${j.progress.docTotal}` : ''}
                                              </span>
                                            )}
                                            {stale != null && stale >= 3 && (
                                              <span style={{ display: 'block', fontSize: 11, color: 'var(--c-warning, #d97706)', fontWeight: 600 }}>
                                                ⚠ {t('jobsDash.staleFor', { n: stale })}
                                              </span>
                                            )}
                                            {!!j.duplicateOf && (
                                              <span style={{ display: 'block', fontSize: 11, color: 'var(--c-text-secondary)' }}>
                                                ⧉ {t('jobsDash.duplicateOf')}
                                              </span>
                                            )}
                                          </td>
                                          <td style={{ fontSize: 12 }}>{Object.keys(j.values || {}).length}</td>
                                          <td style={{ fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            {failed && failedCount > 1 && (
                                              <label style={{ fontSize: 10, marginRight: 8, cursor: 'pointer' }} title={t('jobsDash.excludeFromRetry')}>
                                                <input type="checkbox" checked={!retryExcluded.has(j.jobId)}
                                                  onChange={() => setRetryExcluded((p) => toggleIn(p, j.jobId))} /> {t('jobsDash.retryInclude')}
                                              </label>
                                            )}
                                            {failed && (
                                              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} disabled={busy} onClick={() => retryJobRow(j.jobId)}>
                                                ↻ {t('jobsDash.retry')}
                                              </button>
                                            )}
                                            {j.status === 'matched' && (
                                              <button className="btn btn-primary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6, fontWeight: 700 }} disabled={busy}
                                                title={t('jobsDash.extractTitle')} onClick={() => extractJobRow(j.jobId)}>
                                                ▶ {t('jobsDash.extract')}
                                              </button>
                                            )}
                                            {(j.status === 'mismatch' || j.status === 'review') && (
                                              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6, color: 'var(--c-warning, #d97706)', fontWeight: 700 }} disabled={busy}
                                                title={j.status === 'review' ? t('jobsDash.proceedReviewTitle') : t('jobsDash.proceedTitle')} onClick={() => proceedJobRow(j.jobId)}>
                                                ▶ {t('jobsDash.proceedAnyway')}
                                              </button>
                                            )}
                                            {!active && (
                                              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} disabled={busy}
                                                title={t('jobsDash.rematchTitle')} onClick={() => openDialog('rematch', [j])}>
                                                🔁 {t('jobsDash.rematch')}
                                              </button>
                                            )}
                                            {(j.status === 'done' || j.status === 'canceled' || j.status === 'mismatch' || j.status === 'review' || j.status === 'matched') && (
                                              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} disabled={busy}
                                                title={t('jobsDash.reprocessTitle')} onClick={() => retryJobRow(j.jobId)}>
                                                ↻ {t('jobsDash.reprocess')}
                                              </button>
                                            )}
                                            {['done', 'error', 'canceled', 'mismatch', 'review', 'matched'].includes(j.status) && (
                                              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} disabled={busy}
                                                title={t('jobsDash.reprocessWithProfileTitle')} onClick={() => openDialog('reprofile', [j])}>
                                                ⇄ {t('jobsDash.reprocessWithProfile')}
                                              </button>
                                            )}
                                            {(j.status === 'done' || j.status === 'error') && (
                                              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} disabled={busy}
                                                title={t('jobsDash.testTitle')} onClick={() => openDialog('test', [j])}>
                                                🧪 {t('jobsDash.test')}
                                              </button>
                                            )}
                                            {reusable && (
                                              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} disabled={busy}
                                                title={t('jobsDash.reuseTitle')} onClick={() => reuseJobRow(j.jobId)}>
                                                ⧉ {t('jobsDash.reuse')}
                                              </button>
                                            )}
                                            {hasValues && (
                                              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} onClick={() => exportJobExcel(j)}>
                                                ⬇ Excel
                                              </button>
                                            )}
                                            {(j.logs?.length || 0) > 0 && (
                                              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} onClick={() => setShowLog((p) => toggleIn(p, j.jobId))}>
                                                {logOpen ? t('jobsDash.hideLog') : 'Log'}
                                              </button>
                                            )}
                                            {(j.scannedFiles?.length || 0) > 0 && (
                                              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }}
                                                title={t('jobsDash.filesTitle')} onClick={() => setShowFiles((p) => toggleIn(p, j.jobId))}>
                                                {filesOpen ? t('jobsDash.hideFiles') : `📄 ${t('jobsDash.files')}`}
                                              </button>
                                            )}
                                            {active && (
                                              <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => cancelJobRow(j.jobId)}>
                                                {t('jobsDash.cancel')}
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                        {valuesOpen && hasValues && (
                                          <tr>
                                            <td colSpan={6} style={{ padding: '4px 0 10px 18px' }}>
                                              <table style={{ fontSize: 11 }}>
                                                <tbody>
                                                  {Object.entries(j.values || {}).map(([k, v]) => (
                                                    <tr key={k}>
                                                      <td style={{ color: 'var(--c-text-secondary)', paddingRight: 12 }}>{fieldLabel(j, k)}</td>
                                                      <td style={{ fontWeight: 600, paddingRight: 12 }}>{String(v)}</td>
                                                      <td style={{ color: 'var(--c-text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                                                        {sourceCell(j, k)}
                                                      </td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </td>
                                          </tr>
                                        )}
                                        {logOpen && (
                                          <tr>
                                            <td colSpan={6} style={{ padding: '4px 0 10px 18px' }}>
                                              <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto', margin: 0, color: 'var(--c-text-secondary)' }}>
                                                {(j.logs || []).slice(-30).join('\n')}
                                              </pre>
                                            </td>
                                          </tr>
                                        )}
                                        {filesOpen && filesList(j, 6, 18)}
                                      </Fragment>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </>
                            )
                          })()}
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

      {/* ── Estrazioni singole (fuori batch), di tutti gli utenti ─────────────
          Il DB le ha sempre conservate (PDF compresi): qui si vedono, si
          esportano, si rilanciano — anche le COMPLETATE (rielaborazione col
          motore corrente sugli stessi file). */}
      <h2 style={{ fontSize: 15, margin: '26px 0 8px' }}>{t('jobsDash.singlesTitle')}</h2>
      {singles === null && <p style={{ fontSize: 13 }}><span className="spinner" /></p>}
      {singles !== null && singles.length === 0 && (
        <div className="card" style={{ padding: 18, textAlign: 'center', color: 'var(--c-text-muted)', fontSize: 13 }}>
          {t('jobsDash.singlesEmpty')}
        </div>
      )}
      {singles !== null && singles.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            {/* Le run di TEST si mostrano SOTTO il loro job sorgente (indentate,
                badge 🧪) così le varianti si confrontano a colpo d'occhio; un
                test il cui sorgente sta in un batch resta riga normale. */}
            <thead>
              <tr>
                <th style={{ padding: '10px 14px' }}>{t('jobsDash.dossierName')}</th>
                <th style={{ padding: '10px 14px' }}>{t('jobsDash.colOwner')}</th>
                <th style={{ padding: '10px 14px' }}>{t('jobsDash.dossierStatus')}</th>
                <th style={{ padding: '10px 14px' }}>{t('jobsDash.dossierFields')}</th>
                <th style={{ padding: '10px 14px' }}>{t('jobsDash.colDate')}</th>
                <th style={{ padding: '10px 14px', textAlign: 'right' }}>{t('jobsDash.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const byId = new Set(singles.map((x) => x.jobId))
                const testsOf = new Map<string, JobSnapshot[]>()
                for (const x of singles) {
                  if (x.sourceJobId && byId.has(x.sourceJobId)) {
                    const arr = testsOf.get(x.sourceJobId) || []
                    arr.push(x)
                    testsOf.set(x.sourceJobId, arr)
                  }
                }
                const ordered: JobSnapshot[] = []
                for (const x of singles) {
                  if (x.sourceJobId && byId.has(x.sourceJobId)) continue
                  ordered.push(x)
                  for (const tst of testsOf.get(x.jobId) || []) ordered.push(tst)
                }
                return ordered
              })().map((j) => {
                const active = j.status === 'running' || j.status === 'queued'
                const failed = j.status === 'error'
                const reusable = !!j.duplicateOf && (j.status === 'queued' || j.status === 'error' || j.status === 'canceled')
                const hasValues = Object.keys(j.values || {}).length > 0
                const valuesOpen = showValues.has(j.jobId)
                const logOpen = showLog.has(j.jobId)
                const filesOpen = showFiles.has(j.jobId)
                // Nome STABILE: primo file in ordine alfabetico — l'ordine di upload
                // del browser cambia da run a run e lo stesso fascicolo appariva con
                // nomi diversi ("quietanza 2012 (+44)" vs "eulip … polizza (+44)").
                const sortedFiles = [...(j.scannedFiles || [])].sort((a, b) => a.localeCompare(b))
                const name = j.dossierName || (sortedFiles.length
                  ? `${sortedFiles[0]}${sortedFiles.length > 1 ? ` (+${sortedFiles.length - 1})` : ''}`
                  : j.jobId.slice(0, 8))
                const isTest = !!j.sourceJobId
                return (
                  <Fragment key={j.jobId}>
                    <tr>
                      <td style={{ padding: '8px 14px', fontSize: 12, ...(isTest ? { paddingLeft: 32 } : {}) }}>
                        {hasValues && (
                          <button type="button" onClick={() => setShowValues((p) => toggleIn(p, j.jobId))} title={t('jobsDash.showValues')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-secondary)', fontSize: 11, padding: 0, marginRight: 6, width: 12 }}>
                            {valuesOpen ? '▾' : '▸'}
                          </button>
                        )}
                        {isTest && (
                          <span title={t('jobsDash.testBadge')} style={{ fontSize: 10, fontWeight: 700, color: 'var(--c-info)', marginRight: 6 }}>🧪</span>
                        )}
                        {name}
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--c-text-secondary)' }}>{j.owner || ''}</td>
                      <td style={{ padding: '8px 14px', fontSize: 12, color: statusColor(j.status === 'canceled' ? 'error' : j.status) }}>
                        {isDiscarded(j) ? t('jobsDash.statusDiscarded') : isSetAside(j) ? t('jobsDash.statusSetAside') : statusLabel(j.status === 'canceled' ? 'error' : j.status)}
                        {j.error ? <span title={j.error}>{` — ${j.error.slice(0, 120)}`}</span> : ''}
                        {precheckLines(j, 160)}
                        {!!j.duplicateOf && (
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--c-text-secondary)' }}>
                            ⧉ {t('jobsDash.duplicateOf')}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '8px 14px', fontSize: 12 }}>{Object.keys(j.values || {}).length}</td>
                      <td style={{ padding: '8px 14px', fontSize: 12, color: 'var(--c-text-muted)' }}>{j.updatedAt ? fmtDate(j.updatedAt) : ''}</td>
                      <td style={{ padding: '8px 14px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {failed && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} disabled={busy} onClick={() => retryJobRow(j.jobId)}>
                            ↻ {t('jobsDash.retry')}
                          </button>
                        )}
                        {j.status === 'matched' && (
                          <button className="btn btn-primary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6, fontWeight: 700 }} disabled={busy}
                            title={t('jobsDash.extractTitle')} onClick={() => extractJobRow(j.jobId)}>
                            ▶ {t('jobsDash.extract')}
                          </button>
                        )}
                        {(j.status === 'mismatch' || j.status === 'review') && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6, color: 'var(--c-warning, #d97706)', fontWeight: 700 }} disabled={busy}
                            title={j.status === 'review' ? t('jobsDash.proceedReviewTitle') : t('jobsDash.proceedTitle')} onClick={() => proceedJobRow(j.jobId)}>
                            ▶ {t('jobsDash.proceedAnyway')}
                          </button>
                        )}
                        {!active && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} disabled={busy}
                            title={t('jobsDash.rematchTitle')} onClick={() => openDialog('rematch', [j])}>
                            🔁 {t('jobsDash.rematch')}
                          </button>
                        )}
                        {(j.status === 'done' || j.status === 'canceled' || j.status === 'mismatch' || j.status === 'review' || j.status === 'matched') && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} disabled={busy}
                            title={t('jobsDash.reprocessTitle')} onClick={() => retryJobRow(j.jobId)}>
                            ↻ {t('jobsDash.reprocess')}
                          </button>
                        )}
                        {['done', 'error', 'canceled', 'mismatch', 'review', 'matched'].includes(j.status) && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} disabled={busy}
                            title={t('jobsDash.reprocessWithProfileTitle')} onClick={() => openDialog('reprofile', [j])}>
                            ⇄ {t('jobsDash.reprocessWithProfile')}
                          </button>
                        )}
                        {(j.status === 'done' || j.status === 'error') && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} disabled={busy}
                            title={t('jobsDash.testTitle')} onClick={() => openDialog('test', [j])}>
                            🧪 {t('jobsDash.test')}
                          </button>
                        )}
                        {reusable && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} disabled={busy}
                            title={t('jobsDash.reuseTitle')} onClick={() => reuseJobRow(j.jobId)}>
                            ⧉ {t('jobsDash.reuse')}
                          </button>
                        )}
                        {hasValues && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} onClick={() => exportJobExcel(j)}>
                            ⬇ Excel
                          </button>
                        )}
                        {(j.logs?.length || 0) > 0 && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }} onClick={() => setShowLog((p) => toggleIn(p, j.jobId))}>
                            {logOpen ? t('jobsDash.hideLog') : 'Log'}
                          </button>
                        )}
                        {(j.scannedFiles?.length || 0) > 0 && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px', marginRight: 6 }}
                            title={t('jobsDash.filesTitle')} onClick={() => setShowFiles((p) => toggleIn(p, j.jobId))}>
                            {filesOpen ? t('jobsDash.hideFiles') : `📄 ${t('jobsDash.files')}`}
                          </button>
                        )}
                        {active && (
                          <button className="btn btn-secondary" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => cancelJobRow(j.jobId)}>
                            {t('jobsDash.cancel')}
                          </button>
                        )}
                      </td>
                    </tr>
                    {valuesOpen && hasValues && (
                      <tr>
                        <td colSpan={6} style={{ padding: '4px 14px 10px 32px' }}>
                          <table style={{ fontSize: 11 }}>
                            <tbody>
                              {Object.entries(j.values || {}).map(([k, v]) => (
                                <tr key={k}>
                                  <td style={{ color: 'var(--c-text-secondary)', paddingRight: 12 }}>{fieldLabel(j, k)}</td>
                                  <td style={{ fontWeight: 600, paddingRight: 12 }}>{String(v)}</td>
                                  <td style={{ color: 'var(--c-text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                                    {sourceCell(j, k)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                    {logOpen && (
                      <tr>
                        <td colSpan={6} style={{ padding: '4px 14px 10px 32px' }}>
                          <pre style={{ fontSize: 10, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto', margin: 0, color: 'var(--c-text-secondary)' }}>
                            {(j.logs || []).slice(-30).join('\n')}
                          </pre>
                        </td>
                      </tr>
                    )}
                    {filesOpen && filesList(j, 6, 32)}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Dialog universale di rilancio: run di TEST (copia, profilo opzionale)
          oppure RIELABORA CON PROFILO (singolo o batch: lo stesso job torna in
          coda coi field_defs del profilo scelto). ── */}
      {dial && (() => {
        const { mode, jobs } = dial
        const n = jobs.length
        const isBatch = mode === 'reprofileBatch' || mode === 'rematchBatch'
        const isRematch = mode === 'rematch' || mode === 'rematchBatch'
        const title = isRematch
          ? (isBatch ? t('jobsDash.rematchBatchDialogTitle', { n }) : t('jobsDash.rematchDialogTitle'))
          : mode === 'test'
            ? t('jobsDash.testDialogTitle')
            : isBatch
              ? t('jobsDash.reprofileBatchDialogTitle', { n })
              : t('jobsDash.reprofileDialogTitle')
        const hint = isRematch
          ? t('jobsDash.rematchDialogHint')
          : mode === 'test'
            ? t('jobsDash.testDialogHint')
            : isBatch
              ? t('jobsDash.reprofileBatchDialogHint')
              : t('jobsDash.reprofileDialogHint')
        const startLabel = isRematch
          ? (isBatch ? t('jobsDash.rematchStartBatch', { n }) : t('jobsDash.rematchStart'))
          : isBatch ? t('jobsDash.reprofileStartBatch', { n }) : (mode === 'test' ? t('jobsDash.testStart') : t('jobsDash.reprofileStart'))
        const icon = isRematch ? '🔁' : mode === 'test' ? '🧪' : '⇄'
        return (
          <div onClick={() => setDial(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: '92vw', padding: 20 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{icon} {title}</h3>
              <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginBottom: 14 }}>
                {isBatch ? `${n} job — ` : `${jobs[0].dossierName || jobs[0].jobId.slice(0, 8)} — `}{hint}
              </p>
              <div className="form-group">
                <label className="label">{t('jobsDash.testProfile')}{!isRematch && (isBatch || mode === 'reprofile') ? ' *' : ''}</label>
                <select value={testProfileId} onChange={(e) => setTestProfileId(e.target.value)} style={{ width: '100%' }}>
                  <option value="">{isRematch ? t('jobsDash.rematchProfileCurrent') : mode === 'test' ? t('jobsDash.testProfileFrozen') : t('jobsDash.testProfileFrozenHint')}</option>
                  {isRematch && <option value="auto">{t('jobsDash.rematchProfileAuto')}</option>}
                  {testProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {!isRematch && (<>
              <div className="form-group">
                <label className="label">{t('jobsDash.testModel')}</label>
                <input list="test-models" value={testModel} onChange={(e) => setTestModel(e.target.value)}
                  placeholder={t('jobsDash.testModelPlaceholder')} style={{ width: '100%' }} />
                <datalist id="test-models">
                  {testModels.map((m) => <option key={m} value={m} />)}
                </datalist>
              </div>
              <div className="form-group">
                <label className="label">{t('jobsDash.testStrategy')}</label>
                <select value={testStrategy} onChange={(e) => setTestStrategy(e.target.value)} style={{ width: '100%' }}>
                  <option value="">{t('jobsDash.testStrategyCurrent')}</option>
                  <option value="perfield">{t('jobsDash.testStrategyPerField')}</option>
                  <option value="groups">{t('jobsDash.testStrategyGroups')}</option>
                  <option value="cascade">{t('jobsDash.testStrategyCascade')}</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">{t('jobsDash.testPrompt')}</label>
                <textarea value={testPrompt} onChange={(e) => setTestPrompt(e.target.value)} rows={3} style={{ width: '100%', fontSize: 12 }} />
              </div>
              </>)}
              {reprofileError && <p style={{ fontSize: 11, color: 'var(--c-error)', margin: '0 0 10px' }}>{reprofileError}</p>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setDial(null)}>{t('jobsDash.testCancel')}</button>
                <button className="btn btn-primary" style={{ fontSize: 12 }} disabled={busy} onClick={submitDialog}>▶ {startLabel}</button>
              </div>
            </div>
          </div>
        )
      })()}
      {confirmPanel}
    </div>
  )
}
