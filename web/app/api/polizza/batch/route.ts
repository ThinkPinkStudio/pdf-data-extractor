import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getFieldsAndMapping } from '@/lib/polizzaService'
import { createBatch, listBatches, type JobInputFile } from '@/lib/polizzaJobStore'
import { startBatch } from '@/lib/polizzaBatchWorker'

export const runtime = 'nodejs'

// Avvia un batch: il client carica ricorsivamente un'intera cartella (webkitdirectory),
// il percorso relativo di ogni file individua a quale sottocartella/polizza appartiene.
// I PDF vengono raggruppati per dossier e salvati come N job polizza collegati allo
// stesso batch, elaborati in sequenza da polizzaBatchWorker (fire-and-forget).
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let formData: FormData
  try { formData = await req.formData() } catch { return NextResponse.json({ error: 'Invalid form data' }, { status: 400 }) }

  const pdfFiles = formData.getAll('pdf').filter((f): f is File => f instanceof File)
  const relPaths = formData.getAll('path').map((p) => String(p))
  const label = String(formData.get('label') || 'Cartella')
  if (pdfFiles.length === 0) return NextResponse.json({ error: 'Nessun file PDF' }, { status: 400 })
  if (relPaths.length !== pdfFiles.length) return NextResponse.json({ error: 'Percorsi relativi mancanti o incompleti' }, { status: 400 })

  await logAction({ email: session.email, action: 'polizza.batch.start', resource: `${label} (${pdfFiles.length} file)`, ip, userAgent })

  try {
    const { fields, wholeDossier } = await getFieldsAndMapping()
    const fieldDefs = (fields || []).map((f) => ({ id: f.id, label: f.label, description: f.description, sheet: f.sheet }))

    // Il secondo segmento del percorso relativo (BancaA/PolizzaX/doc.pdf → "PolizzaX")
    // identifica il dossier; i file annidati più in profondità restano nello stesso
    // dossier. I file caricati direttamente nella radice (senza sottocartella)
    // finiscono in un dossier unico "(radice)".
    const entries = await Promise.all(pdfFiles.map(async (f, i) => {
      const segments = relPaths[i].split('/').filter(Boolean)
      const dossierName = segments.length >= 3 ? segments[1] : '(radice)'
      const file: JobInputFile = { file_name: f.name, pdf_base64: Buffer.from(await f.arrayBuffer()).toString('base64') }
      return { dossierName, file }
    }))

    const groups = new Map<string, JobInputFile[]>()
    for (const e of entries) {
      if (!groups.has(e.dossierName)) groups.set(e.dossierName, [])
      groups.get(e.dossierName)!.push(e.file)
    }
    const items = Array.from(groups.entries()).map(([dossierName, files]) => ({ dossierName, files }))

    const { batchId } = await createBatch({ email: session.email, label, wholeDossier: !!wholeDossier, fieldDefs, items })

    startBatch(batchId) // fire-and-forget: continua anche a tab chiusa
    return NextResponse.json({ batchId, dossierCount: items.length, fileCount: pdfFiles.length })
  } catch (err) {
    await logAction({ email: session.email, action: 'polizza.batch.error', resource: label, success: false, ip, userAgent, metadata: { error: String(err) } })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Elenco dei batch dell'utente (con conteggio stati aggregati dei job figli), per
// la dashboard "torno più tardi a controllare".
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const batches = await listBatches(session.email)
  return NextResponse.json({ batches })
}
