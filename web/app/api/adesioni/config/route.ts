import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { getAdesioniConfig } from '@/lib/adesioni/serverConfig'

export const runtime = 'nodejs'

// Restituisce la configurazione risolta (campi, questionario, prezzi, offset date)
// con i default applicati. Usata dal form Adesioni.
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const config = await getAdesioniConfig()
  return NextResponse.json(config)
}
