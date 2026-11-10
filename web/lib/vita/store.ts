// POLIZZA VITA — accesso al DB (tabelle vita_programs, vita_insured, vita_ops:
// db.ts). Le regole di calcolo stanno in rules.js; qui solo lettura e scrittura
// dei fatti (RAL, documentazione, date, passaggi). Ogni modifica passa da
// `withOp`: in una transazione salva nel registro le righe com'erano prima e gli
// id inseriti, così l'ultima operazione si annulla esattamente (`undoLastOp`).
import { v4 as uuidv4 } from 'uuid'
import { pool } from '../db'
import type { VitaConfig, VitaInsured, VitaOp, VitaProgram } from './types'

const now = () => Math.floor(Date.now() / 1000)
const num = (v: unknown) => (v == null ? 0 : Number(v))

interface Row {
  id: string; program_id: string; company: string; cf: string; cognome: string; nome: string
  birth_date: string | null; level: string; ral: string; key_figure: boolean; sovr_pct: string
  doc_visit: boolean; doc_extra: boolean; doc_ok: boolean; doc_checkup_date: string | null
  reminded_on: string | null; entry_date: string | null; entry_kind: string; communicated_date: string | null
  exit_date: string | null; exit_kind: string | null; exit_communicated: string | null
  transfer_id: string | null; exit_transfer_id: string | null; next_ral: string | null
  source: string | null; note: string | null; created_by: string; created_at: string; updated_at: string
}

function toInsured(r: Row): VitaInsured {
  return {
    id: r.id, programId: r.program_id, company: r.company, cf: r.cf, cognome: r.cognome, nome: r.nome,
    birthDate: r.birth_date, level: r.level, ral: num(r.ral), keyFigure: r.key_figure, sovrPct: num(r.sovr_pct),
    doc: { visit: r.doc_visit, extra: r.doc_extra, ok: r.doc_ok, checkupDate: r.doc_checkup_date },
    remindedOn: r.reminded_on, entryDate: r.entry_date, entryKind: r.entry_kind as VitaInsured['entryKind'],
    communicatedDate: r.communicated_date, exitDate: r.exit_date, exitKind: r.exit_kind as VitaInsured['exitKind'],
    exitCommunicated: r.exit_communicated, transferId: r.transfer_id, exitTransferId: r.exit_transfer_id,
    nextRal: r.next_ral == null ? null : num(r.next_ral), source: r.source, note: r.note,
    createdBy: r.created_by, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
  }
}

interface ProgramRow { id: string; name: string; year: number; config: VitaConfig; created_by: string; created_at: string; updated_at: string }
const toProgram = (r: ProgramRow): VitaProgram => ({
  id: r.id, name: r.name, year: r.year, config: r.config, createdBy: r.created_by,
  createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
})

export async function listPrograms(): Promise<VitaProgram[]> {
  const { rows } = await pool.query<ProgramRow>('SELECT * FROM vita_programs ORDER BY year DESC, name')
  return rows.map(toProgram)
}

export async function getProgram(id: string): Promise<VitaProgram | null> {
  const { rows } = await pool.query<ProgramRow>('SELECT * FROM vita_programs WHERE id = $1', [id])
  return rows[0] ? toProgram(rows[0]) : null
}

export async function createProgram(name: string, year: number, config: VitaConfig, by: string): Promise<VitaProgram> {
  const t = now()
  const { rows } = await pool.query<ProgramRow>(
    'INSERT INTO vita_programs (id, name, year, config, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING *',
    [uuidv4(), name, year, JSON.stringify(config), by, t],
  )
  return toProgram(rows[0])
}

export async function updateProgram(id: string, name: string, year: number, config: VitaConfig): Promise<VitaProgram | null> {
  const { rows } = await pool.query<ProgramRow>(
    'UPDATE vita_programs SET name=$2, year=$3, config=$4, updated_at=$5 WHERE id=$1 RETURNING *',
    [id, name, year, JSON.stringify(config), now()],
  )
  return rows[0] ? toProgram(rows[0]) : null
}

export async function deleteProgram(id: string): Promise<boolean> {
  const res = await pool.query('DELETE FROM vita_programs WHERE id = $1', [id])
  return (res.rowCount ?? 0) > 0
}

export async function listInsured(programId: string): Promise<VitaInsured[]> {
  const { rows } = await pool.query<Row>(
    'SELECT * FROM vita_insured WHERE program_id = $1 ORDER BY company, cognome, nome, entry_date',
    [programId],
  )
  return rows.map(toInsured)
}

