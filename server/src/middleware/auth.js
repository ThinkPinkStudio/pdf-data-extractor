import { db } from '../db/index.js';
import { config } from '../config.js';

// Handles both session cookie and Bearer token (for programmatic/scanner access)
export async function authMiddleware(req, reply) {
  // Bearer token takes priority — used by queue scanner software
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ') && config.QUEUE_BEARER_TOKEN) {
    if (authHeader.slice(7) === config.QUEUE_BEARER_TOKEN) {
      req.user = { email: 'system-api', isBearer: true };
      return;
    }
    return reply.code(403).send({ error: 'Bearer token non valido' });
  }

  // Session cookie
  const sessionId = req.cookies?.session;
  if (!sessionId) {
    return reply.code(401).send({ error: 'Autenticazione richiesta' });
  }

  const { rows } = await db.query(
    `SELECT email FROM sessions WHERE id = $1 AND expires_at > NOW()`,
    [sessionId]
  );

  if (!rows.length) {
    reply.clearCookie('session', { path: '/' });
    return reply.code(401).send({ error: 'Sessione scaduta' });
  }

  req.user = { email: rows[0].email };
  db.query(`UPDATE sessions SET last_seen_at = NOW() WHERE id = $1`, [sessionId]).catch(() => {});
}
