// RIEPILOGHI GENERALI (26/09/2026) — composizione lato server, SENZA database.
//
// Qui stanno le regole del server che non sono aggregati: stato dei membri
// (live o fotografia), campi di riferimento, anno e scadenza effettivi,
// ammissione dei job, creazione, anteprima e modifica (PATCH) di un
// riepilogo. Le letture dal database arrivano come dipendenze (SummaryDeps),
// così tutto si prova senza Postgres (test/summaryServer.cases.mjs); le
// scritture e la transazione restano in summaryStore.ts.
//
// Regole (CLAUDE.md, REGOLE_AGENTI.md): il tipo di un campo lo decide SOLO il
// modulo puro (classifyField, dalla descrizione), mai id o label; entrano solo
// job 'done' dello stesso profilo; i field_defs sono quelli CONGELATI nei job
// (o nella fotografia), non quelli attuali del profilo — il profilo delle
// impostazioni serve solo da ripiego quando nessun membro è disponibile.

import type { JobLightRow, JobRunRow } from './polizzaJobStore'
import type {
  Eligibility, ProfileLike, ResolvedMember, SnapshotMemberInput, SummaryDetail, SummaryFieldDef, SummaryInfo,
  SummaryMember, SummaryMode, SummaryPatchResult, SummaryPreview, SummaryPrefs, SummaryRow, SummarySnapshot,
  SummarySvc, SummaryViewQuery, SummaryWarning,
} from './summaryTypes'
import { forcedWithoutPolicy, isNotValidJob } from './jobValidity'

export const MAX_SUMMARY_NAME = 120

// ─── Utilità ─────────────────────────────────────────────────────────────────

/** Data di oggi in Europe/Rome, 'GG/MM/AAAA' (il modulo puro non legge l'orologio). */
export function todayRome(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  return `${get('day')}/${get('month')}/${get('year')}`
}

/** Nome del riepilogo: 1–120 caratteri dopo il trim, altrimenti null. */
export function cleanSummaryName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  return s && s.length <= MAX_SUMMARY_NAME ? s : null
}

/** Parametri di vista dalla query: ?anno=2025|none&gruppo=<chiave>&a=2024&b=2025&campo=<id>. */
export function parseViewQuery(sp: URLSearchParams): SummaryViewQuery {
  const view: SummaryViewQuery = {}
  const year = (v: string | null) => (v && /^\d{4}$/.test(v) ? Number(v) : undefined)
  const anno = sp.get('anno')
  if (anno === 'none') view.year = 'none'
  else if (year(anno) !== undefined) view.year = year(anno)
  const gruppo = sp.get('gruppo')
  if (gruppo && gruppo.length <= 200) view.group = gruppo
  if (year(sp.get('a')) !== undefined) view.yearA = year(sp.get('a'))
  if (year(sp.get('b')) !== undefined) view.yearB = year(sp.get('b'))
  const campo = sp.get('campo')
  if (campo && campo.length <= 64) view.field = campo
  return view
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

const defShape = (f: { id: string; label?: string; description?: string; type?: string; frozen?: SummaryFieldDef['frozen'] }): SummaryFieldDef => ({
  id: f.id,
  label: f.label ?? f.id,
  ...(f.description != null ? { description: f.description } : {}),
  ...(f.type != null ? { type: f.type } : {}),
  // classificazione congelata di una fotografia (freezeField): si porta dietro così com'è
  ...(f.frozen && typeof f.frozen === 'object' ? { frozen: f.frozen } : {}),
})

const hasDescriptions = (defs: { description?: string }[] | null | undefined) => (defs || []).some((f) => f && typeof f.description === 'string' && !!f.description.trim())

function pickValues(values: Record<string, string> | null | undefined, ids: Set<string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(values || {})) if (ids.has(k) && v != null) out[k] = String(v)
  return out
}

/** Campi ABILITATI del profilo delle impostazioni con quella chiave (solo ripiego). */
export function profileFieldDefs(profiles: ProfileLike[], key: string | null): SummaryFieldDef[] {
  const p = key ? (profiles || []).find((x) => x && x.id === key) : null
  return (p?.fields || []).filter((f) => f && f.id && f.enabled !== false).map(defShape)
}

function profileNameOf(profiles: ProfileLike[], key: string | null): string | null {
  const p = key ? (profiles || []).find((x) => x && x.id === key) : null
  return p?.name || null
}

/** Il campo esiste tra `fields` ed è una DATA secondo la descrizione (classifyField). */
export function isDateField(svc: SummarySvc, fields: SummaryFieldDef[], id: unknown): id is string {
  return typeof id === 'string' && !!id && fields.some((f) => f.id === id && svc.classifyField(f).kind === 'date')
}

// ─── Dipendenze (letture) ────────────────────────────────────────────────────

export interface JobLabel { dossier_name: string | null; scanned_files: string[]; batch_label: string | null }

