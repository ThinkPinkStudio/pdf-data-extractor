import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getAdesioniConfig } from '@/lib/adesioni/serverConfig'
import { getAdesioniFullSettings } from '@/lib/adesioni/settingsWeb'
import { listRecords, getRecordsByIds, archiveRecords } from '@/lib/adesioni/recordsStore'
import { writeTrackBuffer, appendTrackBuffer } from '@/lib/adesioni/xlsxTracciato'
import { resolveNotifyRecipients, sendExportSummary } from '@/lib/adesioni/mail'
import { v4 as uuidv4 } from 'uuid'

export const runtime = 'nodejs'

// Esporta il tracciato AXA dei record selezionati (archivio condiviso).
//  - JSON  { ids?, reexport? } → nuovo .xlsx; archivia i record (salvo reexport)
//  - multipart (file + ids)    → append in coda al file caricato
// Invia inoltre l'email di riepilogo (best-effort) se configurata.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const config = await getAdesioniConfig()
  const ct = req.headers.get('content-type') || ''
  // Identificativo del lotto di export (traccia su ogni record archiviato).
  const batchId = uuidv4()

  try {
    if (ct.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file')
      const ids = String(form.get('ids') || '').split(',').filter(Boolean)
      const reexport = String(form.get('reexport') || '') === 'true'
      if (!(file instanceof File)) return NextResponse.json({ error: 'File mancante' }, { status: 400 })
      const rows = ids.length ? await getRecordsByIds(ids) : await listRecords()
      const existing = Buffer.from(await file.arrayBuffer())
      const { buffer } = await appendTrackBuffer(rows.map((r) => r.data), existing, config)
      if (!reexport) await archiveRecords(rows.map((r) => r.id), batchId)
      await notify(session.email, buffer, rows.length, 'export-append')
      await logAction({ email: session.email, action: 'adesioni.export.append', metadata: { count: rows.length, reexport } })
      return xlsxResponse(buffer, 'tracciato_aggiornato.xlsx')
    }

    const body = (await req.json().catch(() => ({}))) as { ids?: string[]; reexport?: boolean }
    const rows = body.ids && body.ids.length ? await getRecordsByIds(body.ids) : await listRecords()
    const buffer = await writeTrackBuffer(rows.map((r) => r.data), config)
    if (!body.reexport) await archiveRecords(rows.map((r) => r.id), batchId)
    await notify(session.email, buffer, rows.length, 'export')
    await logAction({ email: session.email, action: 'adesioni.export.new', metadata: { count: rows.length, reexport: !!body.reexport } })
    return xlsxResponse(buffer, 'tracciato.xlsx')
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Errore export' }, { status: 500 })
  }
}

async function notify(userEmail: string, buffer: Buffer, count: number, kind: 'export' | 'export-append') {
  try {
    const full = await getAdesioniFullSettings()
    const recipients = resolveNotifyRecipients(userEmail, full.exportNotify)
    if (recipients && full.smtp.host) {
      await sendExportSummary({
        smtp: full.smtp, to: recipients.to, cc: recipients.cc, kind, count, user: userEmail,
        attachment: { filename: kind === 'export-append' ? 'tracciato_aggiornato.xlsx' : 'tracciato.xlsx', content: buffer },
      })
    }
  } catch { /* email best-effort: non blocca l'export */ }
}

function xlsxResponse(buffer: Buffer, filename: string) {
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
