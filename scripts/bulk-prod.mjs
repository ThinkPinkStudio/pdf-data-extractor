#!/usr/bin/env node
/**
 * BULK SULL'APP DEPLOYATA, come la pagina Bulk dell'utente (25/09/2026): un
 * albero di cartelle diventa UN batch con un dossier per cartella che contiene
 * direttamente i PDF (stessa regola di web/lib/bulkGrouping.ts), tutti col
 * profilo scelto; «Fine caricamento» → il server legge, riconcilia per numero
 * di polizza, abbina (ed estrae, senza --match-only). Poi aspetta la fine e,
 * con --expected, confronta la PERTINENZA con la verità del verificatore.
 *
 *   node scripts/bulk-prod.mjs --base https://genius.csabroker.it --email <utente>
 *        --dir "polizze_test/BESA ING SANTANGELO GRUPPO" --profile "Tutela Legale 3"
 *        [--match-only] [--label "TEST BESA"] [--expected test/fixtures/pertinenza-besa-expected.json]
 *        [--batch <id>]   (solo attesa e confronto su un batch già caricato)
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { basename, dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  return process.argv[i + 1]
}
const BASE = String(arg('base', 'https://genius.csabroker.it')).replace(/\/+$/, '')
const EMAIL = arg('email')
const DIR = arg('dir')
const PROFILE = arg('profile')
const MATCH_ONLY = process.argv.includes('--match-only')
const EXPECTED = arg('expected')
let BATCH = arg('batch')
const OUT = arg('out', join(root, '.goldens-out'))
if (!EMAIL || (!BATCH && (!DIR || !PROFILE))) { console.error('Uso: node scripts/bulk-prod.mjs --email <utente> --dir <cartella> --profile <nome> [--match-only] [--expected f.json] [--batch id]'); process.exit(2) }
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
mkdirSync(OUT, { recursive: true })

let cookie = ''
async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL }), redirect: 'manual' })
  if (!res.ok) throw new Error(`login → HTTP ${res.status}`)
  cookie = ((res.headers.getSetCookie?.() || []).find((c) => c.startsWith('pdf_extractor_session=')) || '').split(';')[0]
  if (!cookie) throw new Error('login senza cookie')
}
async function api(path, init = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers || {}), Cookie: cookie } })
      if (res.status === 401 && attempt === 1) { await login(); continue }
      const text = await res.text()
      let body; try { body = JSON.parse(text) } catch { body = text }
      if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → HTTP ${res.status}: ${String(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 200)}`)
      return body
    } catch (err) {
      if (attempt >= 6 || /HTTP 4\d\d/.test(String(err.message))) throw err
      await new Promise((r) => setTimeout(r, 10000 * attempt))
    }
  }
}
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : (/\.pdf$/i.test(f) ? [p] : []) })

await login()
const settings = await api('/api/settings')
if (!BATCH) {
  const profile = (settings.polizzaProfiles || []).find((p) => p.name === PROFILE)
  if (!profile) throw new Error(`profilo "${PROFILE}" non presente in produzione`)
  const abs = join(root, DIR)
  const top = basename(abs)
  const groups = new Map()
  for (const f of walk(abs).sort()) {
    const rel = `${top}/${relative(abs, f)}`
    const folder = dirname(rel)
    if (!groups.has(folder)) groups.set(folder, [])
    groups.get(folder).push({ f, rel })
  }
  const label = arg('label', `TEST ${top}${MATCH_ONLY ? ' · abbinamento' : ''}`)
  BATCH = (await api('/api/polizza/batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) })).batchId
  console.log(`Batch ${BATCH} «${label}» — ${groups.size} dossier, profilo ${PROFILE}${MATCH_ONLY ? ', solo abbinamento' : ''}`)
  let n = 0
  for (const [folder, items] of groups) {
    const form = new FormData()
    for (const it of items) {
      form.append('pdf', new Blob([new Uint8Array(readFileSync(it.f))], { type: 'application/pdf' }), basename(it.f))
      form.append('path', it.rel)
    }
    form.append('dossierName', folder)
    form.append('profileId', profile.id)
    if (MATCH_ONLY) form.append('matchOnly', '1')
    await api(`/api/polizza/batch/${BATCH}/dossier`, { method: 'POST', body: form })
    if (++n % 10 === 0) console.log(`  caricati ${n}/${groups.size}`)
  }
  await api(`/api/polizza/batch/${BATCH}/complete`, { method: 'POST' })
  console.log(`  caricamento completato (${n} dossier)`)
}

const TERMINAL = new Set(['done', 'error', 'mismatch', 'review', 'matched', 'canceled'])
const t0 = Date.now()
let jobs = []
for (;;) {
  const b = await api(`/api/polizza/batch/${BATCH}`)
  jobs = b.jobs || []
  const open = jobs.filter((j) => !TERMINAL.has(j.status)).length
  const counts = jobs.reduce((a, j) => { a[j.status] = (a[j.status] || 0) + 1; return a }, {})
  console.log(`  ${new Date().toTimeString().slice(0, 8)} ${jobs.length} dossier · ${JSON.stringify(counts)}`)
  if (jobs.length && !open) break
  await new Promise((r) => setTimeout(r, 60000))
}
console.log(`Finito in ${Math.round((Date.now() - t0) / 60000)} min`)
// NON VALIDO (nessuna polizza secondo il modello, 26/09/2026): stessa regola di
// isNotValidJob (web/lib/jobValidity.ts). I vecchi «Accantonato» non lo sono.
const isNotValid = (j) => j.status === 'mismatch' && (!!j.precheck?.notValid || j.precheck?.polizza?.esito === 'assente' || /^Non valido\b/.test(String(j.error || '')))
const rows = jobs.map((j) => ({ jobId: j.jobId, dossier: j.dossierName, status: j.status, verdict: j.precheck?.verdict || null, notValid: isNotValid(j), polizza: j.precheck?.polizza?.esito || null, reason: j.precheck?.reason || j.error || '', proof: j.precheck?.operativita?.evidenza || '', values: Object.keys(j.values || {}).length }))
writeFileSync(join(OUT, `bulk-${BATCH}.json`), JSON.stringify({ batchId: BATCH, model: settings.ollamaModel, ctx: settings.polizzaBatchContext, rows }, null, 2))
if (EXPECTED) {
  const exp = JSON.parse(readFileSync(join(root, EXPECTED), 'utf8'))
  let right = 0
  let judged = 0
  console.log(`\n=== PERTINENZA contro ${EXPECTED} ===`)
  for (const c of exp.cases) {
    const hits = rows.filter((r) => String(r.dossier || '').includes(c.match) && !rows.some((o) => o !== r && String(o.dossier || '').includes(c.match) && String(o.dossier).length < String(r.dossier).length))
    const r = hits[0]
    if (!r) {
      // Cartella unita a un'altra dalla riconciliazione (stesso numero di polizza): non è più una posizione a sé.
      console.log(`  UNITA     ${c.id.padEnd(24)} atteso ${c.expected.padEnd(13)} → nessun dossier «${c.match}»: unito dalla riconciliazione (non conteggiato)`)
      continue
    }
    judged++
    const got = !r ? 'ASSENTE' : (r.status === 'matched' || (r.status === 'done' && r.verdict === 'ok')) ? 'operante'
      : r.notValid ? 'non valido' : 'non operante'
    // Fixture vecchie: 'accantonata' = 'non valido'. Un «non valido» NON vale
    // come «non operante»: una polizza vera detta senza polizza non si forza più.
    const want = c.expected === 'accantonata' ? 'non valido' : c.expected
    const ok = !!r && want === got
    if (ok) right++
    console.log(`  ${ok ? 'GIUSTO   ' : 'SBAGLIATO'} ${c.id.padEnd(24)} atteso ${c.expected.padEnd(13)} → ${got.padEnd(12)} ${r ? `[${r.status}] ${String(r.reason).slice(0, 110)}` : ''}`)
  }
  console.log(`  TOTALE ${right}/${judged}${judged < exp.cases.length ? ` (${exp.cases.length - judged} unite dalla riconciliazione)` : ''}`)
}
