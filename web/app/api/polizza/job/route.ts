import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getFieldsAndMapping } from '@/lib/polizzaService'
import { initRollingState } from '@/lib/polizzaRolling'
import { createJob, listSingleJobs, jobSnapshot } from '@/lib/polizzaJobStore'
import { startJob } from '@/lib/polizzaJobWorker'

export const runtime = 'nodejs'

// Elenco delle estrazioni SINGOLE (fuori batch) di TUTTI gli utenti: il database
// le conserva già tutte (PDF compresi) — questa è la vista che le rende visibili
// e rilanciabili dalla pagina Elaborazioni. Lavoro condiviso, come i batch.
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const jobs = await listSingleJobs()
  return NextResponse.json({ jobs: jobs.map(jobSnapshot) })
}

// Avvia un job di estrazione lato server: i PDF vengono salvati su Postgres e
// l'elaborazione (render + OCR/AI-vision) prosegue in background, indipendente
// dal browser. Il client riceve un jobId e fa polling su /api/polizza/job/[id].
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let formData: FormData
  try { formData = await req.formData() } catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }

  const pdfFiles = formData.getAll('pdf').filter((f): f is File => f instanceof File)
  if (pdfFiles.length === 0) return NextResponse.json({ error: 'Nessun file PDF' }, { status: 400 })

  const names = pdfFiles.map((f) => f.name).join(', ')
  await logAction({ email: session.email, action: 'polizza.job.start', resource: names, ip, userAgent })

  try {
    const { fields, wholeDossier } = await getFieldsAndMapping()
    const fieldDefs = (fields || []).map((f) => ({ id: f.id, label: f.label, description: f.description, type: f.type, sheet: f.sheet }))
    const rollingState = initRollingState(fieldDefs)

    const inputFiles = await Promise.all(pdfFiles.map(async (f) => ({
      file_name: f.name,
      pdf_base64: Buffer.from(await f.arrayBuffer()).toString('base64'),
    })))

    const jobId = await createJob({
      email: session.email,
      wholeDossier: !!wholeDossier,
      scannedFiles: pdfFiles.map((f) => f.name),
      fieldDefs,
      rollingState,
      files: inputFiles,
    })

    startJob(jobId) // fire-and-forget: continua anche a tab chiusa
    return NextResponse.json({ jobId })
  } catch (err) {
    await logAction({ email: session.email, action: 'polizza.job.error', resource: names, success: false, ip, userAgent, metadata: { error: String(err) } })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
