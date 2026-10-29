import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { searchJobs } from '@/lib/polizzaJobStore'

export const runtime = 'nodejs'

// RICERCA GLOBALE delle polizze in TUTTI i batch (e nelle estrazioni singole):
// nome della cartella, nome del batch, nomi dei file, valori estratti (n°
// polizza, contraente, P.IVA…). Ogni parola della ricerca deve comparire.
export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) return NextResponse.json({ results: [] })
  const results = await searchJobs(q)
  return NextResponse.json({ results })
}
