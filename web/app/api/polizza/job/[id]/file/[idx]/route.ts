import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getJobFile } from '@/lib/polizzaJobStore'

export const runtime = 'nodejs'

// Serve il PDF ORIGINALE di un job (per verifica manuale dei valori estratti:
// le fonti citano file+pagina, il link apre l'originale alla pagina giusta).
// Content-Disposition INLINE è obbligatorio: il frammento #page=N funziona solo
// nel viewer nativo del browser, non su un download.
// Lavoro condiviso: nessun controllo di proprietà (come le altre route job).
export async function GET(_req: NextRequest, { params }: { params: { id: string; idx: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const idx = Number.parseInt(params.idx, 10)
  if (!Number.isInteger(idx) || idx < 0) return NextResponse.json({ error: 'Indice non valido' }, { status: 400 })

  const file = await getJobFile(params.id, idx)
  if (!file?.pdf_base64) return NextResponse.json({ error: 'File non trovato' }, { status: 404 })

  // Nome sanificato per l'header (niente virgolette/controlli/non-ASCII: il
  // nome vero resta visibile nella pagina, qui serve solo un filename valido).
  const safeName = (file.file_name || 'documento.pdf').replace(/[^\x20-\x7e]+/g, '_').replace(/"/g, "'")
  return new NextResponse(Buffer.from(file.pdf_base64, 'base64'), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${safeName}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
