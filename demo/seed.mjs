// Popola un database DEMO con dati inventati (profili documento, elaborazioni,
// batch, cronologia). DISTRUTTIVO: svuota le tabelle dell'app. Gira solo su un
// DATABASE_URL locale (localhost/127.0.0.1) per non toccare mai la produzione.
//   DATABASE_URL=postgresql://demo:demo@localhost:55432/pdfextractor node demo/seed.mjs
// Con DEMO_LANG=en usa il catalogo inglese (data-en.mjs) e i PDF di pdfs-en/.
// Le tabelle devono già esistere: avvia una volta la web app (initDb al boot).
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { data, SUFFIX } from './lang.mjs'

// Cosa inserire (batch, singole, cronologia) lo decide il catalogo: qui solo come.
const { DEMO_USER, TEAM, PROFILES, GENERIC_PROFILES, profileById, TEXT, PLAN, SESSIONS, SETTINGS_TEXT } = data

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '..', 'web', 'package.json'))
const { Pool } = require('pg')

const url = process.env.DATABASE_URL || ''
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
  console.error('DATABASE_URL deve puntare a un Postgres LOCALE (localhost/127.0.0.1): il seed svuota le tabelle.')
  process.exit(1)
}
const pool = new Pool({ connectionString: url })
const q = (sql, params) => pool.query(sql, params)

const NOW = Math.floor(Date.now() / 1000)
const H = 3600
const D = 24 * H
const PDFS = join(here, 'pdfs' + SUFFIX)
const pdfB64 = (name) => readFileSync(join(PDFS, name)).toString('base64')
const pdfExists = (name) => { try { readFileSync(join(PDFS, name)); return true } catch { return false } }
const sha = (b64) => createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex')
const clock = (t) => new Date(t * 1000).toTimeString().slice(0, 8)

function fieldDefs(profile) {
  return profile.fields.map(({ id, label, description, type }) => ({ id, label, description, type }))
}
function sourcesOf(state) {
  const out = {}
  for (const [k, e] of Object.entries(state)) if (e && e.valore != null && e.valore !== '' && e.fonte) out[k] = e.fonte
  return out
}
function fullState(profile, state) {
  const s = {}
  for (const f of profile.fields) s[f.id] = { valore: null, data_validita: null }
  for (const [k, e] of Object.entries(state)) s[k] = e
  return s
}
function jobLogs(t0, profile, files, { status = 'done', n = 0 } = {}) {
  const L = TEXT.log
  const lines = [
    L.strategy(profile.name),
    L.docs(files.length, Math.max(1, files.length - 1), files.length > 1 ? 1 : 0),
    L.cache(files.length > 2 ? 1 : 0, files.length),
    L.precheck,
    L.stages,
  ]
  if (status === 'done') lines.push(L.done(n, profile.fields.length), L.index)
  return lines.map((l, i) => `[${clock(t0 + i * 7)}] ${l}`)
}

// Esito del controllo di pertinenza di un job estratto (parole del contenuto trovate).
function okPrecheck(profile, at) {
  const words = (profile.contentKeywords || '').split(',').map((w) => w.trim()).filter(Boolean)
  return {
    verdict: 'ok', mode: 'keywords', score: 1, threshold: 0.25, at,
    reason: TEXT.okReason, matched: words,
    detected: { type: TEXT.detected[profile.id] || profile.name, keywords: words.slice(0, 3) },
    summary: TEXT.okSummary(words.length, profile.name),
  }
}
const folderOf = (s) => String(s || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '')

