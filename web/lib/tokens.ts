import { v4 as uuidv4 } from 'uuid'
import { getDb } from './db'

const EXPIRY_MINUTES = parseInt(process.env.MAGIC_LINK_EXPIRY_MINUTES || '15', 10)

export function createToken(email: string): string {
  const db = getDb()
  const token = uuidv4()
  const expiresAt = Math.floor(Date.now() / 1000) + EXPIRY_MINUTES * 60

  db.prepare(
    'INSERT INTO magic_tokens (token, email, expires_at) VALUES (?, ?, ?)'
  ).run(token, email.toLowerCase().trim(), expiresAt)

  return token
}

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' }

export function verifyToken(token: string): VerifyResult {
  const db = getDb()
  const row = db
    .prepare('SELECT * FROM magic_tokens WHERE token = ?')
    .get(token) as { email: string; expires_at: number; used: number } | undefined

  if (!row) return { ok: false, reason: 'not_found' }
  if (row.used) return { ok: false, reason: 'used' }
  if (row.expires_at < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' }

  db.prepare('UPDATE magic_tokens SET used = 1 WHERE token = ?').run(token)

  return { ok: true, email: row.email }
}

export function cleanExpiredTokens() {
  const db = getDb()
  db.prepare('DELETE FROM magic_tokens WHERE expires_at < ?').run(
    Math.floor(Date.now() / 1000)
  )
}