export interface SummaryDeps {
  profiles: ProfileLike[]
  /** Secondi dall'epoca. */
  now(): number
  newId(): string
  loadJobs(ids: string[]): Promise<JobLightRow[]>
  /** Ultima run 'done' per job. */
  loadRuns(ids: string[]): Promise<Map<string, JobRunRow>>
  loadLabels(ids: string[]): Promise<Map<string, JobLabel>>
  loadHashes(ids: string[]): Promise<Record<string, (string | null)[]>>
  /** Ultimo riepilogo aggiornato con la stessa chiave di profilo (preferenze ereditate). */
  latestForProfile(key: string): Promise<Pick<SummaryRow, 'prefs' | 'year_field_id' | 'due_field_id'> | null>
}

/**
 * Letture di UNA richiesta con memoria: il PATCH legge job e run per validare
 * e poi per il dettaglio restituito; la seconda lettura (stessi id, pochi
 * millisecondi dopo) non torna al database.
 */
export function memoDeps<D extends SummaryDeps>(d: D): D {
  const jobs = new Map<string, Promise<JobLightRow[]>>()
  const runs = new Map<string, Promise<Map<string, JobRunRow>>>()
  const key = (ids: string[]) => [...ids].sort().join(',')
  return {
    ...d,
    loadJobs: (ids: string[]) => {
      const k = key(ids)
      if (!jobs.has(k)) jobs.set(k, d.loadJobs(ids))
      return jobs.get(k)!
    },
    loadRuns: (ids: string[]) => {
      const k = key(ids)
      if (!runs.has(k)) runs.set(k, d.loadRuns(ids))
      return runs.get(k)!
    },
  }
}

/** Colonne di polizza_summaries che un PATCH può scrivere (whitelist dell'UPDATE). */
export const SUMMARY_UPDATABLE = ['name', 'year_field_id', 'due_field_id', 'mode', 'job_ids', 'snapshot', 'prefs', 'field_sigs'] as const
export type SummaryUpdatable = (typeof SUMMARY_UPDATABLE)[number]

/** Le sole colonne ammesse che cambiano tra due righe: un cambio di calcolo non riscrive fotografia ed elenco. */
export function changedColumns(before: SummaryRow, after: SummaryRow): Partial<Pick<SummaryRow, SummaryUpdatable>> {
  const out: Partial<Pick<SummaryRow, SummaryUpdatable>> = {}
  for (const col of SUMMARY_UPDATABLE) {
    if (JSON.stringify(before[col] ?? null) !== JSON.stringify(after[col] ?? null)) (out as Record<string, unknown>)[col] = after[col]
  }
  return out
}

export interface CoreError {
  ok: false
  status: number
  body: { error: string; code: string } & Record<string, unknown>
}
const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}): CoreError => ({ ok: false, status, body: { error, code, ...extra } })

// ─── Membri ──────────────────────────────────────────────────────────────────

interface MemberInfo { name: string; path: string; dossierName: string | null; batchId: string | null; batchLabel: string | null; scannedFiles: string[] }
export interface ResolvedEntry { jobId: string; r: ResolvedMember; info: MemberInfo; kept: boolean }

function infoFromJob(svc: SummarySvc, job: JobLightRow): MemberInfo {
  const { name, path } = svc.policyName({ dossierName: job.dossier_name, batchLabel: job.batch_label, scannedFiles: job.scanned_files, jobId: job.id })
  return { name, path, dossierName: job.dossier_name, batchId: job.batch_id, batchLabel: job.batch_label, scannedFiles: job.scanned_files || [] }
}

function infoFromEntry(svc: SummarySvc, jobId: string, e: SummarySnapshot['jobs'][string]): MemberInfo {
  const { name, path } = svc.policyName({ dossierName: e.dossierName, batchLabel: e.batchLabel, scannedFiles: e.scannedFiles, jobId })
  return { name, path, dossierName: e.dossierName, batchId: e.batchId, batchLabel: e.batchLabel, scannedFiles: e.scannedFiles || [] }
}

const infoMissing = (jobId: string): MemberInfo => ({ name: jobId.slice(0, 8), path: '', dossierName: null, batchId: null, batchLabel: null, scannedFiles: [] })

const keyOf = (k: { key: string } | { error: string } | null): string | null => (k && 'key' in k ? k.key : null)

/**
 * Le run salvano i campi SENZA descrizione ({id, label}): senza descrizione
 * ogni campo sarebbe un testo (niente importi, «Anno da» perso). Si completano
 * per id dai campi del job (se il job ha ancora la chiave del riepilogo) o dal
 * profilo del riepilogo nelle impostazioni — mai da un profilo diverso: gli id
 * di campo sono condivisi tra profili con significati diversi.
 */
export function describeRunFields(run: JobRunRow | null, job: JobLightRow | null, jobKey: string | null, summaryKey: string, profiles: ProfileLike[]): JobRunRow | null {
  if (!run || !Array.isArray(run.fields) || !run.fields.length) return run
  const byId = new Map<string, { description?: string; type?: string }>()
  if (job && jobKey === summaryKey) for (const f of job.field_defs || []) if (f && f.id) byId.set(f.id, f)
  const p = (profiles || []).find((x) => x && x.id === summaryKey)
  for (const f of p?.fields || []) if (f && f.id && !byId.has(f.id)) byId.set(f.id, f)
  if (!byId.size) return run
  const fields = run.fields.map((f) => {
    const src = f && !(f as { description?: string }).description ? byId.get(f.id) : undefined
    if (!src) return f
    return { ...f, ...(src.description != null ? { description: src.description } : {}), ...(src.type != null ? { type: src.type } : {}) }
  })
  return { ...run, fields }
}

