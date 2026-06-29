import crypto from 'crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { auditLog } from '../audit/logger.js';

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function requestMagicLink(email, ipAddress) {
  const domain = email.split('@')[1]?.toLowerCase() ?? '';

  if (domain !== config.ALLOWED_EMAIL_DOMAIN.toLowerCase()) {
    await auditLog({
      userEmail: email, action: 'login_request', result: 'failure',
      ipAddress, details: { reason: 'domain_not_allowed' },
    });
    throw Object.assign(new Error('Dominio email non autorizzato'), { statusCode: 403 });
  }

  await db.query(
    `INSERT INTO users (email) VALUES ($1) ON CONFLICT (email) DO NOTHING`,
    [email]
  );
  // Invalida link precedenti non usati
  await db.query(`DELETE FROM magic_links WHERE email = $1 AND used_at IS NULL`, [email]);

  const token = generateToken();
  const expiresAt = new Date(Date.now() + config.MAGIC_LINK_EXPIRY_MINUTES * 60_000);

  await db.query(
    `INSERT INTO magic_links (token, email, expires_at, ip_address) VALUES ($1,$2,$3,$4)`,
    [token, email, expiresAt, ipAddress]
  );

  await auditLog({
    userEmail: email, action: 'login_request', result: 'success',
    ipAddress, details: { expires_at: expiresAt.toISOString() },
  });

  return token;
}

export async function verifyMagicLink(token, ipAddress) {
  const { rows } = await db.query(
    `SELECT email, expires_at, used_at FROM magic_links WHERE token = $1`,
    [token]
  );

  if (!rows.length) {
    await auditLog({ action: 'login_failure', result: 'failure', ipAddress, details: { reason: 'token_not_found' } });
    throw Object.assign(new Error('Link non valido o scaduto'), { statusCode: 401 });
  }

  const link = rows[0];

  if (link.used_at) {
    await auditLog({ userEmail: link.email, action: 'login_failure', result: 'failure', ipAddress, details: { reason: 'already_used' } });
    throw Object.assign(new Error('Questo link è già stato usato'), { statusCode: 401 });
  }

  if (new Date() > link.expires_at) {
    await auditLog({ userEmail: link.email, action: 'login_failure', result: 'failure', ipAddress, details: { reason: 'expired' } });
    throw Object.assign(new Error('Link scaduto'), { statusCode: 401 });
  }

  await db.query(`UPDATE magic_links SET used_at = NOW() WHERE token = $1`, [token]);
  await db.query(`UPDATE users SET last_login_at = NOW() WHERE email = $1`, [link.email]);

  return link.email;
}
