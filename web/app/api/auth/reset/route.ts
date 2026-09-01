import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { verifyResetToken } from '@/lib/tokens'
import { hashPassword, MIN_PASSWORD_LENGTH } from '@/lib/auth'
import { logAction } from '@/lib/logger'

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined

  let token: string
  let password: string
  try {
    const body = await req.json()
    token = String(body.token ?? '')
    password = String(body.password ?? '')
  } catch {
    return jsonError('Richiesta non valida')
  }

  if (!token) return jsonError('Link non valido o già utilizzato')

  const result = await verifyResetToken(token)
  if (!result.ok) {
    await logAction({ action: 'auth.reset', success: false, ip, userAgent, metadata: { reason: result.reason } })
    return jsonError('Link non valido o già utilizzato', 400)
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return jsonError(`La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri`)
  }

  const passwordHash = hashPassword(password)
  await pool.query(
    'UPDATE users SET password_hash = $1 WHERE email = $2',
    [passwordHash, result.email]
  )

  await logAction({ email: result.email, action: 'auth.reset', success: true, ip, userAgent })

  return NextResponse.json({ ok: true })
}