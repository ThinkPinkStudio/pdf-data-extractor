import pino from 'pino'
import { getDb } from './db'

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

export function logAction(entry: ActionLog) {
  const timestamp = new Date().toISOString()
  const success = entry.success !== false ? 1 : 0

  logger.info({
    ...entry,
    timestamp,
    success: success === 1,
  })

  try {
    const db = getDb()
    db.prepare(
      `INSERT INTO action_logs (timestamp, email, action, resource, metadata, ip, user_agent, success)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      timestamp,
      entry.email ?? null,
      entry.action,
      entry.resource ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.ip ?? null,
      entry.userAgent ?? null,
      success
    )
  } catch (err) {
    logger.error({ err }, 'Failed to persist action log')
  }
}

export function getRecentLogs(limit = 200, offsetVal = 0) {
  const db = getDb()
  return db
    .prepare(
      `SELECT * FROM action_logs ORDER BY id DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offsetVal) as Array<{
      id: number
      timestamp: string
      email: string | null
      action: string
      resource: string | null
      metadata: string | null
      ip: string | null
      user_agent: string | null
      success: number
    }>
}