async function insertJobRaw({ batchId = null, batchLabel = null, email, dossier, profile, files, state = {}, status = 'done', created, progress = {}, error = null, precheck = null, withPdf = true, runs = null }) {
  const id = randomUUID()
  if (!precheck && status === 'done') precheck = okPrecheck(profile, created + 30)
  const st = fullState(profile, state)
  const n = Object.values(state).filter((e) => e && e.valore != null && e.valore !== '').length
  await q(
    `INSERT INTO polizza_jobs (id, email, batch_id, dossier_name, status, whole_dossier, scanned_files, cursor, progress,
       rolling_state, sources, field_defs, error, logs, prompt_extra, profile_id, profile_name, precheck, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,TRUE,$6::jsonb,'{}'::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12::jsonb,$13,$14,$15,$16::jsonb,$17,$18)`,
    [id, email, batchId, dossier, status, JSON.stringify(files), JSON.stringify(progress), JSON.stringify(st),
      JSON.stringify(sourcesOf(state)), JSON.stringify(fieldDefs(profile)), error,
      JSON.stringify(jobLogs(created, profile, files, { status, n })), profile.promptExtra || null,
      profile.id, profile.name, precheck ? JSON.stringify(precheck) : null, created,
      status === 'running' ? NOW - 40 : created + 60 + files.length * 45],
  )
  if (withPdf) {
    let idx = 0
    for (const f of files) {
      if (!pdfExists(f)) { idx++; continue }
      const b64 = pdfB64(f)
      const rel = `${folderOf(batchLabel || TEXT.singlesFolder)}/${folderOf(dossier)}/${f}`
      if (HAS_REL) await q('INSERT INTO polizza_job_files (job_id, idx, file_name, pdf_base64, file_hash, rel_path) VALUES ($1,$2,$3,$4,$5,$6)', [id, idx++, f, b64, sha(b64), rel])
      else await q('INSERT INTO polizza_job_files (job_id, idx, file_name, pdf_base64, file_hash) VALUES ($1,$2,$3,$4,$5)', [id, idx++, f, b64, sha(b64)])
    }
  }
  // Storico delle run (test_branch): una run per ogni job arrivato a un esito,
  // più eventuali run precedenti passate dal chiamante.
  if (HAS_RUNS && ['done', 'mismatch', 'error'].includes(status)) {
    const flat = Object.fromEntries(Object.entries(state).filter(([, e]) => e && e.valore != null && e.valore !== '').map(([k, e]) => [k, String(e.valore)]))
    const fields = profile.fields.map(({ id: fid, label }) => ({ id: fid, label }))
    const all = [...(runs || []), { at: created + 60 + files.length * 45, values: flat }]
    for (const r of all) {
      const filled = Object.keys(r.values).length
      await q(`INSERT INTO polizza_job_runs (job_id, batch_id, finished_at, status, profile_id, profile_name, model, ctx, verdict, summary, error, fields, field_values, filled, total)
               VALUES ($1,$2,$3,$4,$5,$6,'qwen2.5:7b-instruct',24576,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13)`,
        [id, batchId, r.at, status, profile.id, profile.name, precheck?.verdict || null, r.summary || precheck?.summary || null, error, JSON.stringify(fields), JSON.stringify(r.values), filled, profile.fields.length])
    }
  }
  return id
}

const batchLabels = {}
async function insertBatch(label, email, created) {
  const id = randomUUID()
  await q('INSERT INTO batch_jobs (id, email, label, upload_complete, created_at, updated_at, notified_at) VALUES ($1,$2,$3,TRUE,$4,$4,$5)', [id, email, label, created, created + 2 * H])
  batchLabels[id] = label
  return id
}
const insertJob = (o) => insertJobRaw({ ...o, batchLabel: o.batchId ? batchLabels[o.batchId] : null })

// ─── Pulizia (solo DB demo) ────────────────────────────────────────────────────
const { rows: extra } = await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('polizza_job_runs','polizza_summaries')`)
await q(`TRUNCATE polizza_job_files, polizza_jobs, batch_jobs, sessions, settings, action_logs, users, ocr_cache${extra.map((r) => ', ' + r.table_name).join('')} RESTART IDENTITY CASCADE`)
const HAS_RUNS = extra.some((r) => r.table_name === 'polizza_job_runs')
const { rows: relCol } = await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'polizza_job_files' AND column_name = 'rel_path'`)
const HAS_REL = relCol.length > 0

// ─── Utenti e impostazioni ─────────────────────────────────────────────────────
for (const e of TEAM) await q('INSERT INTO users (email, created_at) VALUES ($1,$2)', [e, NOW - 90 * D])

