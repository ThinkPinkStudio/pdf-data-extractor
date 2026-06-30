import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getFieldsAndMapping } from '@/lib/polizzaService'

export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { fields, defaultMapping } = await getFieldsAndMapping()
  return NextResponse.json({ fields, defaultMapping })
}
