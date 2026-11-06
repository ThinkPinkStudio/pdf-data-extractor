// CSA Adesioni Infortuni: archivio CONDIVISO delle adesioni (Postgres,
// tabella infortuni_records), numerazione IAH0015842/NNN e configurazione
// della sezione (chiavi della tabella settings). Il record completo vive in
// JSONB; nome, codice fiscale, targa e date sono ripetuti in colonne per la
// ricerca.
import { v4 as uuidv4 } from 'uuid'
import { pool } from '../db'
import { DEFAULT_FIRST_NUMBER, nextNumber, withDefaults } from './rules.js'

export type Rec = Record<string, unknown> & { questionario?: Record<string, string> }
export type Status = 'pending' | 'sent'

export interface InfortuniRow {
  id: string
  numero: string
  status: Status
  saved_by: string
  cognome: string
  nome: string
  codice_fiscale: string
  targa: string
  opzione: string
  data_adesione: string
  data_scadenza: string
  data: Rec
  sent_at: number | null
  sent_to: string | null
  created_at: number
  updated_at: number
}

const CONFIG_KEY = 'infortuniConfig'
const NUMBER_KEY = 'infortuniNumberingNext'

export type InfortuniConfig = ReturnType<typeof withDefaults>

export async function getConfig(): Promise<InfortuniConfig> {
  const { rows } = await pool.query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [CONFIG_KEY])
  let saved: unknown = null
  try { saved = rows[0]?.value ? JSON.parse(rows[0].value) : null } catch { saved = null }
  return withDefaults(saved)
}

export async function saveConfig(config: unknown): Promise<InfortuniConfig> {
  const clean = withDefaults(config)
  await pool.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [CONFIG_KEY, JSON.stringify(clean)]
  )
  return clean
}

/** Prossimo numero di adesione (quello che prenderà il prossimo salvataggio). */
export async function getNextNumber(): Promise<string> {
  const { rows } = await pool.query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [NUMBER_KEY])
  return rows[0]?.value || DEFAULT_FIRST_NUMBER
}

/** Imposta il prossimo numero (es. per riprendere la serie da un numero dato). */
export async function setNextNumber(next: string): Promise<string> {
  const val = String(next || '').trim()
  if (!/\d$/.test(val)) throw new Error('Il numero deve finire con delle cifre (es. IAH0015842/001)')
  const { rows } = await pool.query('SELECT 1 FROM infortuni_records WHERE numero = $1', [val])
  if (rows.length) throw new Error(`Il numero ${val} è già usato da un'adesione`)
  await pool.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [NUMBER_KEY, val]
  )
  return val
}

function cols(r: Rec) {
  const s = (k: string) => (r[k] == null ? '' : String(r[k]))
  return [s('cognome'), s('nome'), s('codice_fiscale'), s('targa'), s('opzione'), s('data_adesione'), s('data_scadenza')]
}

/**
 * Salva una nuova adesione assegnandole il numero della serie, nella stessa
 * transazione che avanza la serie (riga della serie bloccata: due operatori
 * insieme non prendono mai lo stesso numero). Un numero già usato (serie
 * riportata indietro a mano) si salta.
 */
export async function createRecord(savedBy: string, record: Rec): Promise<InfortuniRow> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [NUMBER_KEY, DEFAULT_FIRST_NUMBER]
    )
    const { rows: cur } = await client.query<{ value: string }>('SELECT value FROM settings WHERE key = $1 FOR UPDATE', [NUMBER_KEY])
    let numero = cur[0].value || DEFAULT_FIRST_NUMBER
    for (let i = 0; i < 10000; i++) {
      const { rows: used } = await client.query('SELECT 1 FROM infortuni_records WHERE numero = $1', [numero])
      if (!used.length) break
      numero = nextNumber(numero)
    }
    const data = { ...record, numero }
    const { rows } = await client.query<InfortuniRow>(
      `INSERT INTO infortuni_records (id, numero, status, saved_by, cognome, nome, codice_fiscale, targa, opzione, data_adesione, data_scadenza, data)
       VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [uuidv4(), numero, savedBy, ...cols(data), JSON.stringify(data)]
    )
    await client.query('UPDATE settings SET value = $2 WHERE key = $1', [NUMBER_KEY, nextNumber(numero)])
    await client.query('COMMIT')
    return rows[0]
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Corregge un'adesione: il numero non cambia mai. */
export async function updateRecord(id: string, record: Rec): Promise<InfortuniRow | null> {
  const cur = await getRecord(id)
  if (!cur) return null
  const data = { ...record, numero: cur.numero }
  const { rows } = await pool.query<InfortuniRow>(
    `UPDATE infortuni_records SET cognome=$2, nome=$3, codice_fiscale=$4, targa=$5, opzione=$6, data_adesione=$7, data_scadenza=$8, data=$9,
       updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT
     WHERE id=$1 RETURNING *`,
    [id, ...cols(data), JSON.stringify(data)]
  )
  return rows[0] || null
}

export async function getRecord(id: string): Promise<InfortuniRow | null> {
  const { rows } = await pool.query<InfortuniRow>('SELECT * FROM infortuni_records WHERE id = $1', [id])
  return rows[0] || null
}

export async function listRecords(q?: string, status?: Status): Promise<InfortuniRow[]> {
  const params: unknown[] = []
  const where: string[] = []
  if (q && q.trim()) {
    params.push(`%${q.trim().toLowerCase()}%`)
    const p = `$${params.length}`
    where.push(`(LOWER(cognome) LIKE ${p} OR LOWER(nome) LIKE ${p} OR LOWER(codice_fiscale) LIKE ${p} OR LOWER(targa) LIKE ${p} OR LOWER(numero) LIKE ${p})`)
  }
  if (status) { params.push(status); where.push(`status = $${params.length}`) }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const { rows } = await pool.query<InfortuniRow>(`SELECT * FROM infortuni_records ${clause} ORDER BY LENGTH(numero) DESC, numero DESC LIMIT 2000`, params)
  return rows
}

/** Adesioni per id, in ordine di numero (il BDX va in ordine di adesione). */
export async function getRecordsByIds(ids: string[]): Promise<InfortuniRow[]> {
  if (!ids.length) return []
  const { rows } = await pool.query<InfortuniRow>('SELECT * FROM infortuni_records WHERE id = ANY($1::text[]) ORDER BY LENGTH(numero), numero', [ids])
  return rows
}

export async function pendingRecords(): Promise<InfortuniRow[]> {
  const { rows } = await pool.query<InfortuniRow>(`SELECT * FROM infortuni_records WHERE status = 'pending' ORDER BY LENGTH(numero), numero`)
  return rows
}

export async function markSent(ids: string[], to: string): Promise<void> {
  if (!ids.length) return
  await pool.query(
    `UPDATE infortuni_records SET status='sent', sent_at=EXTRACT(EPOCH FROM NOW())::BIGINT, sent_to=$2 WHERE id = ANY($1::text[])`,
    [ids, to]
  )
}

export async function deleteRecord(id: string): Promise<boolean> {
  const res = await pool.query('DELETE FROM infortuni_records WHERE id = $1', [id])
  return (res.rowCount ?? 0) > 0
}
