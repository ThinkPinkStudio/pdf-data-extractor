import { db } from '../../db/index.js';

export async function historyRoutes(app) {
  app.get('/', async (req, reply) => {
    const limit  = Math.min(parseInt(req.query.limit  ?? '50'),  200);
    const offset = parseInt(req.query.offset ?? '0');
    const { rows } = await db.query(
      `SELECT id, created_at, pdf_name, pdf_size_bytes, fields, result, status, llm_provider, duration_ms
       FROM extraction_history WHERE user_email = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.email, limit, offset]
    );
    return reply.send({ items: rows, limit, offset });
  });

  app.get('/:id', async (req, reply) => {
    const { rows } = await db.query(
      `SELECT * FROM extraction_history WHERE id = $1 AND user_email = $2`,
      [req.params.id, req.user.email]
    );
    if (!rows.length) return reply.code(404).send({ error: 'Non trovato' });
    return reply.send(rows[0]);
  });

  app.delete('/:id', async (req, reply) => {
    const { rowCount } = await db.query(
      `DELETE FROM extraction_history WHERE id = $1 AND user_email = $2`,
      [req.params.id, req.user.email]
    );
    if (!rowCount) return reply.code(404).send({ error: 'Non trovato' });
    return reply.send({ deleted: true });
  });
}