/**
 * Stato di ogni membro (resolveMember del modulo puro) con le chiavi di profilo
 * già risolte: job e ultima run 'done' (runs, solo per i job non 'done').
 * In fotografia bastano le voci della fotografia (jobs può essere vuoto).
 */
export function resolveMembers(svc: SummarySvc, p: {
  mode: SummaryMode
  jobIds: string[]
  summaryKey: string
  jobs: Map<string, JobLightRow>
  runs: Map<string, JobRunRow>
  snapshot: SummarySnapshot | null
  profiles: ProfileLike[]
  /** Firme delle singole ammesse nel riepilogo (row.field_sigs). */
  acceptedSigs?: string[]
}): ResolvedEntry[] {
  const opts = { preferKey: p.summaryKey, acceptedSigs: p.acceptedSigs || [] }
  return p.jobIds.map((jobId) => {
    const job = p.jobs.get(jobId) || null
    if (p.mode === 'snapshot') {
      const entry = p.snapshot?.jobs?.[jobId] || null
      const r = svc.resolveMember({ mode: 'snapshot', job, snapshotEntry: entry })
      const info = entry ? infoFromEntry(svc, jobId, entry) : job ? infoFromJob(svc, job) : infoMissing(jobId)
      return { jobId, r, info, kept: !!entry?.kept }
    }
    const rawRun = p.runs.get(jobId) || null
    const jobKey = job ? keyOf(svc.profileKeyOf(job, p.profiles, opts)) : null
    const runKey = rawRun
      ? keyOf(svc.profileKeyOf({ profile_id: rawRun.profile_id, profile_name: rawRun.profile_name, field_defs: rawRun.fields, status: 'done' }, p.profiles, opts))
      : null
    const run = runKey === p.summaryKey ? describeRunFields(rawRun, job, jobKey, p.summaryKey, p.profiles) : rawRun
    const r = svc.resolveMember({
      mode: 'live',
      job,
      lastDoneRun: run,
      summaryKey: p.summaryKey,
      jobKey,
      runKey,
      notValid: isNotValidJob(job),
      forced: forcedWithoutPolicy(job),
    })
    return { jobId, r, info: job ? infoFromJob(svc, job) : infoMissing(jobId), kept: false }
  })
}

/**
 * Letture per lo stato live: i job e, SOLO per quelli non 'done' (e non
 * bloccati: mismatch/review non usano la run), l'ultima run 'done'.
 */
export async function loadLiveMaps(deps: SummaryDeps, jobIds: string[]): Promise<{ jobs: Map<string, JobLightRow>; runs: Map<string, JobRunRow> }> {
  const list = jobIds.length ? await deps.loadJobs(jobIds) : []
  const jobs = new Map(list.map((j) => [j.id, j]))
  const needRuns = jobIds.filter((id) => {
    const j = jobs.get(id)
    return !!j && j.status !== 'done' && j.status !== 'mismatch' && j.status !== 'review'
  })
  const runs = needRuns.length ? await deps.loadRuns(needRuns) : new Map<string, JobRunRow>()
  return { jobs, runs }
}

/**
 * Campi del riepilogo (Regola 4: N = campi del profilo di RIFERIMENTO).
 * Fotografia: quelli congelati nella fotografia. Live: referenceFields sui
 * membri 'ok' (gli 'stale' se non ce ne sono); se nessun membro è disponibile,
 * `fallback` (i campi della fotografia precedente) oppure il profilo delle
 * impostazioni con la stessa chiave.
 */
export function summaryFields(svc: SummarySvc, p: {
  mode: SummaryMode
  resolved: ResolvedEntry[]
  snapshot: SummarySnapshot | null
  profiles: ProfileLike[]
  summaryKey: string
  fallback?: SummaryFieldDef[] | null
}): { fields: SummaryFieldDef[]; removed: SummaryFieldDef[] } {
  if (p.mode === 'snapshot' && p.snapshot) {
    const fields = (p.snapshot.fieldDefs || []).filter((f) => f && f.id).map(defShape)
    const have = new Set(fields.map((f) => f.id))
    const removed = (p.snapshot.removedFieldDefs || []).filter((f) => f && f.id && !have.has(f.id)).map(defShape)
    if (fields.length) return { fields, removed }
    return { fields: profileFieldDefs(p.profiles, p.summaryKey), removed }
  }
  const sources = (state: string) => p.resolved
    .filter((x) => x.r.state === state && Array.isArray(x.r.fieldDefs) && x.r.fieldDefs.length)
    .map((x) => ({ fieldDefs: x.r.fieldDefs, at: x.r.valuesAt ?? 0 }))
  let src = sources('ok')
  if (!src.length) src = sources('stale')
  const ref = svc.referenceFields(src)
  // Un riferimento SENZA descrizioni (solo run non completabili) viene dopo i
  // ripieghi descritti: la fotografia precedente, poi il profilo.
  if (ref.fields.length && hasDescriptions(ref.fields)) return ref
  const fb = (p.fallback || []).filter((f) => f && f.id).map(defShape)
  const alt = fb.length ? fb : profileFieldDefs(p.profiles, p.summaryKey)
  if (alt.length) return { fields: alt, removed: [] }
  return ref
}

