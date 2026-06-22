import 'dotenv/config';
import Fastify from 'fastify';
import cookie    from '@fastify/cookie';
import cors      from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config }          from './config.js';
import { db }              from './db/index.js';
import { ensureDirectories } from './utils/fs.js';
import { authRoutes }      from './routes/auth.js';
import { extractRoutes }   from './routes/api/extract.js';
import { batchRoutes }     from './routes/api/batch.js';
import { historyRoutes }   from './routes/api/history.js';
import { auditRoutes }     from './routes/api/audit.js';
import { queueRoutes }     from './routes/api/queue.js';
import { apiIpHook }       from './middleware/ipAllowlist.js';
import { authMiddleware }  from './middleware/auth.js';
import { onResponseAudit } from './middleware/auditLog.js';
import { startMcpServer }  from './mcp/server.js';

async function build() {
  const app = Fastify({
    logger:      config.NODE_ENV !== 'test',
    trustProxy:  true,
  });

  await app.register(cookie,    { secret: config.SESSION_SECRET });
  await app.register(cors,      { origin: config.BASE_URL, credentials: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  // Serve static client build in production
  if (config.NODE_ENV === 'production') {
    const { default: stat } = await import('@fastify/static');
    const { fileURLToPath }  = await import('url');
    const { join, dirname }  = await import('path');
    await app.register(stat, {
      root: join(dirname(fileURLToPath(import.meta.url)), '../../client/dist'),
      prefix: '/',
      decorateReply: false,
    });
  }

  // Auth routes — no IP restriction (browser must reach these for login)
  await app.register(authRoutes, { prefix: '/auth' });

  // API routes — IP restricted + auth (session or Bearer token)
  await app.register(async function apiScope(scope) {
    scope.addHook('onRequest',  apiIpHook);
    scope.addHook('preHandler', authMiddleware);
    scope.addHook('onResponse', onResponseAudit);

    await scope.register(extractRoutes, { prefix: '/extract' });
    await scope.register(batchRoutes,   { prefix: '/batch'   });
    await scope.register(historyRoutes, { prefix: '/history' });
    await scope.register(auditRoutes,   { prefix: '/audit'   });
    await scope.register(queueRoutes,   { prefix: '/queue'   });
  }, { prefix: '/api' });

  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  if (config.NODE_ENV === 'production') {
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api') || req.url.startsWith('/auth')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}

async function main() {
  await ensureDirectories();

  const app = await build();
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
  console.log(`✅ Web server avviato su http://0.0.0.0:${config.PORT}`);

  await startMcpServer();
  console.log(`✅ MCP server avviato su http://0.0.0.0:${config.MCP_PORT}`);
}

main().catch(err => {
  console.error('Startup error:', err);
  process.exit(1);
});
