import { NextRequest, NextResponse } from 'next/server'
import { getSession, isAllowedDomain } from '@/lib/auth'
import { logAction } from '@/lib/logger'
import { publicUrl } from '@/lib/publicUrl'

// Callback del login SSO: valida lo `state`, scambia il codice monouso con il
// release-distributor (server-to-server, la password non transita mai da qui),
// poi apre la sessione iron-session come fa /api/auth/verify per il magic link.

const RELEASE_DISTRIBUTOR_URL = (
  process.env.RELEASE_DISTRIBUTOR_URL || 'https://downloads.thinkpinkstudio.it'
).replace(/\/+$/, '')

const CLIENT_ID = 'pdf-data-extractor-web'

function fail(req: NextRequest, reason: string): NextResponse {
  const res = NextResponse.redirect(publicUrl(req, `/auth/login?error=${reason}`))
  res.cookies.set('sso_state', '', { maxAge: 0, path: '/' })
  res.cookies.set('sso_next', '', { maxAge: 0, path: '/' })
  return res
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') ?? 'unknown'
  const userAgent = req.headers.get('user-agent') ?? undefined

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const cookieState = req.cookies.get('sso_state')?.value

  // Validazione anti-CSRF: lo state deve combaciare col cookie httpOnly.
  if (!code || !state || !cookieState || state !== cookieState) {
    await logAction({ action: 'auth.verify', success: false, ip, userAgent, metadata: { reason: 'sso_state', method: 'sso' } })
    return fail(req, 'sso_state')
  }

  // Scambio del codice monouso con l'identity provider.
  let email: string | null = null
  try {
    const tokenUrl = new URL(`${RELEASE_DISTRIBUTOR_URL}/identity/token`)
    tokenUrl.searchParams.set('client_id', CLIENT_ID)
    tokenUrl.searchParams.set('code', code)
    const resp = await fetch(tokenUrl, { signal: AbortSignal.timeout(15000) })
    if (!resp.ok) return fail(req, 'sso_exchange')
    const data = await resp.json()
    email = data && typeof data.email === 'string' ? data.email.toLowerCase() : null
  } catch {
    return fail(req, 'sso_exchange')
  }

  if (!email) return fail(req, 'sso_exchange')

  // L'IdP autentica; l'autorizzazione (dominio) resta locale a questa app.
  if (!isAllowedDomain(email)) {
    await logAction({ email, action: 'auth.verify', success: false, ip, userAgent, metadata: { reason: 'domain', method: 'sso' } })
    return fail(req, 'domain')
  }

  const session = await getSession()
  session.email = email
  session.loginAt = Date.now()
  await session.save()

  await logAction({ email, action: 'auth.verify', success: true, ip, userAgent, metadata: { method: 'sso' } })

  const next = req.cookies.get('sso_next')?.value
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/extractor'
  const res = NextResponse.redirect(publicUrl(req, dest))
  res.cookies.set('sso_state', '', { maxAge: 0, path: '/' })
  res.cookies.set('sso_next', '', { maxAge: 0, path: '/' })
  return res
}
