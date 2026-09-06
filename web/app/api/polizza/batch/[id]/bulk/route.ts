import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getSettings } from '@/lib/settingsStore'
import { getBatch, getBatchRow, getJob, resetJobForRetry, reuseResultsFromJob, cancelJob, overridePrecheckAndRequeue, createTestJob } from '@/lib/polizzaJobStore'
import { startBatch } from '@/lib/polizzaBatchWorker'
import { startJob } from '@/lib/polizzaJobWorker'

export const runtime = 'nodejs'

// Azioni in BULK nella pagina Elaborazioni: applica l'azione scelta a una lista
// di jobId di un batch, riusando le logiche per-job esistenti (resetJobForRetry,
// reuseResultsFromJob, cancelJob, overridePrecheckAndRequeue, createTestJob) con
// un unico startBatch alla fine. Le azioni non applicabili a un dato stato vengono
// saltate: la risposta riporta quanti job sono stati eseguiti e quanti saltati.
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
  } = {}
  try { body = await req.json() } catch { /* body vuoto = nessuna azione */ }

  const action = body.action || ''
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
  const profile = body.profileId
    ? (settings.polizzaProfiles || []).find((p) => p.id === body.profileId) || null
    : null
  // Le azioni "rielabora con profilo" richiedono un profilo: risolto in modo
  // autoritativo lato server (come nel route /reprofile e /test).
  const needsProfile = action === 'reprofile' || action === 'reprofileBatch'
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

  let done = 0
  let skipped = 0
  const skippedIds: string[] = []

  for (const id of targets) {
    const job = await getJob(id)
    if (!job) { skipped++; skippedIds.push(id); continue }

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
      })
      if (res) { done++; startJob(res.id) } else { skipped++; skippedIds.push(id) }
    } else {
      return NextResponse.json({ error: `Azione non riconosciuta: ${action}` }, { status: 400 })
    }
  }

  // Ripartenza dell'orchestratore: un solo startBatch per i job rilanciati del batch.
  if (done > 0) startBatch(params.id)

  await logAction({
    email: session.email, action: `polizza.batch.bulk.${action}`,
    resource: `${batch.label} (${done}/${targets.length}${skipped ? `, ${skipped} saltati` : ''})`, ip,
  })
  return NextResponse.json({ ok: true, action, done, skipped, requested: targets.length, skippedIds })
}
