import { v4 as uuidv4 } from 'uuid'
import { pool } from './db'

// Token di reset password (flusso "Hai dimenticato la password?").
const EXPIRY_MINUTES = parseInt(process.env.PASSWORD_RESET_EXPIRY_MINUTES || '60', 10)

export async function createResetToken(email: string): Promise<string> {
  const token = uuidv4()
  const expiresAt = Math.floor(Date.now() / 1000) + EXPIRY_MINUTES * 60

  // Un nuovo token invalida i precedenti ancora non usati per la stessa email.
  await pool.query('DELETE FROM password_resets WHERE email = $1 AND used = FALSE', [email])
  await pool.query(
    'INSERT INTO password_resets (token, email, expires_at) VALUES ($1, $2, $3)',
    [token, email.toLowerCase().trim(), expiresAt]
  )

  return token
}

export type ResetVerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' }

export async function verifyResetToken(token: string): Promise<ResetVerifyResult> {
  const now = Math.floor(Date.now() / 1000)

  // Atomically mark as used and return the row only if valid.
  const { rows } = await pool.query<{ email: string; expires_at: string; used: boolean }>(
    `UPDATE password_resets
     SET used = TRUE
     WHERE token = $1 AND used = FALSE AND expires_at >= $2
     RETURNING email, expires_at, used`,
    [token, now]
  )

  if (rows.length > 0) {
    return { ok: true, email: rows[0].email }
  }

  const { rows: check } = await pool.query<{ expires_at: string; used: boolean }>(
    'SELECT expires_at, used FROM password_resets WHERE token = $1',
    [token]
  )

  if (check.length === 0) return { ok: false, reason: 'not_found' }
  if (check[0].used) return { ok: false, reason: 'used' }
  return { ok: false, reason: 'expired' }
}

export async function cleanExpiredResetTokens() {
  await pool.query(
    'DELETE FROM password_resets WHERE expires_at < $1',
    [Math.floor(Date.now() / 1000)]
  )
}