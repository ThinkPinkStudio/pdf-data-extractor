import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { checkServiceToken } from '@/lib/serviceAuth'
import { createJob, markRunning, setProgress, setDone, setError } from '@/lib/extractJobs'
import { runExtraction, classifyError } from '@/lib/extractRunner'
import { buildSimpleXlsx } from '@/lib/simpleExcel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/extract-jobs — sottometti UNA polizza (1+ PDF dello stesso fascicolo).
// Ritorna subito { jobId }; l'estrazione prosegue in background nel processo.
export async function POST(req: NextRequest) {
  if (!checkServiceToken(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const files = form.getAll('pdf').filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return NextResponse.json({ error: 'Nessun PDF' }, { status: 400 })
  }

  const name =
    (form.get('name') as string | null)?.trim() ||
    files[0].name?.replace(/\.pdf$/i, '') ||
    'polizza'

  const job = createJob(name)

  // Fire-and-forget: la response torna subito, il lavoro continua nell'event loop.
  void processJob(job.jobId, files)

  return NextResponse.json({ jobId: job.jobId, status: job.status }, { status: 202 })
}

async function processJob(jobId: string, files: File[]): Promise<void> {
  markRunning(jobId)
  const dir = await mkdtemp(join(tmpdir(), 'extract-'))
  const paths: string[] = []
  try {
    for (const f of files) {
      const p = join(dir, `${randomUUID()}-${safeName(f.name)}`)
      await writeFile(p, Buffer.from(await f.arrayBuffer()))
      paths.push(p)
    }

    const { data } = await runExtraction(paths, (progress) => setProgress(jobId, progress))
    const xlsx = await buildSimpleXlsx(data)
    setDone(jobId, xlsx)
  } catch (err) {
    setError(jobId, classifyError(err))
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function safeName(n: string): string {
  return (n || 'file.pdf').replace(/[^\w.\-]+/g, '_').slice(0, 120)
}
