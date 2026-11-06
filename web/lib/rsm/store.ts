// ANAGRAFICHE RSM — accesso al DB (tabelle rsm_programs, rsm_members, rsm_ops:
// db.ts). Le regole di calcolo stanno in rules.js; qui solo lettura e scrittura
// dei fatti (date, legami, categorie). Ogni modifica passa da `withOp`: in una
// transazione salva nel registro (rsm_ops) le righe com'erano prima e gli id
// inseriti, così l'ultima operazione si annulla esattamente (`undoLastOp`).
import { v4 as uuidv4 } from 'uuid'
import { pool } from '../db'
import type { RsmConfig, RsmMember, RsmProgram } from './types'

const now = () => Math.floor(Date.now() / 1000)

interface MemberRow {
  id: string; program_id: string; category: string; quiescente: boolean; cf: string; cognome: string; nome: string
  birth_date: string | null; legame: string; cf_titolare: string | null; entry_date: string | null; entry_kind: string
  requested_date: string | null; communicated_date: string | null; entry_forced: boolean; exit_date: string | null
  exit_kind: string | null; exit_communicated: string | null; promotion_id: string | null; exit_promotion_id: string | null; source: string | null
  note: string | null; created_by: string; created_at: string; updated_at: string
}

function toMember(r: MemberRow): RsmMember {
  return {
    id: r.id, programId: r.program_id, category: r.category, quiescente: r.quiescente, cf: r.cf, cognome: r.cognome,
    nome: r.nome, birthDate: r.birth_date, legame: r.legame as RsmMember['legame'], cfTitolare: r.cf_titolare,
    entryDate: r.entry_date, entryKind: r.entry_kind as RsmMember['entryKind'], requestedDate: r.requested_date,
    communicatedDate: r.communicated_date, entryForced: r.entry_forced, exitDate: r.exit_date,
    exitKind: r.exit_kind as RsmMember['exitKind'], exitCommunicated: r.exit_communicated, promotionId: r.promotion_id, exitPromotionId: r.exit_promotion_id,
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

const COLS = 'id, program_id, category, quiescente, cf, cognome, nome, birth_date, legame, cf_titolare, entry_date, entry_kind, requested_date, communicated_date, entry_forced, exit_date, exit_kind, exit_communicated, promotion_id, exit_promotion_id, source, note, created_by, created_at, updated_at'
const COL_LIST = COLS.split(', ')

function values(id: string, programId: string, m: Partial<NewMember>, by: string, t: number) {
  return [
    id, programId, m.category, !!m.quiescente, m.cf || '', m.cognome || '', m.nome || '', m.birthDate || null,
    m.legame, m.cfTitolare || null, m.entryDate || null, m.entryKind || 'inclusione', m.requestedDate || null,
    m.communicatedDate || null, !!m.entryForced, m.exitDate || null, m.exitKind || null, m.exitCommunicated || null,
    m.promotionId || null, m.exitPromotionId || null, m.source || null, m.note || null, by, t, t,
  ]
}

type Client = { query: typeof pool.query }

async function insertRaw(client: Client, rows: unknown[][]) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    const params: unknown[] = []
    const tuples = chunk.map((v) => {
      const base = params.length
      params.push(...v)
      return `(${v.map((_, j) => `$${base + j + 1}`).join(',')})`
    })
    await client.query(`INSERT INTO rsm_members (${COLS}) VALUES ${tuples.join(',')}`, params)
  }
}

/* ─── Registro delle operazioni ──────────────────────────────────────────── */

export interface RsmOp {
  id: string; kind: string; label: string; createdBy: string; createdAt: number
  undoneAt: number | null; undoneBy: string | null; rows: number
}

interface OpCtx {
  /** Fotografa le righe indicate PRIMA di modificarle o cancellarle. */
  snap: (ids: string[]) => Promise<void>
  /** Annota gli id inseriti (l'annullamento li cancella). */
  inserted: (ids: string[]) => void
  client: Client
}

/**
 * Esegue `fn` in una transazione e registra l'operazione. Restituisce l'id
 * dell'operazione e il risultato di `fn`.
 */
