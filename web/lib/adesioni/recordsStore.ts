// Archivio dei record CSA Adesioni su PostgreSQL (sostituisce recordsStore.js
// che nel desktop usava un file JSON in userData).
import { v4 as uuidv4 } from 'uuid'
import { pool } from '../db'

export type Rec = Record<string, unknown> & { idd?: Record<string, string> }

export interface AdesioneRow {
  id: string
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
    cognome: s('cognome'),
    nome: s('nome'),
    codice_fiscale: s('codice_fiscale'),
    targa: s('targa'),
    identificativo: s('identificativo'),
    data_inizio: s('data_inizio'),
    data_fine: s('data_fine'),
    tipo_movimento: s('tipo_movimento'),
  }
}

export async function listRecords(email: string, q?: string): Promise<AdesioneRow[]> {
  const params: unknown[] = [email]
  let where = 'email = $1'
  if (q && q.trim()) {
    params.push(`%${q.trim().toLowerCase()}%`)
    where += ` AND (LOWER(cognome) LIKE $2 OR LOWER(nome) LIKE $2 OR LOWER(codice_fiscale) LIKE $2 OR LOWER(targa) LIKE $2 OR LOWER(identificativo) LIKE $2 OR id = $2)`
  }
  const { rows } = await pool.query<AdesioneRow>(
    `SELECT * FROM adesioni_records WHERE ${where} ORDER BY updated_at DESC LIMIT 500`,
    params
  )
  return rows
}

export async function getRecord(id: string, email: string): Promise<AdesioneRow | null> {
  const { rows } = await pool.query<AdesioneRow>('SELECT * FROM adesioni_records WHERE id = $1 AND email = $2', [id, email])
  return rows[0] || null
}

export async function createRecord(email: string, record: Rec): Promise<AdesioneRow> {
  const id = uuidv4()
  const d = denorm(record)
  const { rows } = await pool.query<AdesioneRow>(
    `INSERT INTO adesioni_records (id, email, cognome, nome, codice_fiscale, targa, identificativo, data_inizio, data_fine, tipo_movimento, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [id, email, d.cognome, d.nome, d.codice_fiscale, d.targa, d.identificativo, d.data_inizio, d.data_fine, d.tipo_movimento, JSON.stringify(record)]
  )
  return rows[0]
}

export async function updateRecord(id: string, email: string, record: Rec): Promise<AdesioneRow | null> {
  const d = denorm(record)
  const { rows } = await pool.query<AdesioneRow>(
    `UPDATE adesioni_records SET cognome=$3, nome=$4, codice_fiscale=$5, targa=$6, identificativo=$7, data_inizio=$8, data_fine=$9, tipo_movimento=$10, data=$11, updated_at=EXTRACT(EPOCH FROM NOW())::BIGINT
     WHERE id=$1 AND email=$2 RETURNING *`,
    [id, email, d.cognome, d.nome, d.codice_fiscale, d.targa, d.identificativo, d.data_inizio, d.data_fine, d.tipo_movimento, JSON.stringify(record)]
  )
  return rows[0] || null
}

export async function deleteRecord(id: string, email: string): Promise<boolean> {
  const res = await pool.query('DELETE FROM adesioni_records WHERE id = $1 AND email = $2', [id, email])
  return (res.rowCount ?? 0) > 0
}

export async function getRecordsByIds(ids: string[], email: string): Promise<AdesioneRow[]> {
  if (!ids.length) return []
  const { rows } = await pool.query<AdesioneRow>(
    'SELECT * FROM adesioni_records WHERE email = $1 AND id = ANY($2::text[]) ORDER BY updated_at DESC',
    [email, ids]
  )
  return rows
}
