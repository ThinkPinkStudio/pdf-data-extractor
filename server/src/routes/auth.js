import { requestMagicLink, verifyMagicLink } from '../services/authService.js';
import { createSession, destroySession } from '../services/sessionService.js';
import { sendMagicLink } from '../services/emailService.js';
import { auditLog } from '../audit/logger.js';
import { config } from '../config.js';

export async function authRoutes(app) {
  app.post('/magic-link', {
    schema: {
      body: {
        type: 'object', required: ['email'],
        properties: { email: { type: 'string', format: 'email' } },
      },
    },
  }, async (req, reply) => {
    const email = req.body.email.toLowerCase().trim();
    try {
      const token = await requestMagicLink(email, req.ip);
      await sendMagicLink(email, token);
    } catch (err) {
      // Non rivelare al client se il dominio è autorizzato (anti-enumeration)
      if (err.statusCode !== 403) console.error('magic-link error:', err.message);
    }
    return reply.send({ message: 'Se l\'indirizzo è autorizzato, riceverai un link a breve.' });
  });

  app.get('/verify', async (req, reply) => {
    const { token } = req.query;
    if (!token) return reply.code(400).send({ error: 'Token mancante' });
    try {
      const email = await verifyMagicLink(token, req.ip);
      const { id, expiresAt } = await createSession(email, req.ip, req.headers['user-agent'] ?? '');
      await auditLog({
        userEmail: email, action: 'login_success', result: 'success',
        ipAddress: req.ip, userAgent: req.headers['user-agent'],
      });
      reply.setCookie('session', id, {
        httpOnly: true,
        secure:   config.NODE_ENV === 'production',
        sameSite: 'lax',
        expires:  expiresAt,
        path:     '/',
      });
      return reply.redirect('/');
    } catch (err) {
      return reply.code(err.statusCode ?? 400).send({ error: err.message });
    }
  });

  app.post('/logout', async (req, reply) => {
    const sessionId = req.cookies?.session;
    if (sessionId) {
      const { db } = await import('../db/index.js');
      const { rows } = await db.query(`SELECT email FROM sessions WHERE id = $1`, [sessionId]);
      if (rows.length) await destroySession(sessionId, rows[0].email, req.ip);
    }
    reply.clearCookie('session', { path: '/' });
    return reply.send({ message: 'Disconnesso' });
  });

  app.get('/me', async (req, reply) => {
    const sessionId = req.cookies?.session;
    if (!sessionId) return reply.code(401).send({ authenticated: false });
    const { db } = await import('../db/index.js');
    const { rows } = await db.query(
      `SELECT email, expires_at FROM sessions WHERE id = $1 AND expires_at > NOW()`,
      [sessionId]
    );
    if (!rows.length) {
      reply.clearCookie('session', { path: '/' });
      return reply.code(401).send({ authenticated: false });
    }
    return reply.send({ authenticated: true, email: rows[0].email, session_expires: rows[0].expires_at });
  });
}
