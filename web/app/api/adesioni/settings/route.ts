import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getAdesioniSettingsMasked, saveAdesioniSettings } from '@/lib/adesioni/settingsWeb'

export const runtime = 'nodejs'

export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await getAdesioniSettingsMasked())
}

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()
  await saveAdesioniSettings(body)
  await logAction({ email: session.email, action: 'adesioni.settings.save' })
  return NextResponse.json({ ok: true })
}
