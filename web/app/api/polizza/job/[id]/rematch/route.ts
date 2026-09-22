import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getSettings } from '@/lib/settingsStore'
import { getJob, resetJobForRetry, type JobRow } from '@/lib/polizzaJobStore'
import { startJob } from '@/lib/polizzaJobWorker'
import { startBatch } from '@/lib/polizzaBatchWorker'

export const runtime = 'nodejs'

// "RIABBINA": rifà SOLO l'abbinamento di un job (OCR dalla cache + pertinenza)
// e si ferma in 'matched' / 'review' / 'mismatch', senza estrarre. Body
// { profileId?: string }: assente = profilo attuale del job; 'auto' =
// riconoscimento automatico del profilo; altrimenti il profilo scelto (campi
// congelati sostituiti). L'estrazione parte poi col ▶ (route /extract).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await getJob(params.id)
  if (!job) return NextResponse.json({ error: 'Job non trovato' }, { status: 404 })

  let body: { profileId?: string | null } = {}
  try { body = await req.json() } catch { /* body vuoto = stesso profilo */ }

  let opts: Parameters<typeof resetJobForRetry>[2] = { matchOnly: true }
  let label = job.profile_name || 'profilo attuale'
  if (body.profileId === 'auto') {
    opts = { fieldDefs: [] as JobRow['field_defs'], promptExtra: null, profileId: 'auto', profileName: 'Automatico (semantico)', matchOnly: true }
    label = 'Automatico'
  } else if (body.profileId) {
    const settings = await getSettings()
    const profile = (settings.polizzaProfiles || []).find((p) => p.id === body.profileId) || null
    if (!profile) return NextResponse.json({ error: 'Profilo non trovato' }, { status: 400 })
    const fieldDefs = (profile.fields || []).filter((f) => f.enabled !== false)
      .map((f) => ({ id: f.id, label: f.label, description: f.description, type: f.type, sheet: f.sheet }))
    if (!fieldDefs.length) return NextResponse.json({ error: `Il profilo "${profile.name}" non ha campi abilitati` }, { status: 400 })
    opts = { fieldDefs, promptExtra: profile.promptExtra || null, profileId: profile.id, profileName: profile.name, matchOnly: true }
    label = profile.name
  }

  const updated = await resetJobForRetry(params.id, session.email, opts)
  if (!updated) return NextResponse.json({ error: 'Job non riabbinabile (è ancora in esecuzione o in coda)' }, { status: 409 })

  if (updated.batch_id) startBatch(updated.batch_id)
  else startJob(updated.id)

  await logAction({ email: session.email, action: 'polizza.job.rematch', resource: `${job.dossier_name || job.id} → ${label}`, ip })
  return NextResponse.json({ ok: true })
}
