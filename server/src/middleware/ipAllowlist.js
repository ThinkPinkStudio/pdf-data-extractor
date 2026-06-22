import ipRangeCheck from 'ip-range-check';
import { apiAllowedIps, mcpAllowedIps } from '../config.js';

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const raw  = fwd ? fwd.split(',')[0].trim() : (req.socket?.remoteAddress ?? req.ip ?? '');
  return raw.replace(/^::ffff:/, '');
}

function makeHook(list) {
  return async function ipAllowlistHook(req, reply) {
    const ip = clientIp(req);
    const ok = list.some(range => {
      try { return ipRangeCheck(ip, range); } catch { return ip === range; }
    });
    if (!ok) {
      return reply.code(403).send({ error: 'Accesso negato: IP non autorizzato', ip });
    }
  };
}

export const apiIpHook = makeHook(apiAllowedIps);
export const mcpIpHook = makeHook(mcpAllowedIps);
