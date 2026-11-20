import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getRecordsByIds, pendingRecords, markSent, getConfig } from '@/lib/infortuni/store'
import { buildBdx, bdxFileName } from '@/lib/infortuni/bdx'
import { sendBdx } from '@/lib/infortuni/mail'

export const runtime = 'nodejs'

// BDX delle inclusioni (Excel). { ids?, send? }: senza ids le adesioni ancora
// da inviare; send=false scarica il file, send=true lo manda per email ai
// destinatari delle Impostazioni e segna le adesioni come inviate.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { ids?: string[]; send?: boolean }
  const rows = Array.isArray(body.ids) && body.ids.length ? await getRecordsByIds(body.ids) : await pendingRecords()
  if (!rows.length) return NextResponse.json({ error: 'Nessuna adesione da inserire nel BDX', code: 'empty' }, { status: 400 })
  const config = await getConfig()
  const buffer = await buildBdx(rows.map((r) => r.data), config)
  const filename = bdxFileName()
  if (!body.send) {
    await logAction({ email: session.email, action: 'infortuni.bdx.download', metadata: { count: rows.length } })
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }
  try {
    const sent = await sendBdx({ config, file: { filename, content: buffer }, count: rows.length, user: session.email })
    await markSent(rows.map((r) => r.id), sent.to)
    await logAction({ email: session.email, action: 'infortuni.bdx.send', metadata: { count: rows.length, to: sent.to, cc: sent.cc } })
    return NextResponse.json({ ok: true, count: rows.length, to: sent.to, cc: sent.cc })
  } catch (e) {
    await logAction({ email: session.email, action: 'infortuni.bdx.send', success: false, metadata: { count: rows.length, error: (e as Error).message } })
    return NextResponse.json({ error: (e as Error).message, code: 'mail' }, { status: 502 })
  }
}
