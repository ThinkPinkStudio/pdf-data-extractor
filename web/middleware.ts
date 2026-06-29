import { NextRequest, NextResponse } from 'next/server'
import { unsealData } from 'iron-session'

const COOKIE_NAME = 'pdf_extractor_session'
const SESSION_PASSWORD = process.env.SESSION_SECRET || 'change-me-32-chars-minimum-secret!!'

const PUBLIC_PATHS = ['/auth/login', '/auth/verify', '/api/auth/send-link', '/api/auth/verify', '/api/health']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  if (isPublic || pathname.startsWith('/_next') || pathname.startsWith('/favicon')) {
    return NextResponse.next()
  }

  const raw = req.cookies.get(COOKIE_NAME)?.value
  let email: string | undefined

  if (raw) {
    try {
      const data = await unsealData<{ email?: string }>(raw, { password: SESSION_PASSWORD })
      email = data.email
    } catch {
      email = undefined
    }
  }

  if (!email) {
    const loginUrl = new URL('/auth/login', req.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
