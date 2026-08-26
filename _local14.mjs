#!/usr/bin/env node
// PROBE LOCALE 14b — qwen2.5:14b su Ollama locale (127.0.0.1), fascicolo CEDAM "in vigore".
// Stesso percorso del probe baseline 7b (_probe_finale/_probe_nonreg): staged-gruppi,
// perField=false, cascade=false, constrained=true, precheck off, autoVerify false,
// archivio false, grounding NON attivato (polizzaGrounding assente=false).
// Solo differenze: modello qwen2.5:14b, ollamaUrl locale, numCtx 16384.
// NON è parte del progetto: non committare.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const svc = await import('./src/main/services/polizzaService.js')

const OLLAMA_URL = 'http://127.0.0.1:11434'
const MODEL = 'qwen2.5:14b'
const EMBED = 'bge-m3'
const NUM_CTX = 16384
const FASCICOLO = 'in vigore'
const ROOT = '/tmp/prep_casi/zip1/campione polizze x test 07 08 2026 1'
const PROFILI = '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'
const OCR_CACHE = 'out/ocr'
const OUT = 'out/probe_local14_raw.json'
const MIN_TOTAL_SEC = 12 * 60 // 12 minuti: oltre questo si chiede l'interruzione al motore

const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))
const profilo = profili.find((p) => p.id === '1785512148086')
if (!profilo) { console.error('Profilo RC PROF MED V2 (1785512148086) non trovato'); process.exit(2) }
const fields = (profilo.fields || []).filter((f) => f.enabled !== false)
console.log(`Profilo: "${profilo.name}" (id ${profilo.id}) — ${fields.length} campi attivi`)

const settings = {
  ollamaUrl: OLLAMA_URL,
  ollamaModel: MODEL,
  embeddingModel: EMBED,
  ollamaNumCtx: NUM_CTX,
  polizzaFields: fields,
  polizzaPromptExtra: profilo.promptExtra || '',
  polizzaPerField: false,
  polizzaStagedCascade: false,
  polizzaConstrainedJson: true,
  polizzaPrecheckMode: 'off',
  polizzaAutoVerify: false,
  polizzaArchivio: false,
}

// Cancel-flag del watchdog interno del motore: chiedere cancellation a 12 min
// chiude lo stream (niente zombie lato Ollama) e il motore ritorna i campi finora.
const cancel = { canceled: false }
settings.__cancelFlag = cancel

const folder = join(ROOT, FASCICOLO)
const pdfs = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.pdf'))
const docs = []
for (const f of pdfs) {
  const cacheFile = join(OCR_CACHE, `${FASCICOLO.replace(/[^a-z0-9]+/gi, '_')}__${f.replace(/[^a-z0-9.]+/gi, '_')}.json`)
  let pages = null
  try { pages = JSON.parse(readFileSync(cacheFile, 'utf8')) } catch {}
  if (!Array.isArray(pages) || !pages.length) {
    console.log(`  salto (cache OCR mancante): ${f}`)
    continue
  }
  const spatial = Object.keys(pages).map((k) => String(pages[k] || ''))
  docs.push({ name: f, pages: spatial })
  const chars = spatial.reduce((s, p) => s + p.length, 0)
  const useful = spatial.reduce((s, p) => s + (svc.usefulLength?.(p) ?? 0), 0)
  console.log(`— ${f} → ${spatial.length} pagine da cache, ${chars} char (useful ${useful})`)
}
if (!docs.length) { console.error('Nessun documento utilizzabile in cache OCR'); process.exit(2) }

console.log(`\nLLM ${MODEL} su ${OLLAMA_URL} · embed ${EMBED} · numCtx ${NUM_CTX} · ${docs.length} file, ${fields.length} campi\n`)
const t0 = Date.now()
let result = null
let errore = null
let checker = null
try {
  // Watchdog esterno: chiede l'interruzione al motore a 12 min (il motore chiude
  // lo stream e ritorna i campi finora). Dump di avanzamento ogni 60s.
  checker = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000)
    if (s > 0 && s % 60 === 0) console.error(`\n→ ${s}s trascorse, ancora in esecuzione…`)
    if (s >= MIN_TOTAL_SEC) {
      console.error(`\n[timeout] superati ${MIN_TOTAL_SEC}s — chiedo l'interruzione al motore`)
      cancel.canceled = true
    }
  }, 15000)
  result = await svc.extractPolizzaFromDocs(docs, null, settings, (p) => {
    const label = p.field != null ? `campo ${p.field}/${p.fieldTotal}` : `batch ${p.batch}/${p.batchTotal}`
    process.stdout.write(`\r· ${label}   `)
  })
} catch (e) {
  errore = `ERRORE estrazione: ${e?.message || e}`
  console.error(`\n${errore}`)
  if (e?.diag) for (const l of e.diag) console.error('  diag:', l)
  result = null
} finally {
  clearInterval(checker)
}
const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\n\nFatto in ${secs}s${errore ? ' — con errore' : ''}. Campi ridati: ${Object.keys(result?.data || {}).length}\n`)
for (const [k, v] of Object.entries(result?.data ?? {})) {
  const src = result.sources?.[k]
  console.log(`  ${k} = ${JSON.stringify(v)}${src ? `   [${src.file} · pag.${src.page}]` : ''}`)
}
console.log('\n— DIAGNOSTICA —')
for (const l of result?.diag || []) console.log(l)

mkdirSync('out', { recursive: true })
writeFileSync(OUT, JSON.stringify({
  profiloId: profilo.id, profilo: profilo.name, fascicolo: FASCICOLO,
  modello: MODEL, embedding: EMBED, ollamaUrl: OLLAMA_URL, numCtx: NUM_CTX,
  secs, errore, strategia: 'staged-gruppi (perField=false, cascade=false, grounding=off)',
  data: result?.data ?? {}, sources: result?.sources ?? {},
  reliability: result?.reliability, diag: result?.diag ?? [],
}, null, 2))
console.log(`\nSalvato in ${OUT}`)