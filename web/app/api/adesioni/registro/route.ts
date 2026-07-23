import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { pool } from '@/lib/db'

export const runtime = 'nodejs'

// Registro: azioni CSA Adesioni dell'utente corrente (riusa action_logs).
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rows } = await pool.query<{
    id: number
    timestamp: string
    action: string
    resource: string | null
    metadata: string | null
    success: boolean
  }>(
    `SELECT id, timestamp, action, resource, metadata, success
     FROM action_logs WHERE email = $1 AND action LIKE 'adesioni.%' ORDER BY id DESC LIMIT 500`,
    [session.email]
  )
  return NextResponse.json({ logs: rows })
}
