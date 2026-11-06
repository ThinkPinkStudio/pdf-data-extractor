import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { getConfig, saveConfig, getNextNumber, setNextNumber } from '@/lib/infortuni/store'

export const runtime = 'nodejs'

// Configurazione della sezione (opzioni, premi, polizza, email) e prossimo numero di adesione.
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ config: await getConfig(), nextNumber: await getNextNumber() })
}

export async function PUT(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { config?: unknown; nextNumber?: string }
  try {
    const config = body.config ? await saveConfig(body.config) : await getConfig()
    const cur = await getNextNumber()
    const nextNumber = body.nextNumber && body.nextNumber.trim() !== cur ? await setNextNumber(body.nextNumber) : cur
    await logAction({ email: session.email, action: 'infortuni.config.save', metadata: { nextNumber } })
    return NextResponse.json({ config, nextNumber })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