/** «Anno da» e «Scadenza da» effettivi: i salvati se sono ancora date del profilo, altrimenti i default. */
export function effectiveDates(svc: SummarySvc, row: Pick<SummaryRow, 'year_field_id' | 'due_field_id'>, fields: SummaryFieldDef[], policies: { values?: Record<string, string> }[]): { yearFieldId: string | null; dueFieldId: string | null } {
  const yearFieldId = isDateField(svc, fields, row.year_field_id) ? row.year_field_id : svc.defaultYearFieldId(fields)
  const dueFieldId = row.due_field_id == null
    ? null
    : isDateField(svc, fields, row.due_field_id) ? row.due_field_id : svc.defaultDueFieldId(fields, policies, yearFieldId)
  return { yearFieldId, dueFieldId }
}

const STATE_RANK: Record<string, number> = { missing: 0, excluded: 1, stale: 2, ok: 3 }

export function summaryInfo(row: SummaryRow, eff: { yearFieldId: string | null; dueFieldId: string | null; fieldCount: number }): SummaryInfo {
  return {
    id: row.id,
    name: row.name,
    profileId: row.profile_id,
    profileName: row.profile_name,
    mode: row.mode,
    jobCount: row.job_ids.length,
    snapshotAt: row.snapshot?.takenAt ?? null,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    yearFieldId: eff.yearFieldId,
    dueFieldId: eff.dueFieldId,
    fieldCount: eff.fieldCount,
  }
}

/**
 * Dettaglio completo (corpo di GET /api/polizza/summaries/[id]): membri
 * risolti, campi di riferimento, aggregati di summarize, testata, elenco dei
 * membri (drawer: prima i mancanti e gli esclusi, poi per nome) e avvisi
 * (membri + fotografia conservata + stessa polizza due volte).
 * `values: 'all'` e `prefsOverride` servono all'export (tutti i valori, righe 'all').
 */
export function composeDetail(svc: SummarySvc, p: {
  row: SummaryRow
  jobs: Map<string, JobLightRow>
  runs: Map<string, JobRunRow>
  profiles: ProfileLike[]
  today: string
  view?: SummaryViewQuery
  values?: 'all'
  prefsOverride?: SummaryPrefs
}): SummaryDetail {
  const { row } = p
  const resolved = resolveMembers(svc, { mode: row.mode, jobIds: row.job_ids, summaryKey: row.profile_id, jobs: p.jobs, runs: p.runs, snapshot: row.snapshot, profiles: p.profiles, acceptedSigs: row.field_sigs })
  const { fields, removed } = summaryFields(svc, { mode: row.mode, resolved, snapshot: row.snapshot, profiles: p.profiles, summaryKey: row.profile_id })
  const ids = new Set([...fields, ...removed].map((f) => f.id))
  const policies = resolved
    .filter((x) => x.r.state === 'ok' || x.r.state === 'stale')
    .map((x) => ({
      jobId: x.jobId,
      batchId: x.info.batchId,
      name: x.info.name,
      path: x.info.path,
      values: pickValues(x.r.values, ids),
      state: x.r.state as 'ok' | 'stale',
      valuesAt: x.r.valuesAt,
    }))
  const { yearFieldId, dueFieldId } = effectiveDates(svc, row, fields, policies)
  const prefs = p.prefsOverride ? { ...(row.prefs || {}), ...p.prefsOverride } : row.prefs
  const sum = svc.summarize({
    fields,
    removedFields: removed,
    policies,
    yearFieldId,
    dueFieldId,
    prefs,
    today: p.today,
    view: p.view || {},
    ...(p.values === 'all' ? { values: 'all' as const } : {}),
  })
  const members: SummaryMember[] = resolved.map((x) => ({
    jobId: x.jobId,
    name: x.info.name,
    path: x.info.path,
    batchId: x.info.batchId,
    batchLabel: x.info.batchLabel,
    state: x.r.state,
    reason: x.r.reason ?? null,
    status: x.r.status ?? null,
    forced: !!x.r.forced,
    valuesAt: x.r.valuesAt ?? null,
    year: x.r.state === 'ok' || x.r.state === 'stale' ? svc.yearOf({ values: x.r.values }, yearFieldId) : null,
    kept: x.kept,
  }))
  members.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || a.name.localeCompare(b.name, 'it') || a.jobId.localeCompare(b.jobId))
  const kept = resolved.filter((x) => x.kept && x.r.state === 'ok').map((x) => x.jobId)
  const warnings: SummaryWarning[] = [
    ...svc.memberWarnings(resolved.map((x) => ({ jobId: x.jobId, state: x.r.state, reason: x.r.reason, forced: !!x.r.forced }))),
    ...(kept.length ? [{ code: 'keptOld' as const, jobIds: kept }] : []),
    ...(sum.warnings || []),
  ]
  const { warnings: _w, ...rest } = sum // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...rest, summary: summaryInfo(row, { yearFieldId, dueFieldId, fieldCount: fields.length }), members, warnings }
}

