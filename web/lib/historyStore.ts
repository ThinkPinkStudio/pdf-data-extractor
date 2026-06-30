import { pool } from './db'

// Cronologia sessioni su Postgres (l'app desktop usa file; il web usa il DB,
// stessa forma dei dati: { id, fileName, numPages, createdAt, ...payload }).

export interface SessionSummary { id: string; fileName: string; numPages: number; createdAt: string }

async function ensure() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS history_sessions (
      id         TEXT PRIMARY KEY,
      email      TEXT NOT NULL,
      file_name  TEXT,
      num_pages  INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      payload    JSONB
    );
    CREATE INDEX IF NOT EXISTS idx_history_email ON history_sessions(email);
  `)
}

export async function listSessions(email: string): Promise<SessionSummary[]> {
  await ensure()
  const { rows } = await pool.query(
    `SELECT id, file_name, num_pages, created_at FROM history_sessions WHERE email = $1 ORDER BY created_at DESC`,
    [email]
  )
  return rows.map((r) => ({ id: r.id, fileName: r.file_name || '', numPages: r.num_pages || 0, createdAt: r.created_at }))
}

export async function loadSession(email: string, id: string): Promise<unknown | null> {
  await ensure()
  const { rows } = await pool.query(`SELECT payload FROM history_sessions WHERE email = $1 AND id = $2`, [email, id])
  return rows[0]?.payload ?? null
}

export async function saveSession(email: string, session: Record<string, unknown>): Promise<string> {
  await ensure()
  const id = (session.id as string) || `sess_${Date.now()}`
  await pool.query(
    `INSERT INTO history_sessions (id, email, file_name, num_pages, created_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET file_name = EXCLUDED.file_name, num_pages = EXCLUDED.num_pages, payload = EXCLUDED.payload`,
    [id, email, (session.fileName as string) || '', (session.numPages as number) || 0,
     (session.createdAt as string) || new Date().toISOString(), JSON.stringify({ ...session, id })]
  )
  return id
}

export async function deleteSession(email: string, id: string): Promise<void> {
  await ensure()
  await pool.query(`DELETE FROM history_sessions WHERE email = $1 AND id = $2`, [email, id])
}

export async function clearAll(email: string): Promise<void> {
  await ensure()
  await pool.query(`DELETE FROM history_sessions WHERE email = $1`, [email])
}
