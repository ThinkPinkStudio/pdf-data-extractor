import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getJob, updateJob, jobSnapshot } from '@/lib/polizzaJobStore'
import { getSettings } from '@/lib/settingsStore'

export const runtime = 'nodejs'

// Override manuale del profilo rilevato: imposta il profilo scelto e lo blocca
// (il rilevamento automatico non lo toccherà più). Non ri-estrae: per rifare
// l'estrazione con i campi del nuovo profilo usare POST .../rerun.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const job = await getJob(params.id)
  if (!job || job.email !== session.email) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: { profileId?: string | null }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const profileId = body.profileId ?? null
  if (profileId) {
    const settings = await getSettings()
    const profile = (settings.polizzaProfiles || []).find((p) => p.id === profileId)
    if (!profile) return NextResponse.json({ error: 'Profilo non trovato tra quelli salvati' }, { status: 400 })
  }

  await updateJob(job.id, { profile_id: profileId, profile_locked: true })
  const updated = await getJob(job.id)
  return NextResponse.json({ ok: true, job: updated ? jobSnapshot(updated) : null })
}
