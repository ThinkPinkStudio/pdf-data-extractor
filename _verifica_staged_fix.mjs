#!/usr/bin/env node
// VERIFICA REALE FINALE — motore STAGED post-fix (problema 1: premio NON più calcolato;
// problema 3: veto natura-estranea-massimale). Lavora DIRETTAMENTE sulla cache OCR
// in out/ocr (nessuna cartella PDF richiesta).
// Uso sequenziale, un fascicolo per chiamata:
//   node _verifica_staged_fix.mjs <cache_prefix> <nome_profilo> <id_caso> <out_suffix>
// Es. node _verifica_staged_fix.mjs in_vigore_3__ "RC PROF MED V2" B B
// NON modifica src/web/test. NON committare.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const svc = await import('./src/main/services/polizzaService.js')

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.37.10:11434'
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b-instruct'
const EMBED = 'bge-m3'
const OCR_CACHE = 'out/ocr'
const PROFILI = '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'

const [,, cachePrefixRaw = '', profiloName = '', casoId = '', outSuffix = casoId] = process.argv
if (!cachePrefixRaw || !profiloName) {
  console.error('Serve: node _verifica_staged_fix.mjs <cache_prefix> <nome_profilo> [id_caso] [out_suffix]')
  process.exit(2)
}
const prefix = cachePrefixRaw.replace(/^_+|_+$/g, '')

const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))
const profilo = profili.find((p) => p.name === profiloName)
if (!profilo) { console.error(`Profilo "${profiloName}" non trovato`); process.exit(2) }
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

// ── carica i documenti dalla cache OCR col prefisso dato ────────────────────
const cacheFiles = readdirSync(OCR_CACHE).filter((f) => f.startsWith(prefix + '__') && f.endsWith('.json'))
if (!cacheFiles.length) { console.error(`Nessuna cache OCR con prefisso "${prefix}" in ${OCR_CACHE}`); process.exit(2) }
const docs = []
for (const f of cacheFiles.sort()) {
  let pages = null
  try { pages = JSON.parse(readFileSync(join(OCR_CACHE, f), 'utf8')) } catch {}
  if (!Array.isArray(pages) || !pages.length) { console.log(`  - cache NON valida ${f} — salto`); continue }
  const spatial = Object.keys(pages).map((k) => String(pages[k] || ''))
  const name = f.slice(prefix.length + 2, -'.json'.length)
  docs.push({ name, pages: spatial })
  const chars = spatial.reduce((s, p) => s + p.length, 0)
  const useful = spatial.reduce((s, p) => s + (svc.usefulLength?.(p) ?? 0), 0)
  console.log(`- ${name} -> ${spatial.length} pag. da cache, ${chars} char (useful ${useful})`)
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
const outPath = `out/_verifica_${outSuffix}.json`
const out = {
  caso: casoId, profiloId: profilo.id, profilo: profilo.name, fascicolo: cachePrefixRaw,
  modello: MODEL, ollamaUrl: OLLAMA_URL, strategia: 'staged-gruppi', numCtx: 24576, secs,
  data: result.data, sources: result.sources, reliability: result.reliability, diag: result.diag,
}
writeFileSync(outPath, JSON.stringify(out, null, 2))
console.log(`\nSalvato in ${outPath}`)