import { getIronSession, sealData, unsealData, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'
import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies'

export interface SessionData {
  email: string
  loginAt: number
}

/**
 * Se il cookie di sessione deve avere il flag `Secure` (inviato solo su HTTPS).
 *
 * Default: attivo in produzione. MA in un deploy raggiungibile solo via IP/VPN
 * in HTTP puro (senza TLS) il browser scarterebbe un cookie `Secure`, causando
 * un loop infinito di login. In quel caso imposta `COOKIE_SECURE=false`.
 * Con `COOKIE_SECURE=true` lo forzi anche fuori produzione.
 */
export function cookieSecure(): boolean {
  const v = process.env.COOKIE_SECURE
  if (v !== undefined) return v === 'true'
  return process.env.NODE_ENV === 'production'
}

export const SESSION_OPTIONS: SessionOptions = {
  cookieName: 'pdf_extractor_session',
  password: process.env.SESSION_SECRET || 'change-me-32-chars-minimum-secret!!',
  cookieOptions: {
    secure: cookieSecure(),
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
      secure: cookieSecure(),
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

/**
 * Verifica che il dominio dell'email sia tra quelli autorizzati.
 *
 * Parità con l'app desktop (authService.domainAllowed): il controllo è
 * **fail-closed**. Se né `ALLOWED_DOMAINS` né `ACCEPTED_DOMAINS` (nome usato
 * dall'app desktop) sono impostati — o sono vuoti — NESSUN dominio è ammesso e
 * ogni login viene rifiutato. Configurare sempre l'env in produzione, es.
 * `ALLOWED_DOMAINS=dominio1.it,dominio2.it`.
 *
 * `ALLOWED_DOMAINS=*` resta un'apertura ESPLICITA (ammette tutti i domini): è
 * una scelta deliberata, non più il comportamento di default a env mancante.
 */
export function isAllowedDomain(email: string): boolean {
  const raw = (process.env.ALLOWED_DOMAINS ?? process.env.ACCEPTED_DOMAINS ?? '').trim()
  if (raw === '') return false
  const allowed = raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
  if (allowed.includes('*')) return true
  if (allowed.length === 0) return false
  const domain = email.toLowerCase().split('@')[1] ?? ''
  if (!domain) return false
  return allowed.includes(domain)
}
