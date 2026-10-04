// Popola un database DEMO con dati inventati (profili documento, elaborazioni,
// batch, cronologia). DISTRUTTIVO: svuota le tabelle dell'app. Gira solo su un
// DATABASE_URL locale (localhost/127.0.0.1) per non toccare mai la produzione.
//   DATABASE_URL=postgresql://demo:demo@localhost:55432/pdfextractor node demo/seed.mjs
// Le tabelle devono già esistere: avvia una volta la web app (initDb al boot).
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEMO_USER, TEAM, PROFILES, GENERIC_PROFILES, profileById, FILES, DOSSIER_MERIDIANE,
  INVOICES, invoiceState, PAYSLIPS, payslipState, LEASES, leaseState, SUPPLY_CONTRACTS,
  MAIN_SESSION_CHAT, LEASE_CHAT, CLIENT, archiveInvoices, monthlyBills, billState,
} from './data.mjs'

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
const pdfB64 = (name) => readFileSync(join(here, 'pdfs', name)).toString('base64')
const pdfExists = (name) => { try { readFileSync(join(here, 'pdfs', name)); return true } catch { return false } }
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
  const lines = [
    `Strategia: gruppi a copertura totale · modello qwen2.5:7b-instruct · profilo "${profile.name}"`,
    `Documenti: ${files.length} · testo nativo ${Math.max(1, files.length - 1)}, OCR ${files.length > 1 ? 1 : 0}`,
    `Cache OCR: ${files.length > 2 ? 1 : 0}/${files.length} documenti riusati (contenuto identico già elaborato)`,
    'Pre-check pertinenza [keywords]: ok (punteggio 0.83) — parole chiave del profilo trovate nel contenuto',
    'Stadio A: seed dal documento più recente · Stadio B: gruppi focalizzati (3 recenti + 3 più affini)',
  ]
  if (status === 'done') lines.push(`Validazione cross-field: ok · Estratti ${n}/${profile.fields.length} campi`, 'Indice vettoriale: 1 fascicolo indicizzato')
  return lines.map((l, i) => `[${clock(t0 + i * 7)}] ${l}`)
}

