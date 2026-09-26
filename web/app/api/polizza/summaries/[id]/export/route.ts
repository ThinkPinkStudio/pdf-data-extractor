import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getSettings } from '@/lib/settingsStore'
import { loadDetail, summarySvc } from '@/lib/summaryStore'
import { exportLang, summaryFileName, summaryWorkbookBuffer } from '@/lib/summaryWorkbook'

export const runtime = 'nodejs'

// Excel del riepilogo: ?lang=it|en&a=<anno A>&b=<anno B>. Vista NON filtrata
// (tutti gli anni, tutti i gruppi, righe «Tutti i campi»), tutti i valori per
// polizza (values: 'all'). Fogli: Per anno, Polizze, Confronto A-B, Info.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const sp = req.nextUrl.searchParams
    const year = (v: string | null) => (v && /^\d{4}$/.test(v) ? Number(v) : undefined)
    const detail = await loadDetail(params.id, { yearA: year(sp.get('a')), yearB: year(sp.get('b')) }, { values: 'all', prefsOverride: { tableRows: 'all' } })
    if (!detail) return NextResponse.json({ error: 'Riepilogo non trovato', code: 'not-found' }, { status: 404 })
    const q = sp.get('lang')
    const lang = exportLang(q, q === 'it' || q === 'en' ? null : (await getSettings()).language)
    const svc = await summarySvc()
    const now = new Date()
    const buf = await summaryWorkbookBuffer({ detail, lang, svc, exportedAt: now })
    await logAction({ email: session.email, action: 'polizza.summary.export', resource: detail.summary.name, ip, metadata: { id: params.id, lang, policies: detail.policies.length } })
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${summaryFileName(detail.summary.name, now)}"`,
      },
    })
  } catch (e) {
    console.error('[riepiloghi] export:', e)
    return NextResponse.json({ error: 'Errore interno', code: 'internal' }, { status: 500 })
  }
}
