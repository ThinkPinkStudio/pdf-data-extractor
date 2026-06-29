import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import { config } from '../config.js';

let stream = null;
let streamMonth = null;

async function getStream() {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (month !== streamMonth) {
    stream?.end();
    await mkdir(config.LOG_DIR, { recursive: true });
    stream = createWriteStream(
      path.join(config.LOG_DIR, `audit-${month}.log`),
      { flags: 'a', encoding: 'utf8' }
    );
    streamMonth = month;
  }
  return stream;
}

export async function auditLog(entry) {
  const record = {
    ts:     new Date().toISOString(),
    user:   entry.userEmail  ?? null,
    action: entry.action,
    res:    entry.resource   ?? null,
    result: entry.result     ?? null,
    ip:     entry.ipAddress  ?? null,
    ua:     entry.userAgent  ? entry.userAgent.slice(0, 200) : null,
    data:   entry.details    ?? null,
  };

  try {
    const s = await getStream();
    s.write(JSON.stringify(record) + '\n');
  } catch (e) {
    console.error('audit file error:', e.message);
  }

  try {
    const { db } = await import('../db/index.js');
    await db.query(
      `INSERT INTO audit_logs
         (ts, user_email, action, resource, result, ip_address, user_agent, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        record.ts, record.user, record.action, record.res,
        record.result, record.ip,
        entry.userAgent?.slice(0, 500) ?? null,
        record.data ? JSON.stringify(record.data) : null,
      ]
    );
  } catch (e) {
    console.error('audit db error:', e.message);
  }
}
