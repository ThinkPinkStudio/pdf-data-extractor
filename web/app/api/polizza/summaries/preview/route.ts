import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { previewSummary } from '@/lib/summaryStore'

export const runtime = 'nodejs'

// Anteprima del pannello «Nuovo riepilogo»: { jobIds } → profilo (chiave e
// nome), ammessi, rifiutati col motivo, campi DATA (tipo letto dal server,
// dalla descrizione: il client non deduce tipi) col numero di valori, «Anno da»
// e «Scadenza da» di default, e se le impostazioni sono ereditate dall'ultimo
// riepilogo dello stesso profilo. Nessuna scrittura. Il nome di default lo
// compone il client, nella lingua dell'utente.
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Richiesta non valida', code: 'bad-body' }, { status: 400 }) }
  try {
    const out = await previewSummary(body)
    if (!out.ok) return NextResponse.json(out.body, { status: out.status })
    return NextResponse.json(out.preview)
  } catch (e) {
    console.error('[riepiloghi] anteprima:', e)
    return NextResponse.json({ error: 'Errore interno', code: 'internal' }, { status: 500 })
  }
}
