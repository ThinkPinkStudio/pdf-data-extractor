import pino from 'pino'
import { pool } from './db'

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
})

export interface ActionLog {
  email?: string
  action: string
  resource?: string
  metadata?: Record<string, unknown>
  ip?: string
  userAgent?: string
  success?: boolean
}

export async function logAction(entry: ActionLog) {
  const timestamp = new Date().toISOString()
  const success = entry.success !== false

  logger.info({ ...entry, timestamp, success })

  try {
    await pool.query(
      `INSERT INTO action_logs (timestamp, email, action, resource, metadata, ip, user_agent, success)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        timestamp,
        entry.email ?? null,
        entry.action,
        entry.resource ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.ip ?? null,
        entry.userAgent ?? null,
        success,
      ]
    )
  } catch (err) {
    logger.error({ err }, 'Failed to persist action log')
  }
}

export async function getRecentLogs(limit = 200, offsetVal = 0) {
  const { rows } = await pool.query<{
    id: number
    timestamp: string
    email: string | null
    action: string
    resource: string | null
    metadata: string | null
    ip: string | null
    user_agent: string | null
    success: boolean
  }>(
    'SELECT * FROM action_logs ORDER BY id DESC LIMIT $1 OFFSET $2',
    [limit, offsetVal]
  )
  return rows
}
