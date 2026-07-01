import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getActiveJob, jobSnapshot } from '@/lib/polizzaJobStore'

export const runtime = 'nodejs'

// Ultimo job dell'utente (running o recente), per l'auto-restore all'apertura pagina.
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const job = await getActiveJob(session.email)
  return NextResponse.json(job ? jobSnapshot(job) : { job: null })
}
