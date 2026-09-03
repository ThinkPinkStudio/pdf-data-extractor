import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getSettings } from '@/lib/settingsStore'
import { getJob, resetJobForRetry } from '@/lib/polizzaJobStore'
import { startJob } from '@/lib/polizzaJobWorker'
import { startBatch } from '@/lib/polizzaBatchWorker'

export const runtime = 'nodejs'

// "Rielabora con profilo": rilancia UN job SOSTITUENDO i field_defs congelati
// all'upload con quelli del profilo scelto (stessa risoluzione del profilo del
// route /test, autoritativa lato server). A differenza della run di TEST il job
// NON viene copiato: viene riportato in coda e riparte dall'orchestratore giusto.
// Se profileId è assente/sconosciuto → 400: il rilancio senza profilo è il
// pulsante "rielabora" esistente, non questo.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await getJob(params.id)
  if (!job) return NextResponse.json({ error: 'Job non trovato' }, { status: 404 })

  let body: { profileId?: string | null; model?: string; stagedCascade?: boolean; perField?: boolean; promptExtra?: string } = {}
  try { body = await req.json() } catch { /* body vuoto = nessun override */ }

  const settings = await getSettings()
  const profile = body.profileId
    ? (settings.polizzaProfiles || []).find((p) => p.id === body.profileId) || null
    : null
  if (!profile) return NextResponse.json({ error: 'Profilo non trovato' }, { status: 400 })
  const fieldDefs = (profile.fields || []).filter((f) => f.enabled !== false)
    .map((f) => ({ id: f.id, label: f.label, description: f.description, type: f.type, sheet: f.sheet }))
  if (!fieldDefs.length) return NextResponse.json({ error: `Il profilo "${profile.name}" non ha campi abilitati` }, { status: 400 })

  const promptExtra = body.promptExtra !== undefined ? (body.promptExtra || null) : (profile.promptExtra || null)

  // Override SOLO whitelisted (stessa lista del worker e del route /test):
  // modello su ENTRAMBE le chiavi, strategia via polizzaStagedCascade/polizzaPerField.
  const settingsOverride: Record<string, unknown> = {}
  const model = (body.model || '').trim()
  if (model) { settingsOverride.ollamaModel = model; settingsOverride.polizzaWholeDossierModel = model }
  if (typeof body.stagedCascade === 'boolean') settingsOverride.polizzaStagedCascade = body.stagedCascade
  if (typeof body.perField === 'boolean') settingsOverride.polizzaPerField = body.perField

  const updated = await resetJobForRetry(params.id, session.email, {
    fieldDefs,
    promptExtra,
    profileId: profile.id,
    profileName: profile.name,
    settingsOverride: Object.keys(settingsOverride).length ? settingsOverride : null,
  })
  if (!updated) {
    return NextResponse.json({ error: 'Job non rilanciabile (è ancora in esecuzione o in coda)' }, { status: 409 })
  }

  if (updated.batch_id) startBatch(updated.batch_id)
  else startJob(updated.id)

  await logAction({
    email: session.email, action: 'polizza.job.reprofile',
    resource: `${job.dossier_name || job.id} → profilo "${profile.name}"`, ip,
  })
  return NextResponse.json({ ok: true })
}