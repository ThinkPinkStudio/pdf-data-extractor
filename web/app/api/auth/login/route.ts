import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getSession, verifyPassword, MIN_PASSWORD_LENGTH } from '@/lib/auth'
import { logAction } from '@/lib/logger'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

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

  if (!email || !EMAIL_RE.test(email) || !password) {
    return NextResponse.json({ error: 'Email o password mancanti' }, { status: 400 })
  }

  const { rows } = await pool.query<{ password_hash: string | null }>(
    'SELECT password_hash FROM users WHERE email = $1',
    [email]
  )
  const hash = rows[0]?.password_hash ?? null

  if (!hash || !verifyPassword(password, hash)) {
    // Messaggio unico: nessuna enumerazione di account esistenti.
    await logAction({ email, action: 'auth.login', success: false, ip, userAgent, metadata: { reason: 'credentials' } })
    return jsonError('Email o password errati', 401)
  }

  const session = await getSession()
  session.email = email
  session.loginAt = Date.now()
  await session.save()

  await logAction({ email, action: 'auth.login', success: true, ip, userAgent })

  return NextResponse.json({ ok: true, email })
}