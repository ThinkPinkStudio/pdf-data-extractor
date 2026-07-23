import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getAdesioniConfig } from '@/lib/adesioni/serverConfig'
import { listRecords, getRecordsByIds } from '@/lib/adesioni/recordsStore'
import { writeTrackBuffer, appendTrackBuffer } from '@/lib/adesioni/xlsxTracciato'

export const runtime = 'nodejs'

// Esporta il tracciato AXA dei record selezionati.
//  - JSON  { ids? }            → nuovo file .xlsx (tutti i record se ids assente)
//  - multipart (file + ids)    → append in coda al file caricato
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const config = await getAdesioniConfig()
  const ct = req.headers.get('content-type') || ''

  try {
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file')
      const ids = String(form.get('ids') || '').split(',').filter(Boolean)
      if (!(file instanceof File)) return NextResponse.json({ error: 'File mancante' }, { status: 400 })
      const rows = ids.length ? await getRecordsByIds(ids, session.email) : await listRecords(session.email)
      const existing = Buffer.from(await file.arrayBuffer())
      const { buffer } = await appendTrackBuffer(rows.map((r) => r.data), existing, config)
      await logAction({ email: session.email, action: 'adesioni.export.append', metadata: { count: rows.length } })
      return xlsxResponse(buffer, 'tracciato_aggiornato.xlsx')
    }

    const body = (await req.json().catch(() => ({}))) as { ids?: string[] }
    const rows = body.ids && body.ids.length ? await getRecordsByIds(body.ids, session.email) : await listRecords(session.email)
    const buffer = await writeTrackBuffer(rows.map((r) => r.data), config)
    await logAction({ email: session.email, action: 'adesioni.export.new', metadata: { count: rows.length } })
    return xlsxResponse(buffer, 'tracciato.xlsx')
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Errore export' }, { status: 500 })
  }
}

function xlsxResponse(buffer: Buffer, filename: string) {
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
