import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getBatchRow, listBatchPdfEntries, getJobFilePdfBytes } from '@/lib/polizzaJobStore'
import { batchZipFileName, planBatchZip } from '@/lib/polizzaBatchZip'
import { zipStoreStream } from '@/lib/zipStream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ZIP con TUTTI i PDF originali del batch, divisi nelle cartelle di origine
// ("Cartella/Polizza/documento.pdf"): è la richiesta "ridammi i file come sono
// online" senza aprire i dossier uno per uno.
//
// Streaming vero: i PDF si leggono dal database UNO ALLA VOLTA e finiscono
// subito nella risposta. Un batch può pesare gigabyte e questo processo è lo
// stesso che fa girare OCR e worker LLM — caricare tutto in memoria per poi
// impacchettarlo lo farebbe morire di OOM.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Lavoro condiviso: nessun controllo di proprietà (come le altre route batch).
  const batch = await getBatchRow(params.id)
  if (!batch) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const entries = await listBatchPdfEntries(params.id)
  if (!entries.length) return NextResponse.json({ error: 'Nessun PDF nel batch' }, { status: 404 })
  const planned = planBatchZip(batch.label, entries)

  await logAction({
    email: session.email,
    action: 'polizza.batch.pdfs',
    resource: `${batch.label} (${planned.length} PDF)`,
  })

  async function* pdfEntries() {
    for (const f of planned) {
      const data = await getJobFilePdfBytes(f.filesJobId, f.idx)
      if (!data) continue // riga sparita nel frattempo: meglio lo ZIP senza che un errore a metà
      yield { name: f.path, data, date: new Date((f.createdAt || 0) * 1000) }
    }
  }

  const chunks = zipStoreStream(pdfEntries())
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await chunks.next()
      if (done) controller.close()
      else controller.enqueue(new Uint8Array(value))
    },
    cancel() { void chunks.return?.(undefined) }, // download annullato: si smette di leggere dal DB
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${batchZipFileName(batch.label)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
