import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { getSession, isAllowedDomain } from '@/lib/auth'
import { logAction } from '@/lib/logger'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

// Accesso "sulla fiducia": basta un'email valida nel dominio autorizzato, nessuna
// password né verifica. Scelta deliberata del committente (accesso semplificato,
// sessione persistente). L'utente viene creato al volo nella tabella `users`
// (password_hash NULL) la prima volta che accede.
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined

  let email: string
  try {
    const body = await req.json()
    email = (body.email ?? '').toLowerCase().trim()
  } catch {
    return jsonError('Richiesta non valida')
  }

  if (!email || !EMAIL_RE.test(email)) {
    return jsonError('Email non valida')
  }

  if (!isAllowedDomain(email)) {
    await logAction({ email, action: 'auth.login', success: false, ip, userAgent, metadata: { reason: 'domain' } })
    return jsonError('Dominio email non autorizzato', 403)
  }

  // Upsert: crea l'utente al primo accesso, non tocca password_hash se esiste già.
  try {
    await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, NULL)
       ON CONFLICT (email) DO NOTHING`,
      [email]
    )
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    await logAction({ email, action: 'auth.login', success: false, ip, userAgent, metadata: { reason: 'upsert', error: detail } })
    return jsonError('Errore durante l\'accesso', 500)
  }

  const session = await getSession()
  session.email = email
  session.loginAt = Date.now()
  await session.save()

  await logAction({ email, action: 'auth.login', success: true, ip, userAgent })

  return NextResponse.json({ ok: true, email })
}