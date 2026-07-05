import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getJob, updateJob, jobSnapshot } from '@/lib/polizzaJobStore'
import { startJob } from '@/lib/polizzaJobWorker'
import { getSettings } from '@/lib/settingsStore'
import { initRollingState } from '@/lib/polizzaRolling'
import { getJobDocuments } from '@/lib/corpusStore'

export const runtime = 'nodejs'

// Ri-estrae un job SENZA ricaricare i file, opzionalmente con un altro profilo
// salvato ({ profileId }). Fast path: se il testo di tutti i documenti è già
// nel corpus, l'estrazione riparte dal testo persistito (una sola chiamata LLM,
// zero OCR); altrimenti ri-elabora i PDF già salvati in polizza_job_files.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await getJob(params.id)
  if (!job || job.email !== session.email) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (job.status === 'running' || job.status === 'queued') {
    return NextResponse.json({ error: 'Job già in esecuzione' }, { status: 409 })
  }

  let body: { profileId?: string | null } = {}
  try { body = await req.json() } catch { /* body opzionale */ }

  const patch: Record<string, unknown> = {
    cursor: {},
    progress: {},
    sources: {},
    error: null,
    status: 'queued',
  }

  // Cambio profilo esplicito: i campi del profilo scelto sostituiscono i field_defs.
  let fieldDefs = job.field_defs
  if (body.profileId) {
    const settings = await getSettings()
    const profile = (settings.polizzaProfiles || []).find((p) => p.id === body.profileId)
    if (!profile) return NextResponse.json({ error: 'Profilo non trovato tra quelli salvati' }, { status: 400 })
    const enabled = (profile.fields || []).filter((f) => f.enabled !== false)
    if (enabled.length === 0) return NextResponse.json({ error: 'Il profilo scelto non ha campi attivi' }, { status: 400 })
    fieldDefs = enabled.map((f) => ({ id: f.id, label: f.label, description: f.description, sheet: f.sheet }))
    patch.field_defs = fieldDefs
    patch.profile_id = profile.id
    patch.profile_locked = true
  }
  patch.rolling_state = initRollingState(fieldDefs)

  // Fast path se il testo di tutti i documenti collegati è completo nel corpus.
  let fromText = false
  try {
    const docs = await getJobDocuments(job.id)
    fromText = docs.length > 0 && docs.every((d) => d.text_status === 'complete')
  } catch { fromText = false }
  patch.rerun_from_text = fromText

  await updateJob(job.id, patch)
  await logAction({
    email: session.email, action: 'polizza.job.rerun',
    resource: `${job.dossier_name || job.id}${body.profileId ? ` → profilo ${body.profileId}` : ''}${fromText ? ' (da testo)' : ' (da PDF)'}`,
    ip, userAgent,
  })

  startJob(job.id)
  const updated = await getJob(job.id)
  return NextResponse.json({ ok: true, fromText, job: updated ? jobSnapshot(updated) : null })
}