// ─── Fotografia ──────────────────────────────────────────────────────────────

/**
 * Fotografia dai membri risolti LIVE (buildSnapshot del modulo puro): valori
 * ristretti ai campi di riferimento; le voci conservate dalla fotografia
 * precedente (keptOld) portano `kept: true` e i loro campi, se il riferimento
 * nuovo non li ha, restano tra i campi tolti (fuori da N).
 */
export function snapshotFrom(svc: SummarySvc, p: {
  takenAt: number
  resolved: ResolvedEntry[]
  fields: SummaryFieldDef[]
  removed: SummaryFieldDef[]
  previous: SummarySnapshot | null
}): { snapshot: SummarySnapshot; dropped: string[]; keptOld: string[] } {
  const ids = new Set([...p.fields, ...p.removed].map((f) => f.id))
  const members: SnapshotMemberInput[] = p.resolved.map((x) => ({
    jobId: x.jobId,
    state: x.r.state,
    reason: x.r.reason,
    values: pickValues(x.r.values, ids),
    valuesAt: x.r.valuesAt,
    forced: !!x.r.forced,
    dossierName: x.info.dossierName,
    batchId: x.info.batchId,
    batchLabel: x.info.batchLabel,
    scannedFiles: x.info.scannedFiles,
  }))
  let out = svc.buildSnapshot({ takenAt: p.takenAt, fields: p.fields, removedFields: p.removed, members, previous: p.previous })
  if (out.keptOld.length && p.previous) {
    const have = new Set(ids)
    const extra: SummaryFieldDef[] = []
    for (const f of [...(p.previous.fieldDefs || []), ...(p.previous.removedFieldDefs || [])]) {
      if (!f || !f.id || have.has(f.id)) continue
      have.add(f.id)
      extra.push(defShape(f))
    }
    if (extra.length) out = svc.buildSnapshot({ takenAt: p.takenAt, fields: p.fields, removedFields: [...p.removed, ...extra], members, previous: p.previous })
  }
  for (const id of out.keptOld) out.snapshot.jobs[id] = { ...out.snapshot.jobs[id], kept: true }
  return out
}

// ─── Ammissione ──────────────────────────────────────────────────────────────

/**
 * Ammissione di job in un riepilogo (checkEligible del modulo puro) con i dati
 * letti: job richiesti (+ notValid da jobValidity), nomi dei membri (dalla
 * fotografia o dal database, servono al dettaglio «duplicate»), hash dei file
 * dei richiesti E dei membri (doppioni per contenuto).
 */
export async function eligibilityCore(svc: SummarySvc, deps: SummaryDeps, requestedIds: string[], p: {
  summaryKey: string | null
  memberIds: string[]
  snapshot: SummarySnapshot | null
  acceptedSigs?: string[]
}): Promise<{ elig: Eligibility; jobsById: Map<string, JobLightRow> }> {
  const jobs = await deps.loadJobs(requestedIds)
  const jobsById = new Map(jobs.map((j) => [j.id, j]))
  const labels = new Map<string, JobLabel>()
  for (const j of jobs) labels.set(j.id, { dossier_name: j.dossier_name, scanned_files: j.scanned_files || [], batch_label: j.batch_label })
  const others = p.memberIds.filter((id) => !labels.has(id))
  for (const id of others) {
    const e = p.snapshot?.jobs?.[id]
    if (e) labels.set(id, { dossier_name: e.dossierName, scanned_files: e.scannedFiles || [], batch_label: e.batchLabel })
  }
  const toLoad = others.filter((id) => !labels.has(id))
  if (toLoad.length) for (const [k, v] of await deps.loadLabels(toLoad)) labels.set(k, v)
  const members = p.memberIds.map((id) => {
    const l = labels.get(id)
    return { jobId: id, name: l ? svc.policyName({ dossierName: l.dossier_name, batchLabel: l.batch_label, scannedFiles: l.scanned_files, jobId: id }).name : id.slice(0, 8) }
  })
  const hashesByJob = await deps.loadHashes([...new Set([...requestedIds, ...p.memberIds])])
  const elig = svc.checkEligible({
    requestedIds,
    jobs: jobs.map((j) => ({ ...j, notValid: isNotValidJob(j) })),
    profiles: deps.profiles,
    summaryKey: p.summaryKey,
    members,
    hashesByJob,
    acceptedSigs: p.acceptedSigs || [],
  })
  return { elig, jobsById }
}

const notEligible = (refused: Eligibility['refused']) => fail(409, 'not-eligible', 'Alcune polizze non possono entrare nel riepilogo', { refused })

