import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'app.db')

// Ensure directory exists
const dbDir = path.dirname(dbPath)
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(dbPath)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
    initSchema(_db)
  }
  return _db
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS magic_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_magic_tokens_token ON magic_tokens(token);

    CREATE TABLE IF NOT EXISTS action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      email TEXT,
      action TEXT NOT NULL,
      resource TEXT,
      metadata TEXT,
      ip TEXT,
      user_agent TEXT,
      success INTEGER NOT NULL DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_logs_email ON action_logs(email);
    CREATE INDEX IF NOT EXISTS idx_logs_action ON action_logs(action);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON action_logs(timestamp);
  `)
}
