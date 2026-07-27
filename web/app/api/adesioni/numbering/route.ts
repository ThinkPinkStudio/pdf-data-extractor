import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getNumbering, setNumbering } from '@/lib/adesioni/numberingStore'

export const runtime = 'nodejs'

// GET → { next }: prossimo identificativo suggerito (serie condivisa).
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await getNumbering())
}

// POST { next } → imposta il numero iniziale/suggerito della serie.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json()) as { next?: string }
  return NextResponse.json(await setNumbering(String(body.next ?? '')))
}
