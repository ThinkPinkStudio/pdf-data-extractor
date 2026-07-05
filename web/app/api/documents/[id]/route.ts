import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getDocument, getDocumentPages } from '@/lib/corpusStore'

export const runtime = 'nodejs'

// Dettaglio di un documento del corpus (metadati + testo per pagina), usato dal
// drawer "vedi fonte" della chat.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const doc = await getDocument(params.id)
  if (!doc || doc.email !== session.email) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const pages = await getDocumentPages(params.id)
  return NextResponse.json({
    id: doc.id,
    fileName: doc.file_name,
    numPages: doc.num_pages,
    textStatus: doc.text_status,
    agenzia: doc.agenzia,
    gruppo: doc.gruppo,
    societa: doc.societa,
    statoVigore: doc.stato_vigore,
    uso: doc.uso,
    ramo: doc.ramo,
    docType: doc.doc_type,
    anno: doc.anno,
    createdAt: doc.created_at,
    pages,
  })
}
