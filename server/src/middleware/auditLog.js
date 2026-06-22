import { auditLog } from '../audit/logger.js';

export async function onResponseAudit(req, reply) {
  if (!req.user) return;
  const result = reply.statusCode < 400 ? 'success' : 'failure';
  await auditLog({
    userEmail: req.user.email,
    action:    `${req.method} ${req.routerPath ?? req.url}`,
    resource:  req.params?.id ?? null,
    result,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  }).catch(() => {});
}
