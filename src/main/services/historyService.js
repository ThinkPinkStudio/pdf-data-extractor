import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

function getSessionsDir() {
  const dir = join(app.getPath('userData'), 'sessions')
  try { mkdirSync(dir, { recursive: true }) } catch {}
  return dir
}

function getIndexPath() {
  return join(getSessionsDir(), '_index.json')
}

function readIndex() {
  try {
    const raw = readFileSync(getIndexPath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function writeIndex(index) {
  try {
    writeFileSync(getIndexPath(), JSON.stringify(index, null, 2), 'utf-8')
  } catch {}
}

export function listSessions() {
  return readIndex()
}

export function saveSession(session) {
  try {
    const sessionsDir = getSessionsDir()
    const id = session.id || `sess_${Date.now()}`
    const full = { ...session, id }
    const filePath = join(sessionsDir, `${id}.json`)
    writeFileSync(filePath, JSON.stringify(full, null, 2), 'utf-8')

    const index = readIndex()
    const existing = index.findIndex(s => s.id === id)
    const summary = {
      id,
      fileName: session.fileName || '',
      numPages: session.numPages || 0,
      createdAt: session.createdAt || new Date().toISOString()
    }
    if (existing >= 0) {
      index[existing] = summary
    } else {
      index.unshift(summary)
    }
    writeIndex(index)
    return { success: true, id }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export function loadSession(id) {
  try {
    const filePath = join(getSessionsDir(), `${id}.json`)
    const raw = readFileSync(filePath, 'utf-8')
    return { success: true, session: JSON.parse(raw) }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export function deleteSession(id) {
  try {
    const filePath = join(getSessionsDir(), `${id}.json`)
    if (existsSync(filePath)) unlinkSync(filePath)

    const index = readIndex()
    writeIndex(index.filter(s => s.id !== id))
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

export function purgeExpiredSessions(maxAgeDays) {
  if (!maxAgeDays || maxAgeDays <= 0) return { deleted: 0 }
  try {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    const index = readIndex()
    const toDelete = index.filter(s => {
      const ts = new Date(s.createdAt).getTime()
      return !isNaN(ts) && ts < cutoff
    })
    const sessionsDir = getSessionsDir()
    for (const s of toDelete) {
      try {
        const filePath = join(sessionsDir, `${s.id}.json`)
        if (existsSync(filePath)) unlinkSync(filePath)
      } catch {}
    }
    writeIndex(index.filter(s => !toDelete.some(d => d.id === s.id)))
    return { deleted: toDelete.length }
  } catch (err) {
    return { deleted: 0, error: err.message }
  }
}

export function clearAllSessions() {
  try {
    const index = readIndex()
    const sessionsDir = getSessionsDir()
    for (const s of index) {
      try {
        const filePath = join(sessionsDir, `${s.id}.json`)
        if (existsSync(filePath)) unlinkSync(filePath)
      } catch {}
    }
    writeIndex([])
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
}
