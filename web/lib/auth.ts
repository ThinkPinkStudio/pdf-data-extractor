import { getIronSession, sealData, unsealData, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'
import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies'

export interface SessionData {
  email: string
  loginAt: number
}

export const SESSION_OPTIONS: SessionOptions = {
  cookieName: 'pdf_extractor_session',
  password: process.env.SESSION_SECRET || 'change-me-32-chars-minimum-secret!!',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: parseInt(process.env.SESSION_MAX_AGE_SECONDS || '604800', 10),
    httpOnly: true,
    sameSite: 'lax',
  },
}

const COOKIE_NAME = SESSION_OPTIONS.cookieName as string

/**
 * Read the session from the Next.js cookie store.
 * Returns a session-like object with a .save() method.
 */
export async function getSession(): Promise<SessionData & { save: () => Promise<void>; destroy: () => void }> {
  const cookieStore = await cookies()
  const raw = cookieStore.get(COOKIE_NAME)?.value

  let data: Partial<SessionData> = {}
  if (raw) {
    try {
      data = await unsealData<Partial<SessionData>>(raw, { password: SESSION_OPTIONS.password as string })
    } catch {
      data = {}
    }
  }

  const session = data as SessionData & { save: () => Promise<void>; destroy: () => void }

  session.save = async () => {
    const sealed = await sealData(
      { email: session.email, loginAt: session.loginAt },
      { password: SESSION_OPTIONS.password as string }
    )
    const maxAge = (SESSION_OPTIONS.cookieOptions?.maxAge as number) ?? 604800
    cookieStore.set(COOKIE_NAME, sealed, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge,
      path: '/',
    } as Partial<ResponseCookie>)
  }

  session.destroy = () => {
    cookieStore.set(COOKIE_NAME, '', { maxAge: 0, path: '/' } as Partial<ResponseCookie>)
  }

  return session
}

export function isAllowedEmail(email: string): boolean {
  const allowed = process.env.ALLOWED_EMAILS || '*'
  if (allowed === '*') return true
  return allowed
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .includes(email.toLowerCase())
}
