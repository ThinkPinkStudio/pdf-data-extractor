import { NextRequest, NextResponse } from 'next/server'
import { unsealData } from 'iron-session'
import { publicUrl } from '@/lib/publicUrl'

const COOKIE_NAME = 'pdf_extractor_session'
const SESSION_PASSWORD = process.env.SESSION_SECRET || 'change-me-32-chars-minimum-secret!!'

const PUBLIC_PATHS = [
  // Pagine pubbliche
  '/auth/login',
  '/auth/onboarding',
  '/auth/forgot',
  '/auth/reset',
  // API pubbliche (auth) + health
  '/api/auth',
  '/api/health',
]

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
    const loginUrl = publicUrl(req, '/auth/login')
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
