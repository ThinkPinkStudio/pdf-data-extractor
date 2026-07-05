import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { corpusFacets } from '@/lib/corpusSearch'
import { pool } from '@/lib/db'

export const runtime = 'nodejs'

// Valori distinti per i filtri della chat + conteggio documenti in memoria.
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const facets = await corpusFacets(session.email)
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM documents WHERE email = $1`, [session.email]
  )
  return NextResponse.json({ ...facets, totalDocuments: parseInt(rows[0]?.n || '0', 10) })
}
