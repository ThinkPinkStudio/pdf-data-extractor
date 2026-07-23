import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getAdesioniConfig } from '@/lib/adesioni/serverConfig'
import { generateZip } from '@/lib/adesioni/generate'

export const runtime = 'nodejs'
export const maxDuration = 300 // il rendering PDF via Chromium può richiedere tempo

// Genera modulo .docx (+ PDF ad alta fedeltà) per ogni record e un tracciato .xlsx,
// impacchettati in uno ZIP scaricabile.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = (await req.json()) as { records?: Record<string, unknown>[]; pdf?: boolean }
    const records = Array.isArray(body.records) ? body.records : []
    if (!records.length) return NextResponse.json({ error: 'Nessun record da generare' }, { status: 400 })

    const config = await getAdesioniConfig()
    const zip = await generateZip(records, config, { pdf: body.pdf !== false })

    return new Response(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="adesioni.zip"',
      },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Errore generazione' }, { status: 500 })
  }
}
