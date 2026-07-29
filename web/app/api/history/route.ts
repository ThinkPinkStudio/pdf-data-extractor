import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { pool } from '@/lib/db'
import { logAction } from '@/lib/logger'

// GET: elenco sessioni di TUTTI gli utenti (lavoro condiviso). L'email è il
// proprietario, mostrato nell'interfaccia. Senza il PDF.
export async function GET() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { rows } = await pool.query(
    'SELECT id, email, file_name, num_pages, created_at FROM sessions ORDER BY id DESC LIMIT 200'
  )
  return NextResponse.json({ sessions: rows })
}

// POST: salva una sessione (PDF + dati estratti + chat)
export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const form = await req.formData().catch(() => null)
  const pdf = form?.get('pdf')
  const meta = JSON.parse((form?.get('meta') as string) || '{}')
  if (!(pdf instanceof File)) return NextResponse.json({ error: 'PDF mancante' }, { status: 400 })

  const pdfBase64 = Buffer.from(await pdf.arrayBuffer()).toString('base64')
  const { rows } = await pool.query(
    'INSERT INTO sessions (email, file_name, num_pages, pdf_base64, meta) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [session.email, meta.fileName || pdf.name, meta.numPages || 0, pdfBase64, JSON.stringify({ fields: meta.fields ?? null, chat: meta.chat ?? [] })]
  )
  await logAction({ email: session.email, action: 'history.save', resource: pdf.name })
  return NextResponse.json({ ok: true, id: rows[0].id })
}

// DELETE: svuota la cronologia. Anche in modalità condivisa, "svuota tutto" resta
// limitato alle PROPRIE sessioni: evita che un utente cancelli per sbaglio la
// cronologia di tutto il team. L'eliminazione della singola voce (route [id]) è
// invece consentita su qualunque sessione.
export async function DELETE() {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await pool.query('DELETE FROM sessions WHERE email = $1', [session.email])
  await logAction({ email: session.email, action: 'history.clear_all' })
  return NextResponse.json({ ok: true })
}
