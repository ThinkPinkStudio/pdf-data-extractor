import { NextRequest, NextResponse } from 'next/server'
import { createToken } from '@/lib/tokens'
import { sendMagicLink } from '@/lib/mailer'
import { isAllowedEmail } from '@/lib/auth'
import { logAction } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined

  let email: string
  try {
    const body = await req.json()
    email = (body.email ?? '').toLowerCase().trim()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Email non valida' }, { status: 400 })
  }

  if (!isAllowedEmail(email)) {
    logAction({ email, action: 'auth.send_link', success: false, ip, userAgent, metadata: { reason: 'not_allowed' } })
    // Return 200 anyway to avoid email enumeration
    return NextResponse.json({ ok: true })
  }

  const token = createToken(email)

  try {
    await sendMagicLink(email, token)
    logAction({ email, action: 'auth.send_link', success: true, ip, userAgent })
  } catch (err) {
    logAction({ email, action: 'auth.send_link', success: false, ip, userAgent, metadata: { error: String(err) } })
    return NextResponse.json({ error: 'Errore invio email' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
