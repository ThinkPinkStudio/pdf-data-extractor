import crypto from 'crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { auditLog } from '../audit/logger.js';

export async function createSession(email, ipAddress, userAgent) {
  const id = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.SESSION_MAX_AGE_HOURS * 3_600_000);
  const uaHash = crypto.createHash('sha256').update(userAgent ?? '').digest('hex').slice(0, 16);

  // Mono-dispositivo: invalida tutte le sessioni precedenti dello stesso utente
  const { rowCount } = await db.query(
    `DELETE FROM sessions WHERE email = $1`, [email]
  );

  if (rowCount > 0) {
    await auditLog({
      userEmail: email, action: 'session_invalidated', result: 'success',
      ipAddress, details: { invalidated: rowCount, reason: 'new_login' },
    });
  }

  await db.query(
    `INSERT INTO sessions (id, email, expires_at, ip_address, user_agent_hash, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,NOW())`,
    [id, email, expiresAt, ipAddress, uaHash]
  );

  await auditLog({
    userEmail: email, action: 'session_created', result: 'success',
    ipAddress, userAgent,
    details: { expires_at: expiresAt.toISOString() },
  });

  return { id, expiresAt };
}

export async function destroySession(sessionId, email, ipAddress) {
  await db.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  await auditLog({ userEmail: email, action: 'logout', result: 'success', ipAddress });
}