async function withOp<T>(programId: string, kind: string, label: string, by: string, fn: (op: OpCtx) => Promise<T>): Promise<{ opId: string; result: T }> {
  const client = await pool.connect()
  const before = new Map<string, MemberRow>()
  const inserted: string[] = []
  try {
    await client.query('BEGIN')
    // una modifica alla volta per programma: l'annullamento non sovrascrive mai un lavoro concorrente
    await client.query('SELECT id FROM rsm_programs WHERE id = $1 FOR UPDATE', [programId])
    const ctx: OpCtx = {
      client: client as unknown as Client,
      async snap(ids) {
        const todo = ids.filter((x) => !before.has(x))
        if (!todo.length) return
        const { rows } = await client.query<MemberRow>('SELECT * FROM rsm_members WHERE id = ANY($1::text[]) FOR UPDATE', [todo])
        for (const r of rows) before.set(r.id, r)
      },
      inserted(ids) { inserted.push(...ids) },
    }
    const result = await fn(ctx)
    const opId = uuidv4()
    await client.query(
      `INSERT INTO rsm_ops (id, program_id, kind, label, before, inserted, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [opId, programId, kind, label, JSON.stringify([...before.values()]), JSON.stringify(inserted), by, now()],
    )
    await client.query('UPDATE rsm_programs SET updated_at=$2 WHERE id=$1', [programId, now()])
    await client.query('COMMIT')
    return { opId, result }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function listOps(programId: string, limit = 30): Promise<RsmOp[]> {
  const { rows } = await pool.query<{ id: string; kind: string; label: string; created_by: string; created_at: string; undone_at: string | null; undone_by: string | null; n: number }>(
    `SELECT id, kind, label, created_by, created_at, undone_at, undone_by,
            jsonb_array_length(before) + jsonb_array_length(inserted) AS n
       FROM rsm_ops WHERE program_id = $1 ORDER BY seq DESC LIMIT $2`,
    [programId, limit],
  )
  return rows.map((r) => ({
    id: r.id, kind: r.kind, label: r.label, createdBy: r.created_by, createdAt: Number(r.created_at),
    undoneAt: r.undone_at ? Number(r.undone_at) : null, undoneBy: r.undone_by, rows: Number(r.n),
  }))
}

/**
 * Annulla l'operazione indicata, solo se è l'ULTIMA non annullata del
 * programma (le successive potrebbero dipendere da lei): toglie le righe
 * inserite e rimette quelle fotografate com'erano.
 */
export async function undoLastOp(programId: string, opId: string, by: string): Promise<{ ok: true; label: string } | { ok: false; reason: 'not-last' | 'not-found' | 'already' }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM rsm_programs WHERE id = $1 FOR UPDATE', [programId])
    const { rows } = await client.query<{ id: string; label: string; before: MemberRow[]; inserted: string[]; undone_at: string | null }>(
      `SELECT id, label, before, inserted, undone_at FROM rsm_ops WHERE program_id = $1 AND undone_at IS NULL ORDER BY seq DESC LIMIT 1`,
      [programId],
    )
    const last = rows[0]
    if (!last || last.id !== opId) {
      const { rows: one } = await client.query<{ undone_at: string | null }>('SELECT undone_at FROM rsm_ops WHERE id = $1 AND program_id = $2', [opId, programId])
      await client.query('ROLLBACK')
      return { ok: false, reason: !one[0] ? 'not-found' : one[0].undone_at ? 'already' : 'not-last' }
    }
    if (last.inserted.length) await client.query('DELETE FROM rsm_members WHERE id = ANY($1::text[])', [last.inserted])
    const ids = last.before.map((r) => r.id)
    if (ids.length) {
      await client.query('DELETE FROM rsm_members WHERE id = ANY($1::text[])', [ids])
      await insertRaw(client as unknown as Client, last.before.map((r) => COL_LIST.map((c) => (r as unknown as Record<string, unknown>)[c])))
    }
    await client.query('UPDATE rsm_ops SET undone_at=$2, undone_by=$3 WHERE id=$1', [opId, now(), by])
    await client.query('UPDATE rsm_programs SET updated_at=$2 WHERE id=$1', [programId, now()])
    await client.query('COMMIT')
    return { ok: true, label: last.label }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/* ─── Modifiche (tutte registrate) ───────────────────────────────────────── */

export async function insertMembers(programId: string, members: Partial<NewMember>[], by: string, label: string): Promise<string> {
  const { opId } = await withOp(programId, 'insert', label, by, async (op) => {
    const t = now()
    const ids = members.map(() => uuidv4())
    await insertRaw(op.client, members.map((m, i) => values(ids[i], programId, m, by, t)))
    op.inserted(ids)
  })
  return opId
}

/** Import dello stato di rischio: sostituisce TUTTE le righe del programma. */
export async function replaceMembers(programId: string, members: Partial<NewMember>[], by: string, label: string): Promise<string> {
  const { opId } = await withOp(programId, 'import', label, by, async (op) => {
    const { rows } = await op.client.query<{ id: string }>('SELECT id FROM rsm_members WHERE program_id = $1', [programId])
    await op.snap(rows.map((r) => r.id))
    await op.client.query('DELETE FROM rsm_members WHERE program_id = $1', [programId])
    // gli id di promozione dell'import ('promo-N') diventano unici
    const pids = new Map<string, string>()
    const t = now()
    const ids = members.map(() => uuidv4())
    await insertRaw(op.client, members.map((m, i) => {
      const map = (pid?: string | null) => { if (!pid) return null; if (!pids.has(pid)) pids.set(pid, uuidv4()); return pids.get(pid)! }
      return values(ids[i], programId, { ...m, promotionId: map(m.promotionId), exitPromotionId: map(m.exitPromotionId) }, by, t)
    }))
    op.inserted(ids)
  })
  return opId
}

/** Campi modificabili di una riga (correzioni, cessazione, decorrenza forzata). */
export type MemberPatch = Partial<Pick<RsmMember,
  'cognome' | 'nome' | 'cf' | 'birthDate' | 'legame' | 'cfTitolare' | 'quiescente' | 'entryDate' | 'entryForced' | 'entryKind'
  | 'exitDate' | 'exitKind' | 'exitCommunicated' | 'note'>>

const PATCH_COLS: Record<keyof MemberPatch, string> = {
  cognome: 'cognome', nome: 'nome', cf: 'cf', birthDate: 'birth_date', legame: 'legame', cfTitolare: 'cf_titolare',
  quiescente: 'quiescente', entryDate: 'entry_date', entryForced: 'entry_forced', entryKind: 'entry_kind', exitDate: 'exit_date',
  exitKind: 'exit_kind', exitCommunicated: 'exit_communicated', note: 'note',
}

async function patchRow(client: Client, id: string, patch: MemberPatch) {
  const sets: string[] = []
  const params: unknown[] = [id]
  for (const [k, col] of Object.entries(PATCH_COLS) as [keyof MemberPatch, string][]) {
    if (!(k in patch)) continue
    params.push(patch[k] ?? null)
    sets.push(`${col} = $${params.length}`)
  }
  if (!sets.length) return
  params.push(now())
  sets.push(`updated_at = $${params.length}`)
  await client.query(`UPDATE rsm_members SET ${sets.join(', ')} WHERE id = $1`, params)
}

/**
 * Correzione di una riga. Se cambia il codice fiscale di un titolare, i
 * familiari della stessa categoria lo seguono (nella stessa operazione).
 */
export async function updateMember(programId: string, id: string, patch: MemberPatch, by: string, label: string): Promise<{ opId: string; member: RsmMember | null }> {
  const { opId, result } = await withOp(programId, 'update', label, by, async (op) => {
    await op.snap([id])
    const { rows } = await op.client.query<MemberRow>('SELECT * FROM rsm_members WHERE id = $1', [id])
    const before = rows[0]
    if (before && before.legame === 'TI' && patch.cf && patch.cf !== before.cf) {
      patch = { ...patch, cfTitolare: patch.cf }
      const { rows: fam } = await op.client.query<{ id: string }>(
        'SELECT id FROM rsm_members WHERE program_id=$1 AND category=$2 AND cf_titolare=$3 AND id <> $4', [programId, before.category, before.cf, id])
      await op.snap(fam.map((r) => r.id))
      await op.client.query('UPDATE rsm_members SET cf_titolare=$4, updated_at=$5 WHERE program_id=$1 AND category=$2 AND cf_titolare=$3', [programId, before.category, before.cf, patch.cf, now()])
    }
    await patchRow(op.client, id, patch)
    const { rows: after } = await op.client.query<MemberRow>('SELECT * FROM rsm_members WHERE id = $1', [id])
    return after[0] ? toMember(after[0]) : null
  })
  return { opId, member: result }
}

/** Cessazione di una persona o di un nucleo: stessa data sulle righe indicate. */
export async function setExit(programId: string, ids: string[], exitDate: string, exitCommunicated: string | null, note: string | null, by: string, label: string): Promise<{ opId: string; updated: number }> {
  const { opId, result } = await withOp(programId, 'exit', label, by, async (op) => {
    await op.snap(ids)
    const res = await op.client.query(
      `UPDATE rsm_members SET exit_date=$2, exit_kind='cessazione', exit_communicated=$3,
         note = CASE WHEN $4::text IS NULL OR $4 = '' THEN note WHEN note IS NULL OR note = '' THEN $4 ELSE note || ' · ' || $4 END,
         updated_at=$5
       WHERE id = ANY($1::text[]) AND (exit_kind IS NULL OR exit_kind = 'cessazione')`,
      [ids, exitDate, exitCommunicated, note, now()],
    )
    return res.rowCount ?? 0
  })
  return { opId, updated: result }
}

export async function clearExit(programId: string, id: string, by: string, label: string): Promise<string> {
  const { opId } = await withOp(programId, 'clear-exit', label, by, async (op) => {
    await op.snap([id])
    await patchRow(op.client, id, { exitDate: null, exitKind: null, exitCommunicated: null })
  })
  return opId
}

export async function deleteMembers(programId: string, ids: string[], by: string, label: string): Promise<{ opId: string; deleted: number }> {
  const { opId, result } = await withOp(programId, 'delete', label, by, async (op) => {
    await op.snap(ids)
    const res = await op.client.query('DELETE FROM rsm_members WHERE id = ANY($1::text[])', [ids])
    return res.rowCount ?? 0
  })
  return { opId, deleted: result }
}

/**
 * Promozione: chiude le righe del nucleo nella categoria di partenza dal
 * giorno `date` e apre le stesse persone nella categoria `toCategory`, tutto
 * con lo stesso promotion_id, in una transazione.
 */
export async function promote(programId: string, memberIds: string[], toCategory: string, date: string, note: string | null, by: string, label: string): Promise<{ opId: string; promotionId: string }> {
  const promotionId = uuidv4()
  const { opId } = await withOp(programId, 'promote', label, by, async (op) => {
    await op.snap(memberIds)
    const { rows } = await op.client.query<MemberRow>('SELECT * FROM rsm_members WHERE program_id = $1 AND id = ANY($2::text[])', [programId, memberIds])
    if (rows.length !== memberIds.length) throw new Error('Alcune persone non sono più nel programma.')
    const t = now()
    await op.client.query(
      `UPDATE rsm_members SET exit_date=$2, exit_kind='promozione', exit_promotion_id=$3, updated_at=$4 WHERE id = ANY($1::text[])`,
      [memberIds, date, promotionId, t],
    )
    const ids = rows.map(() => uuidv4())
    await insertRaw(op.client, rows.map(toMember).map((m, i) => values(ids[i], programId, {
      category: toCategory, quiescente: m.quiescente, cf: m.cf, cognome: m.cognome, nome: m.nome, birthDate: m.birthDate,
      legame: m.legame, cfTitolare: m.cfTitolare, entryDate: date, entryKind: 'promozione', requestedDate: date,
      communicatedDate: null, entryForced: false, exitDate: null, exitKind: null, exitCommunicated: null, promotionId,
      exitPromotionId: null, source: 'Promozione', note,
    }, by, t)))
    op.inserted(ids)
  })
  return { opId, promotionId }
}

/**
 * Annulla una promozione registrata: toglie le righe che ha creato e riapre
 * quelle che ha chiuso. Le righe create non devono avere a loro volta
 * un'uscita (lo controlla la route: prima si annulla la promozione successiva).
 */
export async function undoPromotion(programId: string, promotionId: string, by: string, label: string): Promise<string> {
  const { opId } = await withOp(programId, 'undo-promote', label, by, async (op) => {
    const { rows } = await op.client.query<{ id: string }>(
      'SELECT id FROM rsm_members WHERE program_id=$1 AND (promotion_id=$2 OR exit_promotion_id=$2)', [programId, promotionId])
    await op.snap(rows.map((r) => r.id))
    await op.client.query(`DELETE FROM rsm_members WHERE program_id=$1 AND promotion_id=$2 AND entry_kind='promozione'`, [programId, promotionId])
    await op.client.query(
      `UPDATE rsm_members SET exit_date=NULL, exit_kind=NULL, exit_promotion_id=NULL, updated_at=$3 WHERE program_id=$1 AND exit_promotion_id=$2`,
      [programId, promotionId, now()],
    )
  })
  return opId
}

/** Righe di un file confermate: entrate nuove e uscite, in UNA operazione. */
export async function registerChanges(
  programId: string, entries: Partial<NewMember>[], exits: { ids: string[]; date: string; comm: string | null; note: string | null }[], by: string, label: string,
): Promise<string> {
  const { opId } = await withOp(programId, 'register', label, by, async (op) => {
    const t = now()
    const ids = entries.map(() => uuidv4())
    if (entries.length) await insertRaw(op.client, entries.map((m, i) => values(ids[i], programId, m, by, t)))
    op.inserted(ids)
    for (const x of exits) {
      await op.snap(x.ids)
      await op.client.query(
        `UPDATE rsm_members SET exit_date=$2, exit_kind='cessazione', exit_communicated=$3,
           note = CASE WHEN $4::text IS NULL OR $4 = '' THEN note WHEN note IS NULL OR note = '' THEN $4 ELSE note || ' · ' || $4 END,
           updated_at=$5
         WHERE id = ANY($1::text[]) AND (exit_kind IS NULL OR exit_kind = 'cessazione')`,
        [x.ids, x.date, x.comm, x.note, t],
      )
    }
  })
  return opId
}
