import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getSettings } from '@/lib/settingsStore'

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = req.nextUrl.searchParams.get('url') || String((await getSettings()).doclingUrl || '')
  if (!url) return NextResponse.json({ connected: false, error: 'Docling non configurato' })
  try {
    const base = url.replace(/\/+$/, '')
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })
    const ok = res.ok
    let info: Record<string, unknown> = {}
    try { info = ok ? await res.json() : {} } catch { /* body non json */ }
    return NextResponse.json({ connected: ok, docling: info?.docling || null })
  } catch (err: any) {
    return NextResponse.json({ connected: false, error: String(err?.message || err) })
  }
}