import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getSession, hashPassword, isAllowedDomain, MIN_PASSWORD_LENGTH } from '@/lib/auth'
import { logAction } from '@/lib/logger'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined

  let email: string
  let password: string
  try {
    const body = await req.json()
    email = (body.email ?? '').toLowerCase().trim()
    password = String(body.password ?? '')
  } catch {
    return jsonError('Richiesta non valida')
  }

  if (!email || !EMAIL_RE.test(email)) return jsonError('Email non valida')
  if (!isAllowedDomain(email)) {
    await logAction({ email, action: 'auth.onboarding', success: false, ip, userAgent, metadata: { reason: 'domain' } })
    return jsonError('Dominio email non autorizzato', 403)
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return jsonError(`La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri`)
  }

  // Onboarding one-time: se esiste già un account per questa email, si torna al
  // login (niente rivelazione accidentale di account esistenti all'inserimento).
  const { rows } = await pool.query<{ id: number }>(
    'SELECT id FROM users WHERE email = $1',
    [email]
  )
  if (rows.length > 0) {
    return jsonError('Esiste già un account per questa email', 409)
  }

  const passwordHash = hashPassword(password)
  try {
    await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2)',
      [email, passwordHash]
    )
  } catch (err) {
    // Race di inserimento concorrente: l'account esiste già → equivalente a 409.
    await logAction({ email, action: 'auth.onboarding', success: false, ip, userAgent, metadata: { reason: 'duplicate' } })
    return jsonError('Esiste già un account per questa email', 409)
  }

  const session = await getSession()
  session.email = email
  session.loginAt = Date.now()
  await session.save()

  await logAction({ email, action: 'auth.onboarding', success: true, ip, userAgent })

  return NextResponse.json({ ok: true, email })
}