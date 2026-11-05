// ANAGRAFICHE RSM — accesso al DB (tabelle rsm_programs, rsm_members: db.ts).
// Le regole di calcolo stanno in rules.js; qui solo lettura e scrittura dei
// fatti (date, legami, categorie) e le operazioni che toccano più righe in
// una transazione (import, promozione).
import { v4 as uuidv4 } from 'uuid'
import { pool } from '../db'
import type { RsmConfig, RsmMember, RsmProgram } from './types'

const now = () => Math.floor(Date.now() / 1000)

interface MemberRow {
  id: string; program_id: string; category: string; quiescente: boolean; cf: string; cognome: string; nome: string
  birth_date: string | null; legame: string; cf_titolare: string | null; entry_date: string | null; entry_kind: string
  requested_date: string | null; communicated_date: string | null; entry_forced: boolean; exit_date: string | null
  exit_kind: string | null; exit_communicated: string | null; promotion_id: string | null; source: string | null
  note: string | null; created_by: string; created_at: string; updated_at: string
}

function toMember(r: MemberRow): RsmMember {
  return {
    id: r.id, programId: r.program_id, category: r.category, quiescente: r.quiescente, cf: r.cf, cognome: r.cognome,
    nome: r.nome, birthDate: r.birth_date, legame: r.legame as RsmMember['legame'], cfTitolare: r.cf_titolare,
    entryDate: r.entry_date, entryKind: r.entry_kind as RsmMember['entryKind'], requestedDate: r.requested_date,
    communicatedDate: r.communicated_date, entryForced: r.entry_forced, exitDate: r.exit_date,
    exitKind: r.exit_kind as RsmMember['exitKind'], exitCommunicated: r.exit_communicated, promotionId: r.promotion_id,
    source: r.source, note: r.note, createdBy: r.created_by, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  }
}

interface ProgramRow { id: string; name: string; year: number; config: RsmConfig; created_by: string; created_at: string; updated_at: string }
const toProgram = (r: ProgramRow): RsmProgram => ({
  id: r.id, name: r.name, year: r.year, config: r.config, createdBy: r.created_by,
  createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
})

export async function listPrograms(): Promise<RsmProgram[]> {
  const { rows } = await pool.query<ProgramRow>('SELECT * FROM rsm_programs ORDER BY year DESC, name')
  return rows.map(toProgram)
}

export async function getProgram(id: string): Promise<RsmProgram | null> {
  const { rows } = await pool.query<ProgramRow>('SELECT * FROM rsm_programs WHERE id = $1', [id])
  return rows[0] ? toProgram(rows[0]) : null
}

export async function createProgram(name: string, year: number, config: RsmConfig, by: string): Promise<RsmProgram> {
  const t = now()
  const { rows } = await pool.query<ProgramRow>(
    'INSERT INTO rsm_programs (id, name, year, config, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *',
    [uuidv4(), name, year, JSON.stringify(config), by, t],
  )
  return toProgram(rows[0])
}

export async function updateProgram(id: string, name: string, year: number, config: RsmConfig): Promise<RsmProgram | null> {
  const { rows } = await pool.query<ProgramRow>(
    'UPDATE rsm_programs SET name=$2, year=$3, config=$4, updated_at=$5 WHERE id=$1 RETURNING *',
    [id, name, year, JSON.stringify(config), now()],
  )
  return rows[0] ? toProgram(rows[0]) : null
}

export async function deleteProgram(id: string): Promise<boolean> {
  const res = await pool.query('DELETE FROM rsm_programs WHERE id = $1', [id])
  return (res.rowCount ?? 0) > 0
}

export async function listMembers(programId: string): Promise<RsmMember[]> {
  const { rows } = await pool.query<MemberRow>(
    'SELECT * FROM rsm_members WHERE program_id = $1 ORDER BY category, cf_titolare, (legame <> \'TI\'), legame DESC, cognome, nome, entry_date',
    [programId],
  )
  return rows.map(toMember)
}

export async function getMember(id: string): Promise<RsmMember | null> {
  const { rows } = await pool.query<MemberRow>('SELECT * FROM rsm_members WHERE id = $1', [id])
  return rows[0] ? toMember(rows[0]) : null
}

export type NewMember = Omit<RsmMember, 'id' | 'programId' | 'createdBy' | 'createdAt' | 'updatedAt'>

const COLS = 'id, program_id, category, quiescente, cf, cognome, nome, birth_date, legame, cf_titolare, entry_date, entry_kind, requested_date, communicated_date, entry_forced, exit_date, exit_kind, exit_communicated, promotion_id, source, note, created_by, created_at, updated_at'

function values(programId: string, m: Partial<NewMember>, by: string, t: number) {
  return [
    uuidv4(), programId, m.category, !!m.quiescente, m.cf || '', m.cognome || '', m.nome || '', m.birthDate || null,
    m.legame, m.cfTitolare || null, m.entryDate || null, m.entryKind || 'inclusione', m.requestedDate || null,
    m.communicatedDate || null, !!m.entryForced, m.exitDate || null, m.exitKind || null, m.exitCommunicated || null,
    m.promotionId || null, m.source || null, m.note || null, by, t, t,
  ]
}

type Q = { query: typeof pool.query }

async function insertMany(client: Q, programId: string, members: Partial<NewMember>[], by: string) {
  const t = now()
  for (let i = 0; i < members.length; i += 200) {
    const chunk = members.slice(i, i + 200)
    const params: unknown[] = []
    const tuples = chunk.map((m) => {
      const v = values(programId, m, by, t)
      const base = params.length
      params.push(...v)
      return `(${v.map((_, j) => `$${base + j + 1}`).join(',')})`
    })
    await client.query(`INSERT INTO rsm_members (${COLS}) VALUES ${tuples.join(',')}`, params)
  }
}

export async function insertMembers(programId: string, members: Partial<NewMember>[], by: string): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await insertMany(client as unknown as Q, programId, members, by)
    await client.query('UPDATE rsm_programs SET updated_at=$2 WHERE id=$1', [programId, now()])
    await client.query('COMMIT')
    return members.length
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/** Import dello stato di rischio: sostituisce TUTTE le righe del programma. */
export async function replaceMembers(programId: string, members: Partial<NewMember>[], by: string): Promise<number> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM rsm_members WHERE program_id = $1', [programId])
    // gli id di promozione dell'import ('promo-N') diventano unici
    const ids = new Map<string, string>()
    const fixed = members.map((m) => {
      if (!m.promotionId) return m
      if (!ids.has(m.promotionId)) ids.set(m.promotionId, uuidv4())
      return { ...m, promotionId: ids.get(m.promotionId) }
    })
    await insertMany(client as unknown as Q, programId, fixed, by)
    await client.query('UPDATE rsm_programs SET updated_at=$2 WHERE id=$1', [programId, now()])
    await client.query('COMMIT')
    return members.length
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/** Campi modificabili di una riga (correzioni, cessazione, decorrenza forzata). */
export type MemberPatch = Partial<Pick<RsmMember,
  'cognome' | 'nome' | 'cf' | 'birthDate' | 'legame' | 'cfTitolare' | 'quiescente' | 'entryDate' | 'entryForced'
  | 'exitDate' | 'exitKind' | 'exitCommunicated' | 'note'>>

const PATCH_COLS: Record<keyof MemberPatch, string> = {
  cognome: 'cognome', nome: 'nome', cf: 'cf', birthDate: 'birth_date', legame: 'legame', cfTitolare: 'cf_titolare',
  quiescente: 'quiescente', entryDate: 'entry_date', entryForced: 'entry_forced', exitDate: 'exit_date',
  exitKind: 'exit_kind', exitCommunicated: 'exit_communicated', note: 'note',
}

export async function updateMember(id: string, patch: MemberPatch): Promise<RsmMember | null> {
  const sets: string[] = []
  const params: unknown[] = [id]
  for (const [k, col] of Object.entries(PATCH_COLS) as [keyof MemberPatch, string][]) {
    if (!(k in patch)) continue
    params.push(patch[k] ?? null)
    sets.push(`${col} = $${params.length}`)
  }
  if (!sets.length) return getMember(id)
  params.push(now())
  sets.push(`updated_at = $${params.length}`)
  const { rows } = await pool.query<MemberRow>(`UPDATE rsm_members SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params)
  return rows[0] ? toMember(rows[0]) : null
}

/** Codice fiscale del titolare corretto: i familiari della stessa categoria lo seguono. */
export async function renameTitolare(programId: string, category: string, oldCf: string, newCf: string): Promise<number> {
  const res = await pool.query(
    `UPDATE rsm_members SET cf_titolare=$4, updated_at=$5 WHERE program_id=$1 AND category=$2 AND cf_titolare=$3`,
    [programId, category, oldCf, newCf, now()],
  )
  return res.rowCount ?? 0
}

/** Cessazione di un'intera famiglia o di una persona: stessa data sulle righe indicate. */
export async function setExit(ids: string[], exitDate: string, exitCommunicated: string | null, note: string | null): Promise<number> {
  if (!ids.length) return 0
  const res = await pool.query(
    `UPDATE rsm_members SET exit_date=$2, exit_kind='cessazione', exit_communicated=$3,
       note = CASE WHEN $4::text IS NULL OR $4 = '' THEN note WHEN note IS NULL OR note = '' THEN $4 ELSE note || ' · ' || $4 END,
       updated_at=$5
     WHERE id = ANY($1::text[]) AND (exit_kind IS NULL OR exit_kind = 'cessazione')`,
    [ids, exitDate, exitCommunicated, note, now()],
  )
  return res.rowCount ?? 0
}

export async function clearExit(id: string): Promise<RsmMember | null> {
  return updateMember(id, { exitDate: null, exitKind: null, exitCommunicated: null })
}

export async function deleteMembers(ids: string[]): Promise<number> {
  if (!ids.length) return 0
  const res = await pool.query('DELETE FROM rsm_members WHERE id = ANY($1::text[])', [ids])
  return res.rowCount ?? 0
}

/**
 * Promozione: chiude le righe del nucleo nella categoria di partenza dal
 * giorno `date` e apre le stesse persone nella categoria `toCategory`, tutto
 * con lo stesso promotion_id, in una transazione.
 */
export async function promote(programId: string, memberIds: string[], toCategory: string, date: string, note: string | null, by: string): Promise<string> {
  const promotionId = uuidv4()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<MemberRow>(
      'SELECT * FROM rsm_members WHERE program_id = $1 AND id = ANY($2::text[]) FOR UPDATE', [programId, memberIds],
    )
    if (rows.length !== memberIds.length) throw new Error('Alcune persone non sono più nel programma.')
    const t = now()
    await client.query(
      `UPDATE rsm_members SET exit_date=$2, exit_kind='promozione', promotion_id=$3, updated_at=$4 WHERE id = ANY($1::text[])`,
      [memberIds, date, promotionId, t],
    )
    const fresh = rows.map(toMember).map((m) => ({
      category: toCategory, quiescente: false, cf: m.cf, cognome: m.cognome, nome: m.nome, birthDate: m.birthDate,
      legame: m.legame, cfTitolare: m.cfTitolare, entryDate: date, entryKind: 'promozione' as const, requestedDate: date,
      communicatedDate: null, entryForced: false, exitDate: null, exitKind: null, exitCommunicated: null, promotionId,
      source: 'Promozione', note,
    }))
    await insertMany(client as unknown as Q, programId, fresh, by)
    await client.query('UPDATE rsm_programs SET updated_at=$2 WHERE id=$1', [programId, t])
    await client.query('COMMIT')
    return promotionId
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/** Annulla una promozione: toglie le righe nuove e riapre quelle chiuse. */
export async function undoPromotion(programId: string, promotionId: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`DELETE FROM rsm_members WHERE program_id=$1 AND promotion_id=$2 AND entry_kind='promozione'`, [programId, promotionId])
    await client.query(
      `UPDATE rsm_members SET exit_date=NULL, exit_kind=NULL, promotion_id=NULL, updated_at=$3 WHERE program_id=$1 AND promotion_id=$2 AND exit_kind='promozione'`,
      [programId, promotionId, now()],
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
