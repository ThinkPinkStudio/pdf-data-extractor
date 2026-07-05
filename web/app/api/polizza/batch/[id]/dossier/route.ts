import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getFieldsAndMapping } from '@/lib/polizzaService'
import { getBatchRow, addDossierToBatch, type JobInputFile } from '@/lib/polizzaJobStore'
import { startBatch } from '@/lib/polizzaBatchWorker'
import { isExcludedPath } from '@/lib/bulkExclusions'
import { getSettings } from '@/lib/settingsStore'
import { prepareCorpusFiles, linkCorpusFilesToJob } from '@/lib/corpusIngest'

export const runtime = 'nodejs'

// Carica UN dossier (sottocartella) di un batch già inizializzato. Riapplica il
// filtro cartelle/file esclusi anche qui (difesa in profondità, non ci si fida del
// solo filtro client) e avvia/mantiene attivo l'orchestratore del batch: il primo
// dossier può iniziare l'elaborazione mentre i successivi sono ancora in upload.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const batch = await getBatchRow(params.id)
  if (!batch || batch.email !== session.email) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (batch.upload_complete) return NextResponse.json({ error: 'Batch già chiuso' }, { status: 409 })

  let formData: FormData
  try { formData = await req.formData() } catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }

  const pdfFiles = formData.getAll('pdf').filter((f): f is File => f instanceof File)
  const relPaths = formData.getAll('path').map((p) => String(p))
  const dossierName = String(formData.get('dossierName') || 'Polizza')
  if (pdfFiles.length === 0 || relPaths.length !== pdfFiles.length) {
    return NextResponse.json({ error: 'File o percorsi mancanti' }, { status: 400 })
  }

  const settings = await getSettings()
  const extra = new Set((settings.bulkExcludedFolderNames || '').split(',').map((s) => s.trim()).filter(Boolean))
  const kept: { file: File; relPath: string }[] = []
  for (let i = 0; i < pdfFiles.length; i++) {
    if (!isExcludedPath(relPaths[i], extra)) kept.push({ file: pdfFiles[i], relPath: relPaths[i] })
  }
  if (kept.length === 0) return NextResponse.json({ error: 'Nessun file valido dopo il filtro esclusioni' }, { status: 400 })

  await logAction({ email: session.email, action: 'polizza.batch.dossier', resource: `${batch.label}/${dossierName} (${kept.length} file)`, ip, userAgent })

  try {
    const { fields, wholeDossier } = await getFieldsAndMapping()
    const fieldDefs = (fields || []).map((f) => ({ id: f.id, label: f.label, description: f.description, sheet: f.sheet }))
    // Corpus: dedup sha256 + metadati dal percorso relativo (gruppo/società/ramo…).
    const files: JobInputFile[] = await prepareCorpusFiles(
      session.email,
      await Promise.all(kept.map(async (k) => ({
        name: k.file.name,
        buffer: Buffer.from(await k.file.arrayBuffer()),
        relPath: k.relPath,
      })))
    )

    const jobId = await addDossierToBatch({
      batchId: params.id, email: session.email, wholeDossier: !!wholeDossier, fieldDefs, dossierName, files,
    })
    await linkCorpusFilesToJob(jobId, params.id, files)

    startBatch(params.id) // idempotente: avvia/mantiene l'orchestratore del batch
    return NextResponse.json({ jobId })
  } catch (err) {
    await logAction({ email: session.email, action: 'polizza.batch.dossier.error', resource: dossierName, success: false, ip, userAgent, metadata: { error: String(err) } })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
