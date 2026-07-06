import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'
import { importSharedService } from '@/lib/sharedServices'

interface VectorSvc {
  isVectorIndexEnabled: (s: unknown) => boolean
  searchVector: (args: { query: string; dossier?: string | null; docType?: string | null; year?: number | null; limit?: number }, s: unknown) => Promise<unknown[]>
  probeQdrant: (s: unknown) => Promise<{ available: boolean; reason?: string }>
}

// Stato dell'indice (per la pagina Archivio: mostra se Qdrant è configurato/raggiungibile)
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const settings = await getSettings()
  const vec = await importSharedService<VectorSvc>('vectorIndexService.js')
  if (!vec.isVectorIndexEnabled(settings)) return NextResponse.json({ enabled: false })
  const probe = await vec.probeQdrant(settings)
  return NextResponse.json({ enabled: true, ...probe })
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const query = String(body.query || '').trim()
  if (!query) return NextResponse.json({ success: false, error: 'query mancante' }, { status: 400 })

  const settings = await getSettings()
  const vec = await importSharedService<VectorSvc>('vectorIndexService.js')
  if (!vec.isVectorIndexEnabled(settings)) {
    return NextResponse.json({ success: false, error: 'Indice vettoriale non configurato: imposta l\'URL di Qdrant nelle Impostazioni.' }, { status: 400 })
  }
  try {
    const results = await vec.searchVector({
      query,
      dossier: body.dossier || null,
      docType: body.docType || null,
      year: body.year ? Number(body.year) : null,
      limit: body.limit ? Number(body.limit) : 10,
    }, settings)
    return NextResponse.json({ success: true, results })
  } catch (err) {
    return NextResponse.json({ success: false, error: (err as Error).message }, { status: 500 })
  }
}