export type NewInsured = Omit<VitaInsured, 'id' | 'programId' | 'createdBy' | 'createdAt' | 'updatedAt'>

const COLS = 'id, program_id, company, cf, cognome, nome, birth_date, level, ral, key_figure, sovr_pct, doc_visit, doc_extra, doc_ok, doc_checkup_date, reminded_on, entry_date, entry_kind, communicated_date, exit_date, exit_kind, exit_communicated, transfer_id, exit_transfer_id, next_ral, source, note, created_by, created_at, updated_at'
const COL_LIST = COLS.split(', ')

function values(id: string, programId: string, m: Partial<NewInsured>, by: string, t: number) {
  const d = m.doc || { visit: false, extra: false, ok: false, checkupDate: null }
  return [
    id, programId, m.company, m.cf || '', m.cognome || '', m.nome || '', m.birthDate || null, m.level || '',
    m.ral ?? 0, !!m.keyFigure, m.sovrPct ?? 0, !!d.visit, !!d.extra, !!d.ok, d.checkupDate || null,
    m.remindedOn || null, m.entryDate || null, m.entryKind || 'inclusione', m.communicatedDate || null,
    m.exitDate || null, m.exitKind || null, m.exitCommunicated || null, m.transferId || null,
    m.exitTransferId || null, m.nextRal ?? null, m.source || null, m.note || null, by, t, t,
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
    await client.query(`INSERT INTO vita_insured (${COLS}) VALUES ${tuples.join(',')}`, params)
  }
}

/* ─── Registro delle operazioni ──────────────────────────────────────────── */

interface OpCtx {
  /** Fotografa le righe indicate PRIMA di modificarle o cancellarle. */
  snap: (ids: string[]) => Promise<void>
  /** Annota gli id inseriti (l'annullamento li cancella). */
  inserted: (ids: string[]) => void
  client: Client
}

