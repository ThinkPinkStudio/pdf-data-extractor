import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { createResetToken } from '@/lib/tokens'
import { sendPasswordResetEmail } from '@/lib/mailer'
import { isAllowedDomain } from '@/lib/auth'
import { logAction } from '@/lib/logger'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined

  let email: string
  try {
    const body = await req.json()
    email = (body.email ?? '').toLowerCase().trim()
  } catch {
    return NextResponse.json({ ok: true })
  }

  if (!email || !EMAIL_RE.test(email)) {
    // Sempre 200 con esito ok: non rivelare se l'email esiste o no.
    return NextResponse.json({ ok: true })
  }

  if (!isAllowedDomain(email)) {
    return NextResponse.json({ ok: true })
  }

  const { rows } = await pool.query<{ id: number }>(
    'SELECT id FROM users WHERE email = $1',
    [email]
  )
  if (rows.length === 0) {
    return NextResponse.json({ ok: true })
  }

  try {
    const token = await createResetToken(email)
    await sendPasswordResetEmail(email, token)
    await logAction({ email, action: 'auth.forgot', success: true, ip, userAgent })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    await logAction({ email, action: 'auth.forgot', success: false, ip, userAgent, metadata: { error: detail } })
    // Strumento interno: se l'invio della posta fallisce, l'utente deve sapere
    // che NON gli è arrivato nulla, altrimenti resta bloccato fuori.
    return NextResponse.json({ error: 'Invio email non riuscito', detail }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}