// Archivio CONDIVISO dei record CSA Adesioni su PostgreSQL. Tutti gli operatori
// autenticati vedono/gestiscono l'intero archivio; `saved_by` traccia chi ha
// creato il record, `status` il ciclo di vita (pending → archived all'export).
import { v4 as uuidv4 } from 'uuid'
import { pool } from '../db'
import { addYearsIT } from './coverageDates.js'

export type Rec = Record<string, unknown> & { idd?: Record<string, string> }
export type Status = 'pending' | 'archived'

export interface AdesioneRow {
  id: string
  saved_by: string
  status: Status
  cognome: string
  nome: string
  codice_fiscale: string
  targa: string
  identificativo: string
  data_inizio: string
  data_fine: string
  tipo_movimento: string
  data: Rec
  created_at: number
  updated_at: number
}

function denorm(record: Rec) {
  const s = (k: string) => (record[k] == null ? '' : String(record[k]))
  return {
    cognome: s('cognome'), nome: s('nome'), codice_fiscale: s('codice_fiscale'),
    targa: s('targa'), identificativo: s('identificativo'), data_inizio: s('data_inizio'),
    data_fine: s('data_fine'), tipo_movimento: s('tipo_movimento'),
  }
}

export async function listRecords(q?: string, status?: Status): Promise<AdesioneRow[]> {
  const params: unknown[] = []
  const where: string[] = []
  if (q && q.trim()) {
    params.push(`%${q.trim().toLowerCase()}%`)
    const p = `$${params.length}`
    where.push(`(LOWER(cognome) LIKE ${p} OR LOWER(nome) LIKE ${p} OR LOWER(codice_fiscale) LIKE ${p} OR LOWER(targa) LIKE ${p} OR LOWER(identificativo) LIKE ${p})`)
  }
  if (status) { params.push(status); where.push(`status = $${params.length}`) }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const { rows } = await pool.query<AdesioneRow>(
    `SELECT * FROM adesioni_records ${clause} ORDER BY updated_at DESC LIMIT 1000`, params
  )
  return rows
}

export async function getRecord(id: string): Promise<AdesioneRow | null> {
  const { rows } = await pool.query<AdesioneRow>('SELECT * FROM adesioni_records WHERE id = $1', [id])
  return rows[0] || null
}

export async function createRecord(savedBy: string, record: Rec): Promise<AdesioneRow> {
  const id = uuidv4()
  const d = denorm(record)
  const { rows } = await pool.query<AdesioneRow>(
    `INSERT INTO adesioni_records (id, email, saved_by, status, cognome, nome, codice_fiscale, targa, identificativo, data_inizio, data_fine, tipo_movimento, data)
     VALUES ($1,$2,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [id, savedBy, d.cognome, d.nome, d.codice_fiscale, d.targa, d.identificativo, d.data_inizio, d.data_fine, d.tipo_movimento, JSON.stringify(record)]
  )
  return rows[0]
}

export async function updateRecord(id: string, record: Rec): Promise<AdesioneRow | null> {
  const d = denorm(record)
  const { rows } = await pool.query<AdesioneRow>(
    `UPDATE adesioni_records SET cognome=$2, nome=$3, codice_fiscale=$4, targa=$5, identificativo=$6, data_inizio=$7, data_fine=$8, tipo_movimento=$9, data=$10, updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT
     WHERE id=$1 RETURNING *`,
    [id, d.cognome, d.nome, d.codice_fiscale, d.targa, d.identificativo, d.data_inizio, d.data_fine, d.tipo_movimento, JSON.stringify(record)]
  )
  return rows[0] || null
}

export async function deleteRecord(id: string): Promise<boolean> {
  const res = await pool.query('DELETE FROM adesioni_records WHERE id = $1', [id])
  return (res.rowCount ?? 0) > 0
}

export async function getRecordsByIds(ids: string[]): Promise<AdesioneRow[]> {
  if (!ids.length) return []
  const { rows } = await pool.query<AdesioneRow>(
    'SELECT * FROM adesioni_records WHERE id = ANY($1::text[]) ORDER BY updated_at DESC', [ids]
  )
  return rows
}

/**
 * Rinnova i record indicati mutandoli IN PLACE (parità con l'app desktop,
 * recordsStore.renewRecords): sposta di `years` anni SOLO le date di
 * inizio/fine copertura e riporta lo stato a 'pending' (il rinnovo va
 * ri-esportato). Non tocca `data_rendicontazione` né l'identificativo.
 * Ritorna i record aggiornati.
 */
export async function renewRecords(ids: string[], years = 1): Promise<AdesioneRow[]> {
  if (!ids.length) return []
  const rows = await getRecordsByIds(ids)
  const out: AdesioneRow[] = []
  for (const row of rows) {
    const data = { ...(row.data || {}) } as Rec
    if (data.data_inizio) data.data_inizio = addYearsIT(String(data.data_inizio), years)
    if (data.data_fine) data.data_fine = addYearsIT(String(data.data_fine), years)
    const d = denorm(data)
    const { rows: updated } = await pool.query<AdesioneRow>(
      `UPDATE adesioni_records SET status='pending', cognome=$2, nome=$3, codice_fiscale=$4, targa=$5, identificativo=$6, data_inizio=$7, data_fine=$8, tipo_movimento=$9, data=$10, updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT
       WHERE id=$1 RETURNING *`,
      [row.id, d.cognome, d.nome, d.codice_fiscale, d.targa, d.identificativo, d.data_inizio, d.data_fine, d.tipo_movimento, JSON.stringify(data)]
    )
    if (updated[0]) out.push(updated[0])
  }
  return out
}

/**
 * Porta i record a stato 'archived' (usato dall'export) segnando lotto e data
 * di export (parità con archiveRecords(ids, batchId) del desktop).
 */
export async function archiveRecords(ids: string[], batchId?: string): Promise<number> {
  if (!ids.length) return 0
  const res = await pool.query(
    `UPDATE adesioni_records
       SET status='archived', export_batch=$2, exported_at=EXTRACT(EPOCH FROM NOW())::BIGINT,
           updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT
     WHERE id = ANY($1::text[])`,
    [ids, batchId ?? null]
  )
  return res.rowCount ?? 0
}
