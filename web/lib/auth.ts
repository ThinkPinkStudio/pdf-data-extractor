import { getIronSession, sealData, unsealData, type SessionOptions } from 'iron-session'
import { cookies } from 'next/headers'
import type { ResponseCookie } from 'next/dist/compiled/@edge-runtime/cookies'
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto'

export interface SessionData {
  email: string
  loginAt: number
}

/**
 * Se il cookie di sessione deve avere il flag `Secure` (inviato solo su HTTPS).
 *
 * L'app gira su HTTP in rete interna: di default NON si imposta `Secure`,
 * altrimenti il browser scarterebbe il cookie su http:// e si entrerebbe in un
 * loop infinito di login. `COOKIE_SECURE=true` è un opt-in per deploy esposti
 * su HTTPS.
 */
export function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE === 'true'
}

export const SESSION_OPTIONS: SessionOptions = {
  cookieName: 'pdf_extractor_session',
  password: process.env.SESSION_SECRET || 'change-me-32-chars-minimum-secret!!',
  cookieOptions: {
    secure: cookieSecure(),
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
    // Nessun maxAge: sessione persistente, l'utente accede una volta per tutte.
    // Il cookie scade solo su logout esplicito o al cambio di SESSION_SECRET.
    cookieStore.set(COOKIE_NAME, sealed, {
      httpOnly: true,
      secure: cookieSecure(),
      sameSite: 'lax',
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
 * Il controllo è **fail-closed**. Se né `ALLOWED_DOMAINS` né `ACCEPTED_DOMAINS`
 * (nome usato dall'app desktop) sono impostati — o sono vuoti — NESSUN dominio
 * è ammesso e ogni onboarding/login viene rifiutato. Configurare sempre l'env
 * in produzione, es. `ALLOWED_DOMAINS=dominio1.it,dominio2.it`.
 *
 * `ALLOWED_DOMAINS=*` resta un'apertura ESPLICITA (ammette tutti i domini): è
 * una scelta deliberata.
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

// ─── Hash password (scrypt, built-in Node: nessuna dipendenza nativa) ───────

const SCRYPT_KEYLEN = 64
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 }

/**
 * Genera un hash scrypt per la password. Formato: `scrypt:N:r:p:salt:hash`
 * (salt e hash in base64), così i parametri viaggiano dentro la stringa e
 * l'upgrade futuro dei cost factors non invalida le password esistenti.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTS)
  return [
    'scrypt',
    SCRYPT_OPTS.N,
    SCRYPT_OPTS.r,
    SCRYPT_OPTS.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join(':')
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false
  const parts = stored.split(':')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts
  try {
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')
    const actual = scryptSync(password, salt, expected.length, {
      N: parseInt(n, 10),
      r: parseInt(r, 10),
      p: parseInt(p, 10),
    })
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

export const MIN_PASSWORD_LENGTH = 8