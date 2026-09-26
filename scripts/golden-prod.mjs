#!/usr/bin/env node
/**
 * GOLDEN SULL'APP DEPLOYATA (25/09/2026): i fascicoli di FULL_CASES passano dal
 * programma VERO — stesso percorso del bulk dell'utente (batch → dossier col
 * profilo → «Fine caricamento» → worker del server: Docling, OCR, pertinenza,
 * estrazione, impostazioni di produzione). Niente motore locale: gli script
 * locali divergevano sempre in qualcosa dal deploy («in test funziona, online no»).
 *
 *   node scripts/golden-prod.mjs --base https://genius.csabroker.it --email <utente>
 *        [--only bolchini-rc-2026,alzaia-tl] [--model qwen3:32b] [--out .goldens-out/prod-<tag>]
 *        [--strategy gruppi|cascata] [--think off|abbinamento|estrazione|tutto] [--ctx 8192] [--ocr qwen2.5vl:7b] [--flags campi,…]
 *        [--from .goldens-out/prod-<base>] [--forza-pertinenza]
 *
 * - Un BATCH per fascicolo («TEST GOLDEN …»): la riconciliazione per numero di
 *   polizza non deve unire fascicoli golden diversi (BOLCHINI RC 2025/2026 hanno
 *   lo stesso numero).
 * - Profilo = quello di PRODUZIONE con lo stesso nome (GET /api/settings).
 * - Pertinenza: conta COME PER IL CLIENTE. Un fascicolo che l'app ferma («Da
 *   verificare», «Non pertinente», «Non valido») NON si forza: vale 0 campi
 *   (errore di pertinenza, se la polizza è vera) e lo dice il riepilogo. Fino al
 *   26/09 lo script premeva «Procedi comunque» e ha ESTRATTO la sola quietanza
 *   ALZAIA dichiarata non operante: regola dell'utente, «SENZA UNA POLIZZA È
 *   SEMPRE NON VALIDO». --forza-pertinenza (solo diagnostica) preme «Procedi
 *   comunque» sui «Da verificare»/«Non pertinente» delle polizze VERE, MAI su un
 *   «Non valido» né su un caso atteso non valido (golden-cases: expect).
 * - Casi con expect 'non-valido' (ALZAIA): controllo di validità, fuori dal
 *   conteggio dei campi; giusto se l'app dice «Non valido».
 * - «Abbinato» (pertinenza superata, estrazione da confermare): si preme ▶.
 * - --model / --strategy: il job di base gira con la configurazione di
 *   produzione; poi una RUN DI TEST (copia del job, override del solo modello
 *   e/o della strategia del motore a stadi: «gruppi» = gruppi a copertura
 *   totale, «cascata» = dal più recente) — le impostazioni globali non si
 *   toccano. --from <dir>: riusa i job di BASE di una misura precedente
 *   (<dir>/<caso>.json → baseJobId) e crea solo le run di test: niente
 *   ricaricamento né rielaborazione di base per ogni modello.
 * - Punteggio: scoreFullTruth, giusti/N su TUTTI i campi del profilo (Regola 4).
 * Una run alla volta: i fascicoli vanno in sequenza e il server serializza.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'
import { FULL_CASES } from './golden-cases.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const { scoreFullTruth, formatFullTruthReport } = await import(join(root, 'src/services/polizzaEval.js'))

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  return process.argv[i + 1]
}
const BASE = String(arg('base', 'https://genius.csabroker.it')).replace(/\/+$/, '')
const EMAIL = arg('email')
const ONLY = arg('only') ? new Set(arg('only').split(',').map((s) => s.trim())) : null
const MODEL = arg('model')
const STRATEGY = arg('strategy')
if (STRATEGY && !['gruppi', 'cascata'].includes(STRATEGY)) { console.error('--strategy gruppi|cascata'); process.exit(2) }
const THINK = arg('think')
if (THINK && !['off', 'abbinamento', 'estrazione', 'tutto'].includes(THINK)) { console.error('--think off|abbinamento|estrazione|tutto'); process.exit(2) }
const CTX = arg('ctx') ? Number(arg('ctx')) : null
const OCR = arg('ocr')
// Flag del motore (src/services/engineFlags.js): correzioni accese solo nelle run di test.
const FLAGS = arg('flags')
const OVERRIDE = MODEL || STRATEGY || THINK || CTX || OCR
const OUT = arg('out', join(root, '.goldens-out', `prod-${MODEL ? MODEL.replace(/[:.]/g, '-') : 'default'}${STRATEGY ? `-${STRATEGY}` : ''}${THINK ? `-think-${THINK}` : ''}${CTX ? `-ctx${CTX}` : ''}${OCR ? `-ocr-${OCR.replace(/[:.]/g, '-')}` : ''}${FLAGS ? `-flag-${FLAGS.replace(/[^a-z0-9]+/gi, '-')}` : ''}`))
// Mai forzare di default (vedi intestazione). --no-proceed resta accettato (è il default).
const FORCE = process.argv.includes('--forza-pertinenza')
// «Non valido» (nessuna polizza): stato mismatch con l'errore che lo dice; i job
// vecchi scrivevano «Accantonato».
const isNotValid = (j) => j?.status === 'mismatch' && /^(?:Non valido|Accantonato)\b/.test(String(j?.error || ''))
const mayForce = (c, j) => FORCE && c.expect !== 'non-valido' && (j.status === 'review' || (j.status === 'mismatch' && !isNotValid(j)))
const FROM = arg('from')
// Coda interrotta senza uccidere i processi: se esiste .goldens-out/SKIP_QUEUED
// le run lanciate SENZA --force escono subito (si ferma il resto di una coda già
// avviata, lasciando finire il passo in corso).
if (existsSync(join(root, '.goldens-out', 'SKIP_QUEUED')) && !process.argv.includes('--force')) { console.log('Saltato (SKIP_QUEUED)'); console.log('TOTALE giusti 0/0 — saltato'); process.exit(0) }
// PAUSA tra una run e l'altra (deploy in produzione senza spezzare una misura):
// finché esiste .goldens-out/PAUSE la run NON parte e aspetta; si toglie il
// file e la coda riprende da qui. Vale anche con --force.
{
  const pauseFile = join(root, '.goldens-out', 'PAUSE')
  let told = false
  while (existsSync(pauseFile)) {
    if (!told) { console.log(`In pausa (${pauseFile} presente) — ${new Date().toLocaleTimeString('it-IT')}`); told = true }
    await new Promise((r) => setTimeout(r, 30000))
  }
  if (told) console.log(`Pausa finita — ${new Date().toLocaleTimeString('it-IT')}`)
}
if (FROM && !OVERRIDE) { console.error('--from ha senso solo con --model, --strategy, --think o --ctx'); process.exit(2) }
if (!EMAIL) { console.error('Uso: node scripts/golden-prod.mjs --base <url> --email <utente> [--only a,b] [--model m] [--out dir]'); process.exit(2) }
mkdirSync(OUT, { recursive: true })
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' // certificato interno

let cookie = ''
async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'golden-prod-script' },
    body: JSON.stringify({ email: EMAIL }), redirect: 'manual',
  })
  if (!res.ok) throw new Error(`login → HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  const sc = (res.headers.getSetCookie?.() || []).find((c) => c.startsWith('pdf_extractor_session=')) || String(res.headers.get('set-cookie') || '')
  cookie = sc.split(';')[0]
  if (!cookie) throw new Error('login ok ma nessun cookie di sessione')
}
async function api(path, init = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers || {}), Cookie: cookie } })
      if (res.status === 401 && attempt === 1) { await login(); continue }
      const text = await res.text()
      let body = null
      try { body = JSON.parse(text) } catch { body = text }
      if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → HTTP ${res.status}: ${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`)
      return body
    } catch (err) {
      // Rete o deploy in corso: si riprova con calma, mai all'infinito.
      if (attempt >= 6 || /HTTP 4\d\d/.test(String(err.message))) throw err
      await new Promise((r) => setTimeout(r, 10000 * attempt))
    }
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TERMINAL = new Set(['done', 'error', 'mismatch', 'review', 'matched', 'canceled'])
async function waitJob(jobId, timeoutMs = 3 * 60 * 60 * 1000) {
  const t0 = Date.now()
  let last = ''
  while (Date.now() - t0 < timeoutMs) {
    const j = await api(`/api/polizza/job/${jobId}`)
    if (TERMINAL.has(j.status)) return j
    const p = j.progress ? `${j.progress.docName || ''} ${j.progress.pageIndex || ''}/${j.progress.pageTotal || ''}` : ''
    const line = `${j.status} ${p}`.trim()
    if (line !== last) { process.stdout.write(`    … ${line.slice(0, 110)}\n`); last = line }
    await sleep(15000)
  }
  throw new Error(`timeout sul job ${jobId}`)
}
const walkPdfs = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walkPdfs(p) : (/\.pdf$/i.test(f) ? [p] : []) })

await login()
const version = await api('/api/version').catch(() => null)
const settings = await api('/api/settings')
const prodProfiles = settings.polizzaProfiles || []
console.log(`App ${BASE} — versione ${version?.version || '?'} — Ollama ${settings.ollamaUrl || '?'} — modello ${settings.ollamaModel || '?'}${MODEL ? ` → run di test con ${MODEL}` : ''} — strategia ${settings.polizzaStagedCascade ? 'cascata' : 'gruppi'}${STRATEGY ? ` → run di test ${STRATEGY}` : ''} — pre-controllo ${settings.polizzaPrecheckMode || 'default'} — contesto ${settings.polizzaBatchContext || 8192}`)
// Codice deployato = marcatori di BUILD_FEATURES (la versione resta 1.0.153 su
// test_branch). Prima si leggeva `features` (campo inesistente): le misure non
// registravano su quale codice giravano e la notte del 26/09 è andata sul vecchio.
const buildFeatures = [].concat(version?.buildFeatures || [])
console.log(`  codice deployato (ultimi marcatori): ${buildFeatures.slice(-6).join(' · ') || 'sconosciuto'}`)

const summary = { base: BASE, version: version?.version || null, buildFeatures, model: MODEL || settings.ollamaModel || null, strategy: STRATEGY || (settings.polizzaStagedCascade ? 'cascata' : 'gruppi'), think: THINK || settings.polizzaThink || 'off', ocr: OCR || settings.polizzaOcrEngine || 'tesseract', ctx: CTX || settings.polizzaBatchContext || 8192, flags: FLAGS || settings.polizzaEngineFlags || '', precheckMode: settings.polizzaPrecheckMode || null, cases: [] }
const t00 = Date.now()
for (const c of FULL_CASES) {
  if (ONLY && !ONLY.has(c.id)) continue
  const dir = join(root, c.dir)
  const golden = JSON.parse(readFileSync(join(root, c.golden), 'utf8'))
  const files = (c.files ? c.files.map((f) => join(dir, f)) : (existsSync(dir) ? walkPdfs(dir) : [])).filter((f) => existsSync(f)).sort()
  const profile = prodProfiles.find((p) => p.name === c.profile)
  console.log(`\n## ${c.id} — profilo "${c.profile}" — ${files.length} PDF`)
  if (!files.length || !profile) {
    console.log(`   SALTATO: ${!files.length ? 'PDF mancanti' : `profilo "${c.profile}" non presente in produzione`}`)
    summary.cases.push({ id: c.id, skipped: true })
    continue
  }
  const t0 = Date.now()
  try {
    // Un caso atteso «Non valido» riparte SEMPRE da un caricamento nuovo: il suo
    // job di base delle misure vecchie era stato forzato (ed è stato cancellato).
    const prev = FROM && c.expect !== 'non-valido' && existsSync(join(root, FROM, `${c.id}.json`)) ? JSON.parse(readFileSync(join(root, FROM, `${c.id}.json`), 'utf8')) : null
    const baseId = prev ? (prev.baseJobId || prev.jobId) : null
    if (FROM && !baseId && c.expect !== 'non-valido') throw new Error(`nessun job di base in ${FROM}/${c.id}.json`)
    let batchId = prev?.batchId || null, jobId = baseId, job = null, pertinenza = prev?.pertinenza || null, runJobId = baseId
    if (!baseId) {
    ;({ batchId } = await api('/api/polizza/batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: `TEST GOLDEN ${c.id}${MODEL ? ` · ${MODEL}` : ''}${STRATEGY ? ` · ${STRATEGY}` : ''}` }),
    }))
    const form = new FormData()
    const folder = basename(dir)
    for (const f of files) {
      form.append('pdf', new Blob([new Uint8Array(readFileSync(f))], { type: 'application/pdf' }), basename(f))
      form.append('path', `${folder}/${relative(dir, f)}`)
    }
    form.append('dossierName', folder)
    form.append('profileId', profile.id)
    ;({ jobId } = await api(`/api/polizza/batch/${batchId}/dossier`, { method: 'POST', body: form }))
    await api(`/api/polizza/batch/${batchId}/complete`, { method: 'POST' })
    console.log(`   batch ${batchId} · job ${jobId}`)
    job = await waitJob(jobId)
    pertinenza = { status: job.status, verdict: job.precheck?.verdict || null, reason: job.precheck?.reason || job.error || null }
    console.log(`   pertinenza: ${job.status}${pertinenza.reason ? ` — ${String(pertinenza.reason).slice(0, 140)}` : ''}`)
    runJobId = jobId
    if (mayForce(c, job)) {
      console.log('   FORZATO (--forza-pertinenza): «Procedi comunque» su una polizza vera fermata dalla pertinenza')
      await api(`/api/polizza/job/${jobId}/proceed`, { method: 'POST' })
      job = await waitJob(jobId)
    } else if (job.status === 'matched' && c.expect !== 'non-valido') {
      await api(`/api/polizza/job/${jobId}/extract`, { method: 'POST' })
      job = await waitJob(jobId)
    }
    } else {
      job = await api(`/api/polizza/job/${baseId}`)
      console.log(`   job di base ${baseId} (da ${FROM})`)
    }
    if (OVERRIDE && job.status === 'done') {
      const body = { profileId: profile.id, ...(MODEL ? { model: MODEL } : {}), ...(STRATEGY ? { perField: false, stagedCascade: STRATEGY === 'cascata' } : {}), ...(THINK ? { think: THINK } : {}), ...(CTX ? { ctx: CTX } : {}), ...(OCR ? { ocr: OCR } : {}), ...(FLAGS ? { flags: FLAGS } : {}) }
      const t = await api(`/api/polizza/job/${jobId}/test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      runJobId = t.jobId || t.id || t.job?.id
      console.log(`   run di test ${runJobId}${MODEL ? ` con ${MODEL}` : ''}${STRATEGY ? ` · strategia ${STRATEGY}` : ''}${THINK ? ` · ragionamento ${THINK}` : ''}${CTX ? ` · ctx ${CTX}` : ''}${OCR ? ` · OCR ${OCR}` : ''}`)
      job = await waitJob(runJobId)
      // La pertinenza della run di test (col modello/strategia provati) è quella che conta qui.
      pertinenza = { status: job.status, verdict: job.precheck?.verdict || null, reason: job.precheck?.reason || job.error || null }
      console.log(`   pertinenza run di test: ${job.status}${pertinenza.reason ? ` — ${String(pertinenza.reason).slice(0, 140)}` : ''}`)
      if (mayForce(c, job)) { console.log('   FORZATO (--forza-pertinenza)'); await api(`/api/polizza/job/${runJobId}/proceed`, { method: 'POST' }); job = await waitJob(runJobId) }
    }
    const secs = Math.round((Date.now() - t0) / 1000)
    writeFileSync(join(OUT, `${c.id}.json`), JSON.stringify({ jobId: runJobId, baseJobId: jobId, batchId, status: job.status, error: job.error || null, pertinenza, fieldDefs: job.fieldDefs, values: job.values, sources: job.sources, logs: job.logs }, null, 2))
    if (c.expect === 'non-valido') {
      // Controllo di VALIDITÀ: giusto solo se l'app lo dichiara Non valido e non estrae.
      const ok = isNotValid(job)
      console.log(`   VALIDITÀ: atteso «Non valido» (${c.why || ''}) → ${ok ? 'GIUSTO' : `SBAGLIATO (${job.status}${job.status === 'done' ? ', ESTRATTO' : ''})`}`)
      summary.cases.push({ id: c.id, expect: 'non-valido', status: job.status, secs, pertinenza, validityOk: ok })
    } else if (job.status !== 'done') {
      // Fermato dall'app = quello che vede il cliente: 0 campi.
      console.log(`   FERMATO DALL'APP (${job.status}): ${String(job.error || '').slice(0, 200)} → 0 campi`)
      summary.cases.push({ id: c.id, status: job.status, secs, pertinenza, right: 0, total: (job.fieldDefs || []).length, blocked: true })
    } else {
      const score = scoreFullTruth({ data: job.values || {} }, golden, job.fieldDefs || [])
      const report = formatFullTruthReport(score)
      console.log(report)
      writeFileSync(join(OUT, `${c.id}-score.txt`), report)
      summary.cases.push({ id: c.id, status: job.status, secs, pertinenza, right: score.right, total: score.total, noTruth: score.noTruth.length })
    }
  } catch (err) {
    console.log(`   ERRORE: ${err.message}`)
    summary.cases.push({ id: c.id, error: err.message })
  }
  writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
}

const done = summary.cases.filter((s) => s.total)
const R = done.reduce((a, s) => a + s.right, 0), N = done.reduce((a, s) => a + s.total, 0)
console.log(`\n=== RIEPILOGO — ${summary.model} · ${summary.strategy} · ragionamento ${summary.think} · ctx ${summary.ctx}${summary.ocr && summary.ocr !== 'tesseract' ? ` · OCR ${summary.ocr}` : ''}${summary.flags ? ` · flag ${summary.flags}` : ''} · versione ${summary.version} (${(summary.buildFeatures || []).slice(-1)[0] || '?'}) — ${Math.round((Date.now() - t00) / 60000)} min ===`)
for (const s of summary.cases) {
  if (s.skipped) { console.log(`  ${s.id.padEnd(18)} saltato`); continue }
  if (s.error) { console.log(`  ${s.id.padEnd(18)} ERRORE ${s.error.slice(0, 100)}`); continue }
  if (s.expect === 'non-valido') { console.log(`  ${s.id.padEnd(18)} ${String(s.secs).padStart(5)}s  validità: atteso Non valido → ${s.validityOk ? 'GIUSTO' : `SBAGLIATO (${s.status})`}`); continue }
  console.log(`  ${s.id.padEnd(18)} ${String(s.secs).padStart(5)}s  pertinenza ${String(s.pertinenza?.status).padEnd(8)}  giusti ${s.right}/${s.total}${s.status !== 'done' ? `  (${s.status})` : ''}`)
}
console.log(`  TOTALE giusti ${R}/${N} (${N ? Math.round((R / N) * 1000) / 10 : 0}%) su ${done.length} fascicoli`)
const blocked = summary.cases.filter((s) => s.blocked)
if (blocked.length) console.log(`  FERMATI DALLA PERTINENZA (polizze vere, 0 campi per il cliente): ${blocked.map((s) => `${s.id} (${s.status})`).join(', ')}`)
const validity = summary.cases.filter((s) => s.expect === 'non-valido')
if (validity.length) console.log(`  VALIDITÀ (senza polizza = Non valido): ${validity.filter((s) => s.validityOk).length}/${validity.length} giusti`)
writeFileSync(join(OUT, 'summary.json'), JSON.stringify(summary, null, 2))
