import { db } from '../../db/index.js';

export async function auditRoutes(app) {
  // GET /api/audit — ultimi N eventi NIS2 (solo utenti autenticati)
  app.get('/', async (req, reply) => {
    const limit = Math.min(parseInt(req.query.limit ?? '100'), 500);
    const action = req.query.action ?? null;
    const user   = req.query.user   ?? null;

    let q = `SELECT id, ts, user_email, action, resource, result, ip_address, details
              FROM audit_logs WHERE 1=1`;
    const params = [];
    if (action) { params.push(action);  q += ` AND action = $${params.length}`; }
    if (user)   { params.push(user);    q += ` AND user_email = $${params.length}`; }
    params.push(limit);
    q += ` ORDER BY ts DESC LIMIT $${params.length}`;

    const { rows } = await db.query(q, params);
    return reply.send({ items: rows });
  });
}
