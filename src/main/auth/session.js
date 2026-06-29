import { app } from 'electron'
import { readFile, writeFile, unlink } from 'fs/promises'
import { join } from 'path'

const SESSION_FILE = () => join(app.getPath('userData'), 'session.json')
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

export async function loadSession() {
  try {
    const raw = await readFile(SESSION_FILE(), 'utf-8')
    const data = JSON.parse(raw)
    if (!data.email || !data.loginAt) return null
    if (Date.now() - data.loginAt > SESSION_MAX_AGE_MS) {
      await clearSession()
      return null
    }
    return data
  } catch {
    return null
  }
}

export async function saveSession(email) {
  const data = { email, loginAt: Date.now() }
  await writeFile(SESSION_FILE(), JSON.stringify(data, null, 2), 'utf-8')
  return data
}

export async function clearSession() {
  try {
    await unlink(SESSION_FILE())
  } catch {
    // file may not exist
  }
}
