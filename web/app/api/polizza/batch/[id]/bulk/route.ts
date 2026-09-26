import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getSettings } from '@/lib/settingsStore'
import { getBatch, getBatchRow, getJob, resetJobForRetry, reuseResultsFromJob, cancelJob, overridePrecheckAndRequeue, confirmMatchAndRequeue, createTestJob, markBatchNeedsReconcile, markBatchReconciled } from '@/lib/polizzaJobStore'
import { startBatch } from '@/lib/polizzaBatchWorker'
import { startJob } from '@/lib/polizzaJobWorker'
import { isNotValidJob, NOT_VALID_REFUSAL } from '@/lib/jobValidity'

export const runtime = 'nodejs'

// Azioni in BULK nella pagina Elaborazioni: applica l'azione scelta a una lista
// di jobId di un batch, riusando le logiche per-job esistenti (resetJobForRetry,
// reuseResultsFromJob, cancelJob, overridePrecheckAndRequeue, createTestJob,
// confirmMatchAndRequeue) con un unico startBatch alla fine.
// 'rematch': RIABBINA — rifà OCR (cache) e pertinenza e si ferma in 'matched';
//   profileId '' = profilo attuale del job, 'auto' = riconoscimento automatico,
//   altrimenti il profilo scelto. 'extract': ▶ sui job abbinati. Le azioni non applicabili a un dato stato vengono
// saltate: la risposta riporta quanti job sono stati eseguiti e quanti saltati.
// I «Non valido» (nessuna polizza, regola dell'utente del 26/09/2026) non si
// forzano mai: 'proceed', 'extract' e 'reuse' li contano a parte (`notValid`,
// `notValidIds`, con il perché in `notValidReason`); rematch/retry/reprofile/
// test restano permessi perché rifanno il controllo, polizza compresa.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const batch = await getBatchRow(params.id)
  if (!batch) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: {
    action?: string
    jobIds?: string[]
    profileId?: string | null
    model?: string
    perField?: boolean
    stagedCascade?: boolean
    promptExtra?: string
    // Riabbina + estrai in un colpo solo (action 'rematch'): niente sosta in 'matched'.
    extract?: boolean
    // Riabbina di un batch GIÀ CARICATO con riconciliazione (action 'rematch'):
    // prima si uniscono i dossier con lo stesso NUMERO DI POLIZZA (stesse regole
    // dei batch nuovi, polizzaReconcile), poi l'abbinamento.
    reconcile?: boolean
  } = {}
  try { body = await req.json() } catch { /* body vuoto = nessuna azione */ }

  const action = body.action || ''
  const wantsAuto = body.profileId === 'auto'
  const jobIds = Array.isArray(body.jobIds) ? [...new Set(body.jobIds.map(String))].filter(Boolean) : []
  if (!action) return NextResponse.json({ error: 'Azione mancante' }, { status: 400 })
  if (!jobIds.length) return NextResponse.json({ error: 'Nessun job selezionato' }, { status: 400 })

  // I job devono appartenere davvero a questo batch (lo stato forte sono i jobId).
  const batchData = await getBatch(params.id)
  if (!batchData) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const owned = new Set(batchData.jobs.map((j) => j.id))
  const targets = jobIds.filter((id) => owned.has(id))
  if (!targets.length) return NextResponse.json({ error: 'Nessun job valido per questo batch' }, { status: 400 })

  const settings = await getSettings()
  // Risoluzione del profilo (per le azioni che lo richiedono): autoritativa lato
  // server, come nel route /reprofile e /test.
  const profile = body.profileId && !wantsAuto
    ? (settings.polizzaProfiles || []).find((p) => p.id === body.profileId) || null
    : null
  // Le azioni "rielabora con profilo" richiedono un profilo: risolto in modo
  // autoritativo lato server (come nel route /reprofile e /test).
  const needsProfile = action === 'reprofile' || action === 'reprofileBatch'
    // Riabbina CON un profilo scelto (profileId ≠ auto/vuoto): il profilo deve esistere,
    // come nel route /rematch — niente ripiego silenzioso sul profilo attuale.
    || (action === 'rematch' && !!body.profileId && !wantsAuto)
  if (needsProfile && !profile) {
    return NextResponse.json({ error: 'Profilo non trovato' }, { status: 400 })
  }
  const profileFields = profile
    ? (profile.fields || []).filter((f) => f.enabled !== false)
        .map((f) => ({ id: f.id, label: f.label, description: f.description, type: f.type, sheet: f.sheet }))
    : null
  if (needsProfile && profileFields && !profileFields.length) {
    return NextResponse.json({ error: `Il profilo "${profile?.name}" non ha campi abilitati` }, { status: 400 })
  }

  // Override SOLO whitelisted (stessa lista del worker e del route /test).
  const settingsOverride: Record<string, unknown> = {}
  const model = (body.model || '').trim()
  if (model) { settingsOverride.ollamaModel = model; settingsOverride.polizzaWholeDossierModel = model }
  if (typeof body.stagedCascade === 'boolean') settingsOverride.polizzaStagedCascade = body.stagedCascade
  if (typeof body.perField === 'boolean') settingsOverride.polizzaPerField = body.perField
  const override = Object.keys(settingsOverride).length ? settingsOverride : null

  // RICONCILIA (batch caricati prima del 25/09, o da rifare): la riconciliazione
  // gira sui dossier IN CODA prima che l'orchestratore li elabori e annulla tutto
  // se un dossier coinvolto non è più in coda. Con un job del batch già in corso
  // l'orchestratore è partito e non la farebbe: si rifiuta.
  const reconcile = action === 'rematch' && body.reconcile === true
  if (reconcile) {
    const active = batchData.jobs.filter((j) => j.status === 'running' || j.status === 'queued')
    if (active.length) {
      return NextResponse.json({ error: `Riconciliazione non avviata: ${active.length} dossier del batch sono in corso o in coda. Riprova quando hanno finito.` }, { status: 409 })
    }
    await markBatchNeedsReconcile(params.id)
  }

  let done = 0
  let skipped = 0
  const skippedIds: string[] = []
  let notValid = 0
  const notValidIds: string[] = []

  for (const id of targets) {
    const job = await getJob(id)
    if (!job) { skipped++; skippedIds.push(id); continue }
    if ((action === 'proceed' || action === 'extract' || action === 'reuse') && isNotValidJob(job)) {
      notValid++; notValidIds.push(id); continue
    }

    if (action === 'retry' || action === 'reprocess') {
      // Rielabora: stesso campo del job, azzera pre-check. Vale per errori, annullati
      // e completati.
      const res = await resetJobForRetry(id, session.email)
      if (res) done++; else { skipped++; skippedIds.push(id) }
    } else if (action === 'reprofile' || action === 'reprofileBatch') {
      // Rielabora con profilo: sostituisce i field_defs congelati.
      if (!profile || !profileFields) { skipped++; skippedIds.push(id); continue }
      const res = await resetJobForRetry(id, session.email, {
        fieldDefs: profileFields, promptExtra: body.promptExtra !== undefined ? (body.promptExtra || null) : (profile.promptExtra || null),
        profileId: profile.id, profileName: profile.name, settingsOverride: override,
      })
      if (res) done++; else { skipped++; skippedIds.push(id) }
    } else if (action === 'reuse') {
      const res = await reuseResultsFromJob(id, session.email)
      if (res) done++; else { skipped++; skippedIds.push(id) }
    } else if (action === 'proceed') {
      const res = await overridePrecheckAndRequeue(id, session.email)
      if (res) done++; else { skipped++; skippedIds.push(id) }
    } else if (action === 'extract') {
      const res = await confirmMatchAndRequeue(id, session.email)
      if (res) done++; else { skipped++; skippedIds.push(id) }
    } else if (action === 'rematch') {
      // Riabbina: stesso profilo (nessun profileId), Automatico ('auto': campi
      // congelati dal worker sul profilo riconosciuto) o un profilo scelto.
      const opts = wantsAuto
        ? { fieldDefs: [] as typeof job.field_defs, promptExtra: null, profileId: 'auto', profileName: 'Automatico (semantico)', matchOnly: true }
        : profile && profileFields
          ? { fieldDefs: profileFields, promptExtra: profile.promptExtra || null, profileId: profile.id, profileName: profile.name, matchOnly: true }
          : { matchOnly: true }
      const res = await resetJobForRetry(id, session.email, body.extract === true ? { ...opts, matchOnly: false, andExtract: true } : opts)
      if (res) done++; else { skipped++; skippedIds.push(id) }
    } else if (action === 'cancel') {
      const res = await cancelJob(id)
      if (res) done++; else { skipped++; skippedIds.push(id) }
    } else if (action === 'test') {
      // Run di TEST: crea una COPIA per ciascun job selezionato, profilo opzionale.
      const srcFieldDefs = profile ? (profileFields || (job.field_defs || [])) : (job.field_defs || [])
      if (!srcFieldDefs.length) { skipped++; skippedIds.push(id); continue }
      const res = await createTestJob({
        sourceJobId: job.id, email: session.email, fieldDefs: srcFieldDefs,
        promptExtra: body.promptExtra !== undefined ? (body.promptExtra || null) : (profile ? (profile.promptExtra || null) : job.prompt_extra || null),
        settingsOverride: override || {}, label: `TEST · ${job.dossier_name || job.id.slice(0, 8)}${model ? ` · ${model}` : ''}`,
        ...(profile ? { profileId: profile.id, profileName: profile.name } : {}),
      })
      if (res) { done++; startJob(res.id) } else { skipped++; skippedIds.push(id) }
    } else {
      return NextResponse.json({ error: `Azione non riconosciuta: ${action}` }, { status: 400 })
    }
  }

  // Nessun dossier rimesso in coda: la riconciliazione accesa resterebbe in
  // sospeso per un rilancio futuro qualsiasi.
  if (reconcile && done === 0) await markBatchReconciled(params.id)
  // Ripartenza dell'orchestratore: un solo startBatch per i job rilanciati del batch.
  if (done > 0) startBatch(params.id)

  await logAction({
    email: session.email, action: `polizza.batch.bulk.${action}${reconcile ? '.reconcile' : ''}`,
    resource: `${batch.label} (${done}/${targets.length}${skipped ? `, ${skipped} saltati` : ''}${notValid ? `, ${notValid} non validi` : ''})`, ip,
  })
  return NextResponse.json({
    ok: true, action, done, skipped, requested: targets.length, skippedIds,
    notValid, notValidIds, ...(notValid ? { notValidReason: NOT_VALID_REFUSAL } : {}),
  })
}