const active = profileById[PLAN.activeProfileId]
const settings = {
  ollamaUrl: 'http://ollama.lan:11434',
  ollamaModel: 'qwen2.5:7b-instruct',
  llmModel: 'qwen2.5:7b-instruct',
  polizzaWholeDossierModel: 'qwen2.5:7b-instruct',
  embeddingModel: 'bge-m3',
  polizzaProfiles: JSON.stringify(PROFILES),
  polizzaFields: JSON.stringify(active.fields),
  polizzaActiveProfileId: active.id,
  polizzaConsensusPasses: '3',
  polizzaPrecheckMode: 'keywords',
  profiles: JSON.stringify(GENERIC_PROFILES),
  bulkIncludeKeywords: '',
  theme: 'dark',
  // Menu essenziale per la presentazione (Impostazioni tecniche → Voci di menu):
  // le pagine nascoste restano raggiungibili dal loro indirizzo.
  navHiddenExtractor: JSON.stringify(['/batch', '/archive', '/chat', '/maintenance', '/diagnostics']),
  ...SETTINGS_TEXT,
}
for (const [k, v] of Object.entries(settings)) await q('INSERT INTO settings (key, value) VALUES ($1,$2)', [k, String(v)])

// ─── Batch ed estrazioni singole del piano ─────────────────────────────────────
const ids = { batches: {}, singles: {} }
for (const b of PLAN.batches) {
  const t0 = NOW - b.ago
  const batchId = await insertBatch(b.label, b.email, t0)
  let i = 0
  for (const j of b.jobs) {
    await insertJob({
      batchId, email: b.email, dossier: j.dossier, profile: profileById[j.profileId], files: j.files, state: j.state || {},
      status: j.status || 'done', created: t0 + (i++) * (b.step || 120), progress: j.progress || {}, error: j.error || null, precheck: j.precheck || null,
    })
  }
  ids.batches[b.key] = batchId
}
for (const s of PLAN.singles) {
  ids.singles[s.key] = await insertJob({
    email: s.email, dossier: s.dossier, profile: profileById[s.profileId], files: s.files, state: s.state, created: NOW - s.ago,
    runs: (s.runs || []).map(({ ago, ...r }) => ({ ...r, at: NOW - ago })),
  })
}

// ─── Cronologia dell'Estrattore singolo ────────────────────────────────────────
const sessionIds = {}
for (const s of SESSIONS(H, D)) {
  const meta = { fileName: s.file, numPages: s.pages, fields: s.fields.map(([name, value]) => ({ name, value })), chat: s.chat }
  const { rows } = await q('INSERT INTO sessions (email, file_name, num_pages, pdf_base64, meta, created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id',
    [DEMO_USER, s.file, s.pages, pdfB64(s.file), JSON.stringify(meta), NOW - s.ago])
  sessionIds[s.file] = rows[0].id
}

// ─── Log di attività (pagina Sicurezza/Log) ────────────────────────────────────
const [first] = PLAN.batches
const actions = [
  [DEMO_USER, 'auth.login', null, 40 * 60],
  [PLAN.singles[0].email, 'polizza.job.create', PLAN.singles[0].dossier, PLAN.singles[0].ago],
  [first.email, 'polizza.batch.create', first.label, first.ago],
  [DEMO_USER, 'extract', SESSIONS(H, D)[0].file, 36 * 60],
]
for (const [email, action, resource, ago] of actions) {
  await q('INSERT INTO action_logs (timestamp, email, action, resource, metadata, ip, user_agent, success) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)',
    [new Date((NOW - ago) * 1000).toISOString(), email, action, resource, '{}', '10.0.0.24', 'Mozilla/5.0'])
}

// Id utili allo script di cattura (job da aprire nella pagina Fascicoli, sessioni da ripristinare).
writeFileSync(join(here, `.seed-ids${SUFFIX}.json`), JSON.stringify({ ...ids, sessions: sessionIds }, null, 2))
console.log('Seed completato:', { ...ids, sessions: Object.keys(sessionIds).length })
await pool.end()
