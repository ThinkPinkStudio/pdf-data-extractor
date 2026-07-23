import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { pool } from '@/lib/db'

export const runtime = 'nodejs'

// Registro: azioni CSA Adesioni dell'utente corrente (riusa action_logs).
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Registro CONDIVISO: azioni CSA Adesioni di tutti gli operatori.
  const { rows } = await pool.query<{
    id: number
    timestamp: string
    email: string | null
    action: string
    resource: string | null
    metadata: string | null
    success: boolean
  }>(
    `SELECT id, timestamp, email, action, resource, metadata, success
     FROM action_logs WHERE action LIKE 'adesioni.%' ORDER BY id DESC LIMIT 500`
  )
  return NextResponse.json({ logs: rows })
}
