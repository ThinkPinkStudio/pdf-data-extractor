import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { wholeDossier } from '@/lib/polizzaService'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { fullText } = await req.json().catch(() => ({}))
  if (!fullText) return NextResponse.json({ success: false, error: 'fullText mancante' }, { status: 400 })
  return NextResponse.json(await wholeDossier(fullText))
}
