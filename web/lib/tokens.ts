import { v4 as uuidv4 } from 'uuid'
import { pool } from './db'

const EXPIRY_MINUTES = parseInt(process.env.MAGIC_LINK_EXPIRY_MINUTES || '15', 10)

export async function createToken(email: string): Promise<string> {
  const token = uuidv4()
  const expiresAt = Math.floor(Date.now() / 1000) + EXPIRY_MINUTES * 60

  await pool.query(
    'INSERT INTO magic_tokens (token, email, expires_at) VALUES ($1, $2, $3)',
    [token, email.toLowerCase().trim(), expiresAt]
  )

  return token
}

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' }

export async function verifyToken(token: string): Promise<VerifyResult> {
  const now = Math.floor(Date.now() / 1000)

  // Atomically mark as used and return the row only if valid
  const { rows } = await pool.query<{ email: string; expires_at: string; used: boolean }>(
    `UPDATE magic_tokens
     SET used = TRUE
     WHERE token = $1 AND used = FALSE AND expires_at >= $2
     RETURNING email, expires_at, used`,
    [token, now]
  )

  if (rows.length > 0) {
    return { ok: true, email: rows[0].email }
  }

  // Distinguish not_found vs expired vs used
  const { rows: check } = await pool.query<{ expires_at: string; used: boolean }>(
    'SELECT expires_at, used FROM magic_tokens WHERE token = $1',
    [token]
  )

  if (check.length === 0) return { ok: false, reason: 'not_found' }
  if (check[0].used) return { ok: false, reason: 'used' }
  return { ok: false, reason: 'expired' }
}

export async function cleanExpiredTokens() {
  await pool.query(
    'DELETE FROM magic_tokens WHERE expires_at < $1',
    [Math.floor(Date.now() / 1000)]
  )
}