// Esito del controllo di pertinenza di un job estratto (parole del contenuto trovate).
const DETECTED = {
  prof_fatture: 'fattura elettronica', prof_fornitura: 'contratto di fornitura con allegati', prof_locazione: 'contratto di locazione commerciale',
  prof_ddt: 'documento di trasporto', prof_cedolini: 'cedolino paga', prof_cv: 'curriculum vitae', prof_preventivi: 'offerta commerciale', prof_utenze: 'bolletta energia elettrica',
}
function okPrecheck(profile, at) {
  const words = (profile.contentKeywords || '').split(',').map((w) => w.trim()).filter(Boolean)
  return {
    verdict: 'ok', mode: 'keywords', score: 1, threshold: 0.25, at,
    reason: 'parole chiave del profilo trovate nel contenuto', matched: words,
    detected: { type: DETECTED[profile.id] || profile.name, keywords: words.slice(0, 3) },
    summary: `Il testo contiene ${words.length}/${words.length} parole del profilo «${profile.name}»: si procede con l'estrazione.`,
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
      const rel = `${folderOf(batchLabel || 'Estrazioni_singole')}/${folderOf(dossier)}/${f}`
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

const fatture = profileById.prof_fatture
const settings = {
  ollamaUrl: 'http://ollama.lan:11434',
  ollamaModel: 'qwen2.5:7b-instruct',
  llmModel: 'qwen2.5:7b-instruct',
  polizzaWholeDossierModel: 'qwen2.5:7b-instruct',
  embeddingModel: 'bge-m3',
  qdrantCollection: 'documenti_demo',
  polizzaPromptExtra: 'Importi sempre in formato italiano (1.234,56) e date GG/MM/AAAA.\nSe un dato non è scritto nel documento lascia il campo vuoto: meglio vuoto che inventato.\nIn presenza di più documenti vince il dato del documento più recente.',
  polizzaProfiles: JSON.stringify(PROFILES),
  polizzaFields: JSON.stringify(fatture.fields),
  polizzaActiveProfileId: fatture.id,
  polizzaVerificaCampi: 'Totale documento, Scadenza pagamento, IBAN',
  polizzaConsensusPasses: '3',
  polizzaPrecheckMode: 'keywords',
  profiles: JSON.stringify(GENERIC_PROFILES),
  bulkExcludedFolderNames: '_bozze, Vecchie_scansioni',
  bulkIncludeKeywords: '',
  bulkExcludeKeywords: 'annullat',
  language: 'it',
  theme: 'dark',
  // Menu essenziale per la presentazione (Impostazioni tecniche → Voci di menu):
  // le pagine nascoste restano raggiungibili dal loro indirizzo.
  navHiddenExtractor: JSON.stringify(['/batch', '/archive', '/chat', '/maintenance', '/diagnostics']),
}
for (const [k, v] of Object.entries(settings)) await q('INSERT INTO settings (key, value) VALUES ($1,$2)', [k, String(v)])

// ─── Batch ─────────────────────────────────────────────────────────────────────
const ids = {}

// 1) Fatture passive di settembre: una cartella per fornitore + un documento fuori posto.
{
  const t0 = NOW - 2 * D - 5 * H
  const b = await insertBatch('Fatture passive · Settembre 2026', DEMO_USER, t0)
  let i = 0
  for (const inv of INVOICES) {
    await insertJob({ batchId: b, email: DEMO_USER, dossier: inv.dossier, profile: fatture, files: [inv.file], state: invoiceState(inv), created: t0 + (i++) * 140 })
  }
  await insertJob({
    batchId: b, email: DEMO_USER, dossier: 'Documenti vari (da smistare)', profile: fatture, files: [FILES.cv], status: 'mismatch', created: t0 + i * 140,
    error: 'Contenuto non pertinente al profilo "Fatture fornitori" — rilevato: curriculum vitae (esperienze, formazione, competenze). Verifica il profilo o premi "Procedi comunque".',
    precheck: {
      verdict: 'mismatch', mode: 'keywords', score: 0.0, threshold: 0.25, reason: 'nessuna parola chiave del profilo nel contenuto',
      missing: ['fattura', 'imponibile', 'IVA', 'totale documento'], detected: { type: 'curriculum vitae', keywords: ['esperienze', 'formazione', 'competenze'] },
      suggestion: { id: 'prof_cv', name: 'Curriculum candidati' },
      summary: 'Nessuna parola del profilo «Fatture fornitori» nel testo; il contenuto somiglia a «Curriculum candidati». Il job resta fermo finché non scegli: cambia profilo o «Procedi comunque».',
    },
  })
  ids.batchInvoices = b
}

// 2) Contratti fornitori: rinnovi 2027 (uno in corso, uno in coda).
{
  const t0 = NOW - 3 * H
  const b = await insertBatch('Contratti fornitori · rinnovi 2027', 'davide.conti@example.com', t0)
  let i = 0
  for (const c of SUPPLY_CONTRACTS) {
    await insertJob({
      batchId: b, email: 'davide.conti@example.com', dossier: c.dossier, profile: profileById.prof_fornitura, files: c.files,
      state: c.state, status: c.status, created: t0 + (i++) * 300, progress: c.progress || {},
    })
  }
  ids.batchContracts = b
}

// 3) Cedolini del mese.
{
  const t0 = NOW - 4 * D - 2 * H
  const b = await insertBatch('Cedolini · Settembre 2026', 'sara.galli@example.com', t0)
  let i = 0
  for (const row of PAYSLIPS) {
    const file = `Cedolino_09-2026_${row[0].split(' ').reverse().join('-')}.pdf`
    await insertJob({ batchId: b, email: 'sara.galli@example.com', dossier: row[0], profile: profileById.prof_cedolini, files: [i === 0 ? FILES.cedolino : file], state: payslipState(row, i === 0 ? FILES.cedolino : file), created: t0 + (i++) * 90 })
  }
}

// 4) Locazioni: sede e punti vendita (una scansione illeggibile).
{
  const t0 = NOW - 6 * D - 7 * H
  const b = await insertBatch('Locazioni · sede e punti vendita', DEMO_USER, t0)
  let i = 0
  for (const l of LEASES) {
    await insertJob({ batchId: b, email: DEMO_USER, dossier: l.dossier, profile: profileById.prof_locazione, files: [l.file], state: leaseState(l), created: t0 + (i++) * 200 })
  }
  await insertJob({
    batchId: b, email: DEMO_USER, dossier: 'Magazzino Seriate · scansione 1998', profile: profileById.prof_locazione, files: ['Locazione_magazzino_Seriate_scan.pdf'],
    status: 'error', created: t0 + i * 200, error: 'OCR: testo non leggibile su 4/4 pagine (scansione a 72 dpi). Ricarica una scansione ad almeno 200 dpi.',
  })
}

// 5) Archivio fatture 2024–2025 (per il riepilogo pluriennale).
{
  const t0 = NOW - 12 * D - 3 * H
  const b = await insertBatch('Fatture passive · archivio 2024–2025', 'davide.conti@example.com', t0)
  let i = 0
  for (const inv of archiveInvoices()) {
    await insertJob({ batchId: b, email: 'davide.conti@example.com', dossier: inv.dossier, profile: fatture, files: [inv.file], state: invoiceState(inv), created: t0 + (i++) * 75 })
  }
  ids.batchArchive = b
}

// 6) Bollette mensili della sede (gen 2025 – ago 2026).
{
  const t0 = NOW - 9 * D - 6 * H
  const b = await insertBatch('Utenze · bollette energia 2025–2026', 'davide.conti@example.com', t0)
  let i = 0
  for (const bill of monthlyBills()) {
    await insertJob({ batchId: b, email: 'davide.conti@example.com', dossier: bill.dossier, profile: profileById.prof_utenze, files: [bill.file], state: billState(bill), created: t0 + (i++) * 60 })
  }
  ids.batchBills = b
}

// ─── Estrazioni singole (fuori batch) ──────────────────────────────────────────
ids.dossierMeridiane = await insertJob({
  email: DEMO_USER, dossier: 'Fornitore Officine Meridiane', profile: profileById.prof_fornitura, files: DOSSIER_MERIDIANE.files,
  state: DOSSIER_MERIDIANE.state, created: NOW - 50 * 60,
  runs: [{
    at: NOW - 3 * D,
    summary: 'Prima run sul solo contratto quadro: addendum e verbale di audit caricati dopo.',
    values: {
      c_forn: 'Officine Meridiane S.r.l.', c_piva: '09356720961', c_ogg: 'Fornitura di componenti metallici per arredo', c_stip: '15/01/2024',
      c_scad: '31/12/2026', c_rinn: 'Sì, annuale (tacito)', c_prea: '90 giorni', c_val: '120.000,00', c_pag: 'Bonifico 60 gg d.f.f.m.',
      c_pen: '0,5% al giorno lavorativo, max 10%', c_foro: 'Milano', c_ref: 'Ing. Paolo Re',
    },
  }],
})
await insertJob({
  email: 'sara.galli@example.com', dossier: 'Candidatura UX Designer', profile: profileById.prof_cv, files: [FILES.cv], created: NOW - 5 * H,
  state: {
    v_nome: { valore: 'Chiara Lombardi', fonte: { file: FILES.cv, page: 1 } }, v_ruolo: { valore: 'Senior UX Designer — Nordwave Digital S.r.l.', fonte: { file: FILES.cv, page: 1 } },
    v_email: { valore: 'chiara.lombardi@example.org', fonte: { file: FILES.cv, page: 1 } }, v_tel: { valore: '+39 347 000 1234', fonte: { file: FILES.cv, page: 1 } },
    v_citta: { valore: 'Milano', fonte: { file: FILES.cv, page: 1 } }, v_anni: { valore: '8', fonte: { file: FILES.cv, page: 1 } },
    v_studio: { valore: 'Laurea Magistrale in Design della Comunicazione', fonte: { file: FILES.cv, page: 1 } },
    v_skill: { valore: 'Figma, design system, user research, prototipazione, accessibilità, HTML/CSS', fonte: { file: FILES.cv, page: 1 } },
    v_lingue: { valore: 'Inglese C1, Spagnolo B2', fonte: { file: FILES.cv, page: 1 } }, v_disp: { valore: '30 giorni di preavviso', fonte: { file: FILES.cv, page: 1 } },
  },
})
await insertJob({
  email: DEMO_USER, dossier: 'Offerta digitalizzazione archivio', profile: profileById.prof_preventivi, files: [FILES.preventivo], created: NOW - 26 * H,
  state: {
    o_num: { valore: 'PR-2026-077', fonte: { file: FILES.preventivo, page: 1 } }, o_data: { valore: '06/10/2026', fonte: { file: FILES.preventivo, page: 1 } },
    o_forn: { valore: 'Studio Alba Consulting S.r.l.', fonte: { file: FILES.preventivo, page: 1 } }, o_ogg: { valore: 'Digitalizzazione archivio documentale', fonte: { file: FILES.preventivo, page: 1 } },
    o_imp: { valore: '7.500,00', fonte: { file: FILES.preventivo, page: 1 } }, o_valid: { valore: '05/11/2026', fonte: { file: FILES.preventivo, page: 1 } },
    o_tempi: { valore: '6 settimane dalla conferma d’ordine', fonte: { file: FILES.preventivo, page: 1 } }, o_pag: { valore: '30% all’ordine, saldo a collaudo', fonte: { file: FILES.preventivo, page: 1 } },
  },
})
await insertJob({
  email: 'davide.conti@example.com', dossier: 'Energia sede · agosto 2026', profile: profileById.prof_utenze, files: [FILES.bolletta], created: NOW - 3 * D,
  state: {
    u_forn: { valore: 'Lumen Energia S.p.A.', fonte: { file: FILES.bolletta, page: 1 } }, u_pod: { valore: 'IT001E00012345', fonte: { file: FILES.bolletta, page: 1 } },
    u_inizio: { valore: '01/08/2026', fonte: { file: FILES.bolletta, page: 1 } },
    u_per: { valore: '01/08/2026 – 31/08/2026', fonte: { file: FILES.bolletta, page: 1 } }, u_cons: { valore: '4.640', fonte: { file: FILES.bolletta, page: 1 } },
    u_pot: { valore: '30', fonte: { file: FILES.bolletta, page: 1 } }, u_tot: { valore: '1.486,22', fonte: { file: FILES.bolletta, page: 1 } },
    u_scad: { valore: '25/09/2026', fonte: { file: FILES.bolletta, page: 1 } },
  },
})

// ─── Cronologia dell'Estrattore singolo ────────────────────────────────────────
const sessions = [
  { file: FILES.ftMeridiane, pages: 1, ago: 35 * 60, profile: 'prof_fatture', chat: MAIN_SESSION_CHAT,
    fields: [['Numero fattura', 'FT 2026/0418'], ['Data emissione', '12/09/2026'], ['Fornitore', 'Officine Meridiane S.r.l.'], ['P.IVA fornitore', '09356720961'], ['Cliente', CLIENT.name], ['Imponibile', '5.770,00'], ['Imposta', '1.269,40'], ['Totale documento', '7.039,40'], ['Scadenza pagamento', '30/11/2026'], ['Modalità di pagamento', 'Bonifico bancario'], ['IBAN', 'IT60X0542811101000000123456'], ['Riferimento ordine', 'ODA-2026-311 del 28/08/2026']] },
  { file: FILES.locazione, pages: 2, ago: 3 * H, profile: 'prof_locazione', chat: LEASE_CHAT,
    fields: [['Locatore', 'Immobiliare Colle Aperto S.r.l.'], ['Conduttore', CLIENT.name], ['Indirizzo immobile', 'Via Garibaldi 41, 24122 Bergamo (BG)'], ['Dati catastali', 'Fg. 34, map. 1187, sub. 5 · C/1'], ['Decorrenza', '01/03/2026'], ['Prima scadenza', '28/02/2032'], ['Canone annuo', '26.400,00'], ['Rata e periodicità', '2.200,00 mensili anticipate'], ['Deposito cauzionale', '6.600,00'], ['Aggiornamento ISTAT', '75%'], ['Preavviso recesso', '6 mesi (PEC o raccomandata A/R)'], ['Estremi registrazione', 'AdE Bergamo, 14/03/2026, n. 4821 serie 3T']] },
  { file: FILES.ddt, pages: 1, ago: 22 * H, profile: 'prof_ddt', chat: [],
    fields: [['Numero DDT', '2291'], ['Data DDT', '22/09/2026'], ['Mittente', 'Tessitura Brera Nova S.p.A.'], ['Destinatario', CLIENT.name], ['Luogo di destinazione', 'Via dei Tessitori 18, 24126 Bergamo (BG)'], ['Causale trasporto', 'Vendita'], ['Vettore', 'Logistica Tre Valli S.r.l.'], ['Numero colli', '14'], ['Peso lordo (kg)', '412'], ['Porto', 'Franco']] },
  { file: FILES.cedolino, pages: 1, ago: 2 * D, profile: 'prof_cedolini', chat: [],
    fields: [['Dipendente', 'Luca Ferraris'], ['Codice fiscale', 'FRRLCU88C14A794K'], ['Periodo di paga', 'Settembre 2026'], ['Livello e CCNL', '4° · Commercio Terziario'], ['Ore ordinarie', '168'], ['Totale competenze', '2.767,20'], ['Netto in busta', '2.054,02'], ['TFR maturato nel mese', '204,98'], ['Ferie residue (gg)', '11,5']] },
  { file: FILES.cv, pages: 1, ago: 2 * D + 5 * H, profile: 'prof_cv', chat: [],
    fields: [['Candidato', 'Chiara Lombardi'], ['Ruolo attuale', 'Senior UX Designer'], ['Email', 'chiara.lombardi@example.org'], ['Telefono', '+39 347 000 1234'], ['Città', 'Milano'], ['Anni di esperienza', '8'], ['Titolo di studio', 'Laurea Magistrale in Design della Comunicazione'], ['Competenze chiave', 'Figma, design system, user research, prototipazione'], ['Lingue', 'Inglese C1, Spagnolo B2'], ['Disponibilità', '30 giorni di preavviso']] },
  { file: FILES.preventivo, pages: 1, ago: 3 * D, profile: 'prof_preventivi', chat: [],
    fields: [['Numero offerta', 'PR-2026-077'], ['Data offerta', '06/10/2026'], ['Fornitore', 'Studio Alba Consulting S.r.l.'], ['Oggetto', 'Digitalizzazione archivio documentale'], ['Imponibile', '7.500,00'], ['Valida fino al', '05/11/2026'], ['Tempi di consegna', '6 settimane'], ['Condizioni di pagamento', '30% all’ordine, saldo a collaudo']] },
  { file: FILES.bolletta, pages: 1, ago: 5 * D, profile: 'prof_utenze', chat: [],
    fields: [['Fornitore', 'Lumen Energia S.p.A.'], ['POD / PDR', 'IT001E00012345'], ['Periodo di fatturazione', '01/08/2026 – 31/08/2026'], ['Consumo (kWh)', '4.640'], ['Potenza impegnata (kW)', '30'], ['Totale da pagare', '1.486,22'], ['Scadenza', '25/09/2026']] },
]
const sessionIds = {}
for (const s of sessions) {
  const meta = { fileName: s.file, numPages: s.pages, fields: s.fields.map(([name, value]) => ({ name, value })), chat: s.chat }
  const { rows } = await q('INSERT INTO sessions (email, file_name, num_pages, pdf_base64, meta, created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id',
    [DEMO_USER, s.file, s.pages, pdfB64(s.file), JSON.stringify(meta), NOW - s.ago])
  sessionIds[s.file] = rows[0].id
}

// ─── Log di attività (pagina Sicurezza/Log) ────────────────────────────────────
const actions = [
  [DEMO_USER, 'auth.login', null, 40 * 60], [DEMO_USER, 'polizza.job.create', 'Fornitore Officine Meridiane', 50 * 60],
  ['davide.conti@example.com', 'polizza.batch.create', 'Contratti fornitori · rinnovi 2027', 3 * H], [DEMO_USER, 'extract', FILES.ftMeridiane, 36 * 60],
  ['sara.galli@example.com', 'polizza.export', 'Cedolini · Settembre 2026', 4 * D - 3 * H],
]
for (const [email, action, resource, ago] of actions) {
  await q('INSERT INTO action_logs (timestamp, email, action, resource, metadata, ip, user_agent, success) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)',
    [new Date((NOW - ago) * 1000).toISOString(), email, action, resource, '{}', '10.0.0.24', 'Mozilla/5.0'])
}

// Id utili allo script di cattura (job da aprire nella pagina Fascicoli, sessioni da ripristinare).
writeFileSync(join(here, '.seed-ids.json'), JSON.stringify({ ...ids, sessions: sessionIds }, null, 2))
console.log('Seed completato:', { ...ids, sessions: Object.keys(sessionIds).length })
await pool.end()
