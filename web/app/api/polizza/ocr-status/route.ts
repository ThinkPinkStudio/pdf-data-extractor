import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { ocrStatus } from '@/lib/polizzaService'

export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await ocrStatus())
}
