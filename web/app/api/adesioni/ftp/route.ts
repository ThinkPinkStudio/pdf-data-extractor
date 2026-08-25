import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getAdesioniFullSettings } from '@/lib/adesioni/settingsWeb'
import { listRecords, getRecordsByIds } from '@/lib/adesioni/recordsStore'
import { writeTrackBuffer } from '@/lib/adesioni/xlsxTracciato'
import { testFtp, uploadBufferToFtp } from '@/lib/adesioni/ftp'
import { resolveNotifyRecipients, sendExportSummary } from '@/lib/adesioni/mail'
import { trackExportFileName } from '@/lib/adesioni/tracciato.js'

export const runtime = 'nodejs'

// Pubblica il tracciato dei record selezionati su un profilo FTP (staging/prod),
// con notifica email opzionale. Con { test:true } verifica solo la connessione.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { target?: 'staging' | 'prod'; ids?: string[]; test?: boolean; profile?: Record<string, unknown> }
  const target = body.target === 'prod' ? 'prod' : 'staging'
  const full = await getAdesioniFullSettings()
  const profile = full.ftp[target]

  try {
    if (body.test) {
      // Test coi valori correnti del form (se inviati): i segreti mascherati '***'
      // ricadono su quelli salvati, così si testa ciò che si vede a schermo.
      let testProfile = profile
      if (body.profile) {
        const merged = { ...profile, ...body.profile } as unknown as Record<string, unknown>
        const base = profile as unknown as Record<string, unknown>
        for (const k of ['pass', 'passphrase', 'privateKey']) if (merged[k] === '***') merged[k] = base[k]
        testProfile = merged as unknown as typeof profile
      }
      const res = await testFtp(testProfile)
      return NextResponse.json(res)
    }

    const rows = body.ids && body.ids.length ? await getRecordsByIds(body.ids) : await listRecords()
    const buffer = await writeTrackBuffer(rows.map((r) => r.data), full)
    // Legenda AXA I14: "{polizza}_{aaaammgg}.xlsx" (es. "191025_20251021.xlsx").
    const filename = trackExportFileName(full.fields)
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

    await logAction({ email: session.email, action: 'adesioni.ftp.upload', metadata: { target, count: rows.length, filename, remotePath: up.remotePath } })
    return NextResponse.json({ ok: true, remotePath: up.remotePath, filename, count: rows.length, notified })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Errore FTP' }, { status: 500 })
  }
}