function jobIdsError(reason: string): CoreError {
  if (reason === 'too-many') return fail(400, 'too-many', 'Troppe polizze: al massimo 2000 per riepilogo')
  return fail(400, 'bad-job-ids', 'Elenco di polizze non valido', { reason })
}

/**
 * Base di una creazione (e della sua anteprima): membri risolti dai job
 * ammessi, campi di riferimento, valori, riepilogo precedente dello stesso
 * profilo (preferenze ereditate) e date di default.
 */
async function creationBase(svc: SummarySvc, deps: SummaryDeps, elig: Eligibility, jobsById: Map<string, JobLightRow>) {
  const key = elig.key as string
  const jobIds = elig.eligible.map((e) => e.jobId)
  const resolved = resolveMembers(svc, { mode: 'live', jobIds, summaryKey: key, jobs: jobsById, runs: new Map(), snapshot: null, profiles: deps.profiles, acceptedSigs: elig.sigs })
  const { fields, removed } = summaryFields(svc, { mode: 'live', resolved, snapshot: null, profiles: deps.profiles, summaryKey: key })
  const policies = resolved.filter((x) => x.r.state === 'ok').map((x) => ({ jobId: x.jobId, values: x.r.values }))
  const prev = await deps.latestForProfile(key)
  const inheritedYear = prev && isDateField(svc, fields, prev.year_field_id) ? prev.year_field_id : null
  /** «Scadenza da»: quella ereditata se è ancora una data diversa dall'anno, altrimenti il default. */
  const dueFor = (yearFieldId: string | null) => (prev && isDateField(svc, fields, prev.due_field_id) && prev.due_field_id !== yearFieldId
    ? prev.due_field_id
    : svc.defaultDueFieldId(fields, policies, yearFieldId))
  const yearFieldId = inheritedYear ?? svc.defaultYearFieldId(fields)
  const prefs = prev ? svc.sanitizePrefs(prev.prefs ?? {}, fields).prefs : {}
  return { key, jobIds, resolved, fields, removed, policies, prev, yearFieldId, dueFieldId: dueFor(yearFieldId), dueFor, prefs }
}

/** POST /api/polizza/summaries/preview: alimenta il pannello «Nuovo riepilogo». */
export async function previewCore(svc: SummarySvc, deps: SummaryDeps, body: unknown): Promise<CoreError | { ok: true; preview: SummaryPreview }> {
  if (!isObj(body)) return fail(400, 'bad-body', 'Richiesta non valida')
  const s = svc.sanitizeJobIds(body.jobIds, svc.MAX_SUMMARY_JOBS)
  if (s.error) return jobIdsError(s.error)
  const { elig, jobsById } = await eligibilityCore(svc, deps, s.ids, { summaryKey: null, memberIds: [], snapshot: null })
  if (!elig.key || !elig.eligible.length) {
    return { ok: true, preview: { profileId: null, profileName: null, fieldCount: 0, eligible: [], refused: elig.refused, dateFields: [], defaults: { yearFieldId: null, dueFieldId: null }, inherited: false } }
  }
  const b = await creationBase(svc, deps, elig, jobsById)
  const dateFields = b.fields
    .filter((f) => svc.classifyField(f).kind === 'date')
    .map((f) => ({ id: f.id, label: f.label, filled: b.policies.filter((x) => !svc.isEmpty(x.values?.[f.id])).length }))
  return {
    ok: true,
    preview: {
      profileId: b.key,
      profileName: elig.name ?? profileNameOf(deps.profiles, b.key),
      fieldCount: b.fields.length,
      eligible: elig.eligible,
      refused: elig.refused,
      dateFields,
      defaults: { yearFieldId: b.yearFieldId, dueFieldId: b.dueFieldId },
      inherited: !!b.prev,
    },
  }
}

/**
 * POST /api/polizza/summaries: `{ name, jobIds, yearFieldId?, mode }`.
 * Tutti i job devono essere ammessi (409 not-eligible con i rifiuti); anno
 * scelto (se dato) = campo data del profilo; preferenze, «Anno da» e
 * «Scadenza da» ereditati dall'ultimo riepilogo dello stesso profilo; in modo
 * fotografia la fotografia si fa subito.
 */