async function withOp<T>(programId: string, kind: string, label: string, by: string, fn: (op: OpCtx) => Promise<T>): Promise<{ opId: string; result: T }> {
  const client = await pool.connect()
  const before = new Map<string, Row>()
  const inserted: string[] = []
  try {
    await client.query('BEGIN')
    // una modifica alla volta per programma: l'annullamento non sovrascrive mai un lavoro concorrente
    await client.query('SELECT id FROM vita_programs WHERE id = $1 FOR UPDATE', [programId])
    const ctx: OpCtx = {
      client: client as unknown as Client,
      async snap(ids) {
        const todo = ids.filter((x) => !before.has(x))
        if (!todo.length) return
        const { rows } = await client.query<Row>('SELECT * FROM vita_insured WHERE id = ANY($1::text[]) FOR UPDATE', [todo])
        for (const r of rows) before.set(r.id, r)
      },
      inserted(ids) { inserted.push(...ids) },
    }
    const result = await fn(ctx)
    const opId = uuidv4()
    await client.query(
      'INSERT INTO vita_ops (id, program_id, kind, label, before, inserted, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [opId, programId, kind, label, JSON.stringify([...before.values()]), JSON.stringify(inserted), by, now()],
    )
    await client.query('UPDATE vita_programs SET updated_at=$2 WHERE id=$1', [programId, now()])
    await client.query('COMMIT')
    return { opId, result }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function listOps(programId: string, limit = 30): Promise<VitaOp[]> {
  const { rows } = await pool.query<{ id: string; kind: string; label: string; created_by: string; created_at: string; undone_at: string | null; undone_by: string | null; n: number }>(
    `SELECT id, kind, label, created_by, created_at, undone_at, undone_by,
            jsonb_array_length(before) + jsonb_array_length(inserted) AS n
       FROM vita_ops WHERE program_id = $1 ORDER BY seq DESC LIMIT $2`,
    [programId, limit],
  )
  return rows.map((r) => ({
    id: r.id, kind: r.kind, label: r.label, createdBy: r.created_by, createdAt: Number(r.created_at),
    undoneAt: r.undone_at ? Number(r.undone_at) : null, undoneBy: r.undone_by, rows: Number(r.n),
  }))
}

/**
 * Annulla l'operazione indicata, solo se è l'ULTIMA non annullata del programma
 * (le successive potrebbero dipendere da lei): toglie le righe inserite e rimette
 * quelle fotografate com'erano.
 */
export async function undoLastOp(programId: string, opId: string, by: string): Promise<{ ok: true; label: string } | { ok: false; reason: 'not-last' | 'not-found' | 'already' }> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM vita_programs WHERE id = $1 FOR UPDATE', [programId])
    const { rows } = await client.query<{ id: string; label: string; before: Row[]; inserted: string[] }>(
      'SELECT id, label, before, inserted FROM vita_ops WHERE program_id = $1 AND undone_at IS NULL ORDER BY seq DESC LIMIT 1',
      [programId],
    )
    const last = rows[0]
    if (!last || last.id !== opId) {
      const { rows: one } = await client.query<{ undone_at: string | null }>('SELECT undone_at FROM vita_ops WHERE id = $1 AND program_id = $2', [opId, programId])
      await client.query('ROLLBACK')
      return { ok: false, reason: !one[0] ? 'not-found' : one[0].undone_at ? 'already' : 'not-last' }
    }
    if (last.inserted.length) await client.query('DELETE FROM vita_insured WHERE id = ANY($1::text[])', [last.inserted])
    const ids = last.before.map((r) => r.id)
    if (ids.length) {
      await client.query('DELETE FROM vita_insured WHERE id = ANY($1::text[])', [ids])
      await insertRaw(client as unknown as Client, last.before.map((r) => COL_LIST.map((c) => (r as unknown as Record<string, unknown>)[c])))
    }
    await client.query('UPDATE vita_ops SET undone_at=$2, undone_by=$3 WHERE id=$1', [opId, now(), by])
    await client.query('UPDATE vita_programs SET updated_at=$2 WHERE id=$1', [programId, now()])
    await client.query('COMMIT')
    return { ok: true, label: last.label }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/* ─── Scritture ──────────────────────────────────────────────────────────── */

/** Sostituisce TUTTE le righe del programma (import dello stato di rischio). */
export async function replaceInsured(programId: string, list: Partial<NewInsured>[], by: string, label: string): Promise<{ opId: string; n: number }> {
  const { opId, result } = await withOp(programId, 'import', label, by, async (op) => {
    const { rows } = await op.client.query<{ id: string }>('SELECT id FROM vita_insured WHERE program_id = $1', [programId])
    await op.snap(rows.map((r) => r.id))
    await op.client.query('DELETE FROM vita_insured WHERE program_id = $1', [programId])
    const t = now()
    const ids = list.map(() => uuidv4())
    await insertRaw(op.client, list.map((m, i) => values(ids[i], programId, m, by, t)))
    op.inserted(ids)
    return list.length
  })
  return { opId, n: result }
}

/** Aggiunge righe senza toccare le altre (inclusioni). */
export async function addInsured(programId: string, list: Partial<NewInsured>[], by: string, label: string): Promise<{ opId: string; ids: string[] }> {
  const { opId, result } = await withOp(programId, 'inclusione', label, by, async (op) => {
    const t = now()
    const ids = list.map(() => uuidv4())
    await insertRaw(op.client, list.map((m, i) => values(ids[i], programId, m, by, t)))
    op.inserted(ids)
    return ids
  })
  return { opId, ids: result }
}

export type InsuredPatch = Partial<Pick<VitaInsured, 'cognome' | 'nome' | 'birthDate' | 'level' | 'ral' | 'keyFigure' | 'sovrPct' | 'doc' | 'remindedOn' | 'entryDate' | 'entryKind' | 'communicatedDate' | 'nextRal' | 'note'>>

const PATCH_COL: Record<string, string> = {
  cognome: 'cognome', nome: 'nome', birthDate: 'birth_date', level: 'level', ral: 'ral', keyFigure: 'key_figure',
  sovrPct: 'sovr_pct', remindedOn: 'reminded_on', entryDate: 'entry_date', entryKind: 'entry_kind',
  communicatedDate: 'communicated_date', nextRal: 'next_ral', note: 'note',
}

export async function updateInsured(programId: string, id: string, patch: InsuredPatch, by: string, label: string): Promise<{ opId: string; ok: boolean }> {
  const { opId, result } = await withOp(programId, 'modifica', label, by, async (op) => {
    await op.snap([id])
    const sets: string[] = []
    const params: unknown[] = [id, programId]
    const add = (col: string, v: unknown) => { params.push(v); sets.push(`${col}=$${params.length}`) }
    for (const [k, col] of Object.entries(PATCH_COL)) if (k in patch) add(col, (patch as Record<string, unknown>)[k] ?? null)
    if (patch.doc) {
      add('doc_visit', !!patch.doc.visit)
      add('doc_extra', !!patch.doc.extra)
      add('doc_ok', !!patch.doc.ok)
      add('doc_checkup_date', patch.doc.checkupDate || null)
    }
    if (!sets.length) return false
    add('updated_at', now())
    const res = await op.client.query(`UPDATE vita_insured SET ${sets.join(', ')} WHERE id=$1 AND program_id=$2`, params)
    return (res.rowCount ?? 0) > 0
  })
  return { opId, ok: result }
}

/** Registra un'uscita (cessazione). La copertura resta fino alla data indicata esclusa. */
export async function setExit(programId: string, ids: string[], exitDate: string, communicated: string | null, note: string | null, by: string, label: string): Promise<{ opId: string; n: number }> {
  const { opId, result } = await withOp(programId, 'cessazione', label, by, async (op) => {
    await op.snap(ids)
    const res = await op.client.query(
      `UPDATE vita_insured SET exit_date=$3, exit_kind='cessazione', exit_communicated=$4,
              note = COALESCE(NULLIF($5,''), note), updated_at=$6
         WHERE id = ANY($1::text[]) AND program_id=$2 AND exit_kind IS NULL`,
      [ids, programId, exitDate, communicated, note || '', now()],
    )
    return res.rowCount ?? 0
  })
  return { opId, n: result }
}

export async function clearExit(programId: string, id: string, by: string, label: string): Promise<{ opId: string; ok: boolean }> {
  const { opId, result } = await withOp(programId, 'cessazione-annullata', label, by, async (op) => {
    await op.snap([id])
    const res = await op.client.query(
      `UPDATE vita_insured SET exit_date=NULL, exit_kind=NULL, exit_communicated=NULL, updated_at=$3
         WHERE id=$1 AND program_id=$2 AND exit_kind='cessazione'`,
      [id, programId, now()],
    )
    return (res.rowCount ?? 0) > 0
  })
  return { opId, ok: result }
}

/**
 * Passaggio fra contraenti (SGR ↔ RE): la riga vecchia esce dal giorno indicato e
 * se ne apre una nuova sull'altra polizza dalla stessa data, con lo stesso
 * transfer_id. Sulla nuova polizza i diritti si pagano di nuovo (regola del cliente).
 */
export async function transfer(programId: string, id: string, toCompany: string, date: string, note: string | null, by: string, label: string): Promise<{ opId: string; transferId: string }> {
  const { opId, result } = await withOp(programId, 'passaggio', label, by, async (op) => {
    await op.snap([id])
    const { rows } = await op.client.query<Row>('SELECT * FROM vita_insured WHERE id=$1 AND program_id=$2', [id, programId])
    const r = rows[0]
    if (!r) throw new Error('Assicurato non trovato')
    const transferId = uuidv4()
    await op.client.query(
      `UPDATE vita_insured SET exit_date=$3, exit_kind='passaggio', exit_transfer_id=$4, updated_at=$5 WHERE id=$1 AND program_id=$2`,
      [id, programId, date, transferId, now()],
    )
    const newId = uuidv4()
    const old = toInsured(r)
    await insertRaw(op.client, [values(newId, programId, {
      ...old, company: toCompany, entryDate: date, entryKind: 'passaggio', communicatedDate: null,
      exitDate: null, exitKind: null, exitCommunicated: null, transferId, exitTransferId: null,
      note: note || old.note, source: `Passaggio da ${r.company}`,
    }, by, now())])
    op.inserted([newId])
    return transferId
  })
  return { opId, transferId: result }
}

/** RAL dell'anno dopo, dal file di rinnovo dell'Azienda. */
export async function setNextRal(programId: string, byCf: Record<string, number>, by: string, label: string): Promise<{ opId: string; n: number }> {
  const { opId, result } = await withOp(programId, 'rinnovo', label, by, async (op) => {
    const { rows } = await op.client.query<{ id: string; cf: string }>('SELECT id, cf FROM vita_insured WHERE program_id=$1', [programId])
    const todo = rows.filter((r) => byCf[r.cf] != null)
    await op.snap(todo.map((r) => r.id))
    for (const r of todo) {
      await op.client.query('UPDATE vita_insured SET next_ral=$2, updated_at=$3 WHERE id=$1', [r.id, byCf[r.cf], now()])
    }
    return todo.length
  })
  return { opId, n: result }
}
