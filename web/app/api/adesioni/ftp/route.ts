import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getAdesioniFullSettings } from '@/lib/adesioni/settingsWeb'
import { listRecords, getRecordsByIds } from '@/lib/adesioni/recordsStore'
import { writeTrackBuffer } from '@/lib/adesioni/xlsxTracciato'
import { testFtp, uploadBufferToFtp } from '@/lib/adesioni/ftp'
import { resolveNotifyRecipients, sendExportSummary } from '@/lib/adesioni/mail'

export const runtime = 'nodejs'

// Pubblica il tracciato dei record selezionati su un profilo FTP (staging/prod),
// con notifica email opzionale. Con { test:true } verifica solo la connessione.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { target?: 'staging' | 'prod'; ids?: string[]; test?: boolean }
  const target = body.target === 'prod' ? 'prod' : 'staging'
  const full = await getAdesioniFullSettings()
  const profile = full.ftp[target]

  try {
    if (body.test) {
      const res = await testFtp(profile)
      return NextResponse.json(res)
    }

    const rows = body.ids && body.ids.length ? await getRecordsByIds(body.ids, session.email) : await listRecords(session.email)
    const buffer = await writeTrackBuffer(rows.map((r) => r.data), full)
    const filename = `tracciato_${target}.xlsx`
    const up = await uploadBufferToFtp(profile, buffer, filename)

    // Notifica email di riepilogo (best-effort).
    let notified: { to: string; cc: string | null } | null = null
    try {
      const recipients = resolveNotifyRecipients(session.email, full.exportNotify)
      if (recipients && full.smtp.host) {
        notified = await sendExportSummary({
          smtp: full.smtp, to: recipients.to, cc: recipients.cc, kind: 'ftp-upload',
          count: rows.length, env: target, remotePath: up.remotePath, user: session.email,
          attachment: { filename, content: buffer },
        })
      }
    } catch { /* email best-effort */ }

    await logAction({ email: session.email, action: 'adesioni.ftp.upload', metadata: { target, count: rows.length, remotePath: up.remotePath } })
    return NextResponse.json({ ok: true, remotePath: up.remotePath, count: rows.length, notified })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Errore FTP' }, { status: 500 })
  }
}
