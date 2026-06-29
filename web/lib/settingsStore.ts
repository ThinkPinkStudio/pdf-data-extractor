import { getDb } from './db'

export interface WebSettings {
  llmProvider: string
  llmModel: string
  ollamaUrl: string
  openaiApiKey: string
  anthropicApiKey: string
}

const DEFAULTS: WebSettings = {
  llmProvider: 'ollama',
  llmModel: '',
  ollamaUrl: 'http://localhost:11434',
  openaiApiKey: '',
  anthropicApiKey: '',
}

export function getSettings(): WebSettings {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)
  `)
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return {
    llmProvider: map.llmProvider ?? DEFAULTS.llmProvider,
    llmModel: map.llmModel ?? DEFAULTS.llmModel,
    ollamaUrl: map.ollamaUrl ?? DEFAULTS.ollamaUrl,
    openaiApiKey: map.openaiApiKey ?? DEFAULTS.openaiApiKey,
    anthropicApiKey: map.anthropicApiKey ?? DEFAULTS.anthropicApiKey,
  }
}

export function saveSettings(s: Partial<WebSettings>) {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)
  `)
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  const saveMany = db.transaction((entries: [string, string][]) => {
    for (const [k, v] of entries) upsert.run(k, v)
  })
  saveMany(Object.entries(s) as [string, string][])
}