export async function createSummaryCore(svc: SummarySvc, deps: SummaryDeps, body: unknown, email: string): Promise<CoreError | { ok: true; row: SummaryRow; inherited: boolean }> {
  if (!isObj(body)) return fail(400, 'bad-body', 'Richiesta non valida')
  const name = cleanSummaryName(body.name)
  if (!name) return fail(400, 'bad-name', `Il nome deve avere da 1 a ${MAX_SUMMARY_NAME} caratteri`)
  const modeRaw = body.mode
  if (modeRaw !== 'live' && modeRaw !== 'snapshot') return fail(400, 'bad-mode', 'Modo non valido: live oppure snapshot')
  const mode: SummaryMode = modeRaw
  const s = svc.sanitizeJobIds(body.jobIds, svc.MAX_SUMMARY_JOBS)
  if (s.error) return jobIdsError(s.error)
  const { elig, jobsById } = await eligibilityCore(svc, deps, s.ids, { summaryKey: null, memberIds: [], snapshot: null })
  if (elig.refused.length || !elig.eligible.length || !elig.key) return notEligible(elig.refused)
  const b = await creationBase(svc, deps, elig, jobsById)
  let yearFieldId = b.yearFieldId
  let dueFieldId = b.dueFieldId
  const yearRaw = body.yearFieldId
  if (yearRaw != null) {
    // «Anno da» scelto nel pannello: deve essere un campo DATA dei campi di riferimento.
    if (!isDateField(svc, b.fields, yearRaw)) return fail(400, 'bad-year-field', 'Il campo «Anno da» deve essere un campo data del profilo')
    yearFieldId = yearRaw
    dueFieldId = b.dueFor(yearRaw)
  }
  const t = deps.now()
  const snapshot = mode === 'snapshot'
    ? snapshotFrom(svc, { takenAt: t, resolved: b.resolved, fields: b.fields, removed: b.removed, previous: null }).snapshot
    : null
  const row: SummaryRow = {
    id: deps.newId(),
    name,
    profile_id: b.key,
    profile_name: elig.name ?? profileNameOf(deps.profiles, b.key),
    year_field_id: yearFieldId,
    due_field_id: dueFieldId,
    mode,
    job_ids: b.jobIds,
    snapshot,
    prefs: b.prefs,
    field_sigs: [...(elig.sigs || [])],
    rev: 0,
    created_by: email,
    created_at: t,
    updated_at: t,
  }
  return { ok: true, row, inherited: !!b.prev }
}

// ─── Modifica (PATCH) ────────────────────────────────────────────────────────

const PATCH_KEYS = new Set(['name', 'prefs', 'yearFieldId', 'dueFieldId', 'addJobIds', 'removeJobIds', 'mode', 'refreshSnapshot'])

/**
 * Applica un PATCH a una riga (letta dal chiamante con SELECT … FOR UPDATE).
 * Ordine: name, removeJobIds, addJobIds, mode, refreshSnapshot, poi
 * yearFieldId / dueFieldId / prefs validati sui campi di riferimento DOPO le
 * modifiche all'insieme. Nessuna scrittura: restituisce la riga nuova.
 */
