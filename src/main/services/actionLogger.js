import { app } from 'electron'
import { appendFile, mkdir } from 'fs/promises'
import { join } from 'path'
import log from 'electron-log'

let logDir = null

function getLogDir() {
  if (!logDir) logDir = join(app.getPath('userData'), 'logs')
  return logDir
}

function getLogPath() {
  return join(getLogDir(), 'actions.jsonl')
}

/**
 * Log a structured action entry.
 * @param {{ email?: string, action: string, resource?: string, metadata?: object, success?: boolean }} entry
 */
export async function logAction(entry) {
  const record = {
    timestamp: new Date().toISOString(),
    email: entry.email ?? null,
    action: entry.action,
    resource: entry.resource ?? null,
    metadata: entry.metadata ?? null,
    success: entry.success !== false,
  }

  // Also write to electron-log for visibility in main.log
  log.info('[action]', record)

  try {
    await mkdir(getLogDir(), { recursive: true })
    await appendFile(getLogPath(), JSON.stringify(record) + '\n', 'utf-8')
  } catch (err) {
    log.error('[actionLogger] Failed to write action log:', err)
  }
}

export function getActionLogPath() {
  return getLogPath()
}
