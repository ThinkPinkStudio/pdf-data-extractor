import { NextRequest, NextResponse } from 'next/server'
import { getPublicOrigin } from '@/lib/publicUrl'

// Avvia il login con account condiviso (SSO): reindirizza l'utente alla pagina
// di login del release-distributor (identity provider), in stile OAuth. La
// password viene inserita solo lì; questa app riceve poi un codice monouso.

const RELEASE_DISTRIBUTOR_URL = (
  process.env.RELEASE_DISTRIBUTOR_URL || 'https://downloads.thinkpinkstudio.it'
).replace(/\/+$/, '')

const CLIENT_ID = 'pdf-data-extractor-web'

function safeNext(next: string | null): string | null {
  // Solo path relativi interni (evita open-redirect: no "//host", no schemi).
  if (next && next.startsWith('/') && !next.startsWith('//')) return next
  return null
}

export async function GET(req: NextRequest) {
  const state = crypto.randomUUID()
  const redirectUri = `${getPublicOrigin(req)}/api/auth/sso-callback`

  const authorizeUrl = new URL(`${RELEASE_DISTRIBUTOR_URL}/identity/authorize`)
  authorizeUrl.searchParams.set('client_id', CLIENT_ID)
  authorizeUrl.searchParams.set('redirect_uri', redirectUri)
  authorizeUrl.searchParams.set('state', state)

  const res = NextResponse.redirect(authorizeUrl)
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600, // 10 minuti per completare il login
  }
  res.cookies.set('sso_state', state, cookieOpts)

  const next = safeNext(req.nextUrl.searchParams.get('next'))
  if (next) res.cookies.set('sso_next', next, cookieOpts)

  return res
}
