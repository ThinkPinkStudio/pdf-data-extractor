import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { pool } from '@/lib/db'

// GET: sessione completa (con PDF base64 + dati + chat) per il ripristino
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Lavoro condiviso: qualunque utente autenticato può aprire una sessione.
  const { rows } = await pool.query(
    'SELECT id, file_name, num_pages, pdf_base64, meta FROM sessions WHERE id = $1',
    [params.id]
  )
  if (!rows.length) return NextResponse.json({ error: 'Non trovata' }, { status: 404 })
  const r = rows[0]
  return NextResponse.json({ id: r.id, fileName: r.file_name, numPages: r.num_pages, pdfBase64: r.pdf_base64, meta: r.meta })
}

// DELETE: elimina una sessione
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession()
  if (!session.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Lavoro condiviso: eliminazione della singola voce consentita a chiunque.
  await pool.query('DELETE FROM sessions WHERE id = $1', [params.id])
  return NextResponse.json({ ok: true })
}
