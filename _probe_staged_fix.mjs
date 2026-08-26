#!/usr/bin/env node
// PROBE STAGED — verifica REALE dei fix al motore a stadi (veto per-pagina,
// isRinviAttivita date/numeri, guardrail quelli attivita, scan franchigia).
// Parametrizzato via env/argv: ROOT, FASCICOLO, CACHE_PREFIX, PROFILO, OUT.
// NON modifica src/web/test. NON committare.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const svc = await import('./src/main/services/polizzaService.js')

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.37.10:11434'
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b-instruct'
const EMBED = process.env.EMBED_MODEL || 'bge-m3'
const ROOT = process.env.ROOT
const FASCICOLO = process.env.FASCICOLO
const CACHE_PREFIX = (process.env.CACHE_PREFIX ?? FASCICOLO).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')
const PROFILO_NAME = process.env.PROFILO
const OUT = process.env.OUT || `out/probe_staged_${CACHE_PREFIX}.json`
const PROFILI = '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'
const OCR_CACHE = 'out/ocr'

if (!ROOT || !FASCICOLO || !PROFILO_NAME) {
  console.error('Serve ROOT, FASCICOLO, PROFILO')
  process.exit(2)
}

const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))
const profilo = profili.find((p) => p.name === PROFILO_NAME)
if (!profilo) { console.error(`Profilo "${PROFILO_NAME}" non trovato`); process.exit(2) }
const fields = (profilo.fields || []).filter((f) => f.enabled !== false)
console.log(`Profilo: "${profilo.name}" (id ${profilo.id}) — ${fields.length} campi attivi`)

const settings = {
  ollamaUrl: OLLAMA_URL,
  ollamaModel: MODEL,
  embeddingModel: EMBED,
  ollamaNumCtx: 24576,
  polizzaFields: fields,
  polizzaPromptExtra: profilo.promptExtra || '',
  polizzaPerField: false,
  polizzaStagedCascade: false,
  polizzaConstrainedJson: true,
  polizzaPrecheckMode: 'off',
  polizzaAutoVerify: false,
  polizzaArchivio: false,
}

const folder = join(ROOT, FASCICOLO)
const pdfs = readdirSync(folder).filter((f) => f.toLowerCase().endsWith('.pdf'))
const docs = []
for (const f of pdfs) {
  const cacheFile = join(OCR_CACHE, `${CACHE_PREFIX}__${f.replace(/[^a-z0-9.]+/gi, '_')}.json`)
  let pages = null
  try { pages = JSON.parse(readFileSync(cacheFile, 'utf8')) } catch {}
  if (!Array.isArray(pages) || !pages.length) {
    console.log(`  - cache mancante per ${f} — salto`)
    continue
  }
  const spatial = Object.keys(pages).map((k) => String(pages[k] || ''))
  docs.push({ name: f, pages: spatial })
  const chars = spatial.reduce((s, p) => s + p.length, 0)
  const useful = spatial.reduce((s, p) => s + (svc.usefulLength?.(p) ?? 0), 0)
  console.log(`- ${f} -> ${spatial.length} pag. da cache, ${chars} char (useful ${useful})`)
}
if (!docs.length) { console.error('Nessun documento utilizzabile in cache OCR'); process.exit(2) }

const t0 = Date.now()
console.log(`\nEstrazione staged-gruppi su ${OLLAMA_URL} / ${MODEL} (${docs.length} file, ${fields.length} campi, numCtx 24576)\n`)
let result
try {
  result = await svc.extractPolizzaFromDocs(docs, null, settings, (p) => {
    const label = p.field != null ? `campo ${p.field}/${p.fieldTotal}` : `batch ${p.batch}/${p.batchTotal}`
    process.stdout.write(`\r - ${label}   `)
  })
} catch (e) {
  console.error('\nERRORE estrazione:', e?.message || e)
  if (e?.diag) for (const l of e.diag) console.error('  diag:', l)
  process.exit(3)
}
const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`\n\nFatto in ${secs}s. Campi: ${Object.keys(result.data || {}).length}\n`)
for (const [k, v] of Object.entries(result.data || {})) {
  const src = result.sources?.[k]
  console.log(`  ${k} = ${JSON.stringify(v)}${src ? `  [${src.file} · pag.${src.page}]` : ''}`)
}
console.log('\n- DIAGNOSTICA -')
for (const l of result.diag || []) console.log(l)

mkdirSync('out', { recursive: true })
const out = {
  profiloId: profilo.id, profilo: profilo.name, fascicolo: FASCICOLO, modello: MODEL, secs,
  strategia: 'staged-gruppi', numCtx: 24576,
  data: result.data, sources: result.sources, reliability: result.reliability, diag: result.diag,
}
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`\nSalvato in ${OUT}`)