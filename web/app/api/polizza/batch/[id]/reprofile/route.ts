import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getSettings } from '@/lib/settingsStore'
import { getBatch, getBatchRow, getJob, resetJobForRetry } from '@/lib/polizzaJobStore'
import { startBatch } from '@/lib/polizzaBatchWorker'

export const runtime = 'nodejs'

// "Rielabora N con profilo" (batch): rilancia i job scelti SOSTITUENDO i
// field_defs congelati all'upload con quelli del profilo selezionato — stessa
// risoluzione del profilo del route /test, autoritativa lato server. Lo stato
// forte è la lista jobId esplicita (vietato toccare job in esecuzione/coda:
// resetJobForRetry li rifiuta e il conteggio fatto lato client non li include).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const batch = await getBatchRow(params.id)
  if (!batch) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: {
    jobIds?: string[]; profileId?: string | null; model?: string;
    perField?: boolean; stagedCascade?: boolean; promptExtra?: string
  } = {}
  try { body = await req.json() } catch { /* body vuoto = nessun job */ }

  const jobIds = Array.isArray(body.jobIds) ? [...new Set(body.jobIds.map(String))].filter(Boolean) : []
  if (!jobIds.length) return NextResponse.json({ error: 'Nessun job selezionato' }, { status: 400 })

  const settings = await getSettings()
  const profile = body.profileId
    ? (settings.polizzaProfiles || []).find((p) => p.id === body.profileId) || null
    : null
  if (!profile) return NextResponse.json({ error: 'Profilo non trovato' }, { status: 400 })
  const fieldDefs = (profile.fields || []).filter((f) => f.enabled !== false)
    .map((f) => ({ id: f.id, label: f.label, description: f.description, type: f.type, sheet: f.sheet }))
  if (!fieldDefs.length) return NextResponse.json({ error: `Il profilo "${profile.name}" non ha campi abilitati` }, { status: 400 })

  const promptExtra = body.promptExtra !== undefined ? (body.promptExtra || null) : (profile.promptExtra || null)

  // Override SOLO whitelisted (stessa lista del worker e del route /test).
  const settingsOverride: Record<string, unknown> = {}
  const model = (body.model || '').trim()
  if (model) { settingsOverride.ollamaModel = model; settingsOverride.polizzaWholeDossierModel = model }
  if (typeof body.stagedCascade === 'boolean') settingsOverride.polizzaStagedCascade = body.stagedCascade
  if (typeof body.perField === 'boolean') settingsOverride.polizzaPerField = body.perField
  const override = Object.keys(settingsOverride).length ? settingsOverride : null

  // I job devono appartenere davvero a questo batch (lo stato forte sono i jobId).
  const batchData = await getBatch(params.id)
  if (!batchData) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const owned = new Set(batchData.jobs.map((j) => j.id))
  const targets = jobIds.filter((id) => owned.has(id))
  // Esistenza già garantita dall'appartenenza al batch; getJob per coerenza col
  // singolo (job cancellati tra la selezione e il submit → ignora, non 400).
  let reprofiled = 0
  for (const id of targets) {
    const j = await getJob(id)
    if (!j) continue
    if (await resetJobForRetry(id, session.email, {
      fieldDefs, promptExtra, profileId: profile.id, profileName: profile.name, settingsOverride: override,
    })) reprofiled++
  }

  // Ripartenza dell'orchestratore: un solo startBatch per tutti i job rilanciati.
  if (reprofiled > 0) startBatch(params.id)

  await logAction({
    email: session.email, action: 'polizza.batch.reprofile',
    resource: `${batch.label} (${reprofiled}/${jobIds.length} → profilo "${profile.name}")`, ip,
  })
  return NextResponse.json({ ok: true, reprofiled, requested: jobIds.length, profile: profile.name })
}