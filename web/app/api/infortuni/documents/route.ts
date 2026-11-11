import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getRecordsByIds, getConfig } from '@/lib/infortuni/store'
import { documentsZip } from '@/lib/infortuni/documents'

export const runtime = 'nodejs'
export const maxDuration = 300 // la stampa PDF con Chromium può richiedere tempo

// Certificato di adesione + questionario (PDF) delle adesioni indicate, in uno ZIP.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] }
  const rows = await getRecordsByIds(Array.isArray(body.ids) ? body.ids : [])
  if (!rows.length) return NextResponse.json({ error: 'Nessuna adesione selezionata', code: 'empty' }, { status: 400 })
  try {
    const zip = await documentsZip(rows.map((r) => r.data), await getConfig())
    const name = rows.length === 1 ? `Adesione ${rows[0].numero.replace(/\//g, '-')}.zip` : 'Adesioni infortuni.zip'
    return new Response(new Uint8Array(zip), {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"` },
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Errore nella creazione dei PDF', code: 'pdf' }, { status: 500 })
  }
}
