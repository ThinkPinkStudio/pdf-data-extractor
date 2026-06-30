import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getPolizzaFields } from '@/lib/polizzaFields'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await getSession()
  if (!session.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const fields = await getPolizzaFields()
  return NextResponse.json(fields)
}