export async function patchSummaryCore(svc: SummarySvc, deps: SummaryDeps, row: SummaryRow, body: unknown): Promise<CoreError | { ok: true; row: SummaryRow; result: SummaryPatchResult; keys: string[] }> {
  if (!isObj(body)) return fail(400, 'bad-body', 'Richiesta non valida')
  const keys = Object.keys(body)
  const unknown = keys.filter((k) => !PATCH_KEYS.has(k))
  if (unknown.length) return fail(400, 'unknown-key', `Voci non ammesse: ${unknown.join(', ')}`, { keys: unknown })
  if (!keys.length) return fail(400, 'empty', 'Nessuna modifica richiesta')

  const next: SummaryRow = {
    ...row,
    field_sigs: [...(row.field_sigs || [])],
    job_ids: [...row.job_ids],
    snapshot: row.snapshot ? { ...row.snapshot, fieldDefs: [...(row.snapshot.fieldDefs || [])], removedFieldDefs: [...(row.snapshot.removedFieldDefs || [])], jobs: { ...(row.snapshot.jobs || {}) } } : null,
    prefs: row.prefs || {},
  }
  const result: SummaryPatchResult = { added: [], already: [], removed: [], dropped: [], keptOld: [], refused: [] }

  if ('name' in body) {
    const name = cleanSummaryName(body.name)
    if (!name) return fail(400, 'bad-name', `Il nome deve avere da 1 a ${MAX_SUMMARY_NAME} caratteri`)
    next.name = name
  }

  if ('removeJobIds' in body) {
    const s = svc.sanitizeJobIds(body.removeJobIds, svc.MAX_SUMMARY_JOBS)
    if (s.error) return jobIdsError(s.error)
    const drop = new Set(s.ids)
    result.removed = next.job_ids.filter((id) => drop.has(id))
    next.job_ids = next.job_ids.filter((id) => !drop.has(id))
    if (next.snapshot) for (const id of result.removed) delete next.snapshot.jobs[id]
  }

  if ('addJobIds' in body) {
    const s = svc.sanitizeJobIds(body.addJobIds, svc.MAX_SUMMARY_JOBS)
    if (s.error) return jobIdsError(s.error)
    const { elig, jobsById } = await eligibilityCore(svc, deps, s.ids, { summaryKey: next.profile_id, memberIds: next.job_ids, snapshot: next.snapshot, acceptedSigs: next.field_sigs })
    // Entrano le ammissibili; le altre tornano col motivo (result.refused).
    // 409 solo se non entra nessuna di quelle nuove.
    const added = elig.eligible.map((e) => e.jobId)
    if (!added.length && elig.refused.length) return notEligible(elig.refused)
    if (next.job_ids.length + added.length > svc.MAX_SUMMARY_JOBS) return jobIdsError('too-many')
    result.already = elig.already
    result.added = added
    result.refused = elig.refused
    next.job_ids.push(...added)
    for (const sig of elig.sigs || []) if (!next.field_sigs.includes(sig)) next.field_sigs.push(sig)
    if (next.mode === 'snapshot' && next.snapshot && added.length) {
      // Fotografati subito; gli id di campo nuovi si accodano ai campi della
      // fotografia, congelati oggi (freezeField) come gli altri.
      const resolved = resolveMembers(svc, { mode: 'live', jobIds: added, summaryKey: next.profile_id, jobs: jobsById, runs: new Map(), snapshot: null, profiles: deps.profiles, acceptedSigs: next.field_sigs })
      const have = new Set(next.snapshot.fieldDefs.map((f) => f.id))
      for (const x of resolved) {
        for (const f of (x.r.fieldDefs || []) as SummaryFieldDef[]) {
          if (!f || !f.id || have.has(f.id)) continue
          have.add(f.id)
          next.snapshot.fieldDefs.push(svc.freezeField(f))
        }
      }
      next.snapshot.removedFieldDefs = next.snapshot.removedFieldDefs.filter((f) => !have.has(f.id))
      const part = snapshotFrom(svc, { takenAt: next.snapshot.takenAt, resolved, fields: next.snapshot.fieldDefs, removed: next.snapshot.removedFieldDefs, previous: null })
      Object.assign(next.snapshot.jobs, part.snapshot.jobs)
    }
  }

  const retake = async (previous: SummarySnapshot | null) => {
    const { jobs, runs } = await loadLiveMaps(deps, next.job_ids)
    const resolved = resolveMembers(svc, { mode: 'live', jobIds: next.job_ids, summaryKey: next.profile_id, jobs, runs, snapshot: null, profiles: deps.profiles, acceptedSigs: next.field_sigs })
    const { fields, removed } = summaryFields(svc, { mode: 'live', resolved, snapshot: null, profiles: deps.profiles, summaryKey: next.profile_id, fallback: previous?.fieldDefs })
    const out = snapshotFrom(svc, { takenAt: deps.now(), resolved, fields, removed, previous })
    const gone = new Set(out.dropped)
    next.job_ids = next.job_ids.filter((id) => !gone.has(id))
    next.snapshot = out.snapshot
    result.dropped.push(...out.dropped.filter((id) => !result.dropped.includes(id)))
    result.keptOld = out.keptOld
  }

  if ('mode' in body) {
    const m = body.mode
    if (m !== 'live' && m !== 'snapshot') return fail(400, 'bad-mode', 'Modo non valido: live oppure snapshot')
    if (m !== next.mode) {
      if (m === 'live') {
        next.mode = 'live'
        next.snapshot = null
      } else {
        next.mode = 'snapshot'
        await retake(null)
      }
    }
  }

  if ('refreshSnapshot' in body) {
    if (typeof body.refreshSnapshot !== 'boolean') return fail(400, 'bad-body', 'refreshSnapshot deve essere true o false')
    if (body.refreshSnapshot) {
      if (next.mode !== 'snapshot' || !next.snapshot) return fail(400, 'not-snapshot', 'Il riepilogo non è una fotografia')
      await retake(next.snapshot)
    }
  }

  if ('yearFieldId' in body || 'dueFieldId' in body || 'prefs' in body) {
    let fields: SummaryFieldDef[]
    if (next.mode === 'snapshot' && next.snapshot) {
      fields = summaryFields(svc, { mode: 'snapshot', resolved: [], snapshot: next.snapshot, profiles: deps.profiles, summaryKey: next.profile_id }).fields
    } else {
      const { jobs, runs } = await loadLiveMaps(deps, next.job_ids)
      const resolved = resolveMembers(svc, { mode: 'live', jobIds: next.job_ids, summaryKey: next.profile_id, jobs, runs, snapshot: null, profiles: deps.profiles, acceptedSigs: next.field_sigs })
      fields = summaryFields(svc, { mode: 'live', resolved, snapshot: null, profiles: deps.profiles, summaryKey: next.profile_id }).fields
    }
    if ('yearFieldId' in body) {
      const y = body.yearFieldId
      if (!isDateField(svc, fields, y)) return fail(400, 'bad-year-field', 'Il campo «Anno da» deve essere un campo data del profilo')
      next.year_field_id = y
    }
    if ('dueFieldId' in body) {
      const d = body.dueFieldId
      if (d === null) next.due_field_id = null
      else if (!isDateField(svc, fields, d)) return fail(400, 'bad-due-field', 'Il campo «Scadenza da» deve essere un campo data del profilo')
      else next.due_field_id = d
    }
    if ('prefs' in body) {
      const m = svc.mergePrefs(next.prefs, body.prefs, fields)
      if (m.errors.length) return fail(400, 'bad-prefs', 'Impostazioni non valide', { errors: m.errors })
      next.prefs = m.prefs
    }
  }

  return { ok: true, row: next, result, keys }
}
