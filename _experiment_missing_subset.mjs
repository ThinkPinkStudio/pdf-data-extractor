#!/usr/bin/env node
// PROBE ESPERIMENTO — run 3 mirata: i campi GENUINAMENTE mancanti nella run a 28
// (hanno ground truth, non "non presente"), per vedere se un request ridotto li recupera.
// Fascicolo B (Nebuloni). Cache OCR in_vigore_3__. NON modifica src/web/test.
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const svc = await import('./src/main/services/polizzaService.js')

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.37.10:11434'
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b-instruct'
const EMBED = 'bge-m3'
const OCR_CACHE = 'out/ocr'
const PREFIX = 'in_vigore_3__'
const PROFILI = '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'

const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))
const profilo = profili.find((p) => String(p.id) === '1785512148086')
const activeFields = (profilo.fields || []).filter((f) => f.enabled !== false)
const byId = (id) => activeFields.find((f) => f.id === id)

const cacheFiles = readdirSync(OCR_CACHE).filter((f) => f.startsWith(PREFIX) && f.endsWith('.pdf.json'))
const docs = []
for (const cache of cacheFiles) {
  const pages = JSON.parse(readFileSync(join(OCR_CACHE, cache), 'utf8'))
  if (!Array.isArray(pages) || !pages.length) continue
  const spatial = Object.keys(pages).map((k) => String(pages[k] || ''))
  docs.push({ name: cache.slice(PREFIX.length, -'.json'.length), pages: spatial })
}
if (!docs.length) process.exit(2)

const makeSettings = (fields) => ({
  ollamaUrl: OLLAMA_URL, ollamaModel: MODEL, embeddingModel: EMBED, ollamaNumCtx: 24576,
  polizzaFields: fields, polizzaPromptExtra: profilo.promptExtra || '',
  polizzaPerField: false, polizzaStagedCascade: false, polizzaConstrainedJson: true,
  polizzaConstrainedFormat: 'schema', polizzaPrecheckMode: 'off',
  polizzaAutoVerify: false, polizzaArchivio: false,
})

const TARGET = ['89ffb116-bf3b-4bcb-a6bb-7ceeed04cfee', '6e39add8-de2c-4d48-b231-f03cd4e05bd5', 'rct_massimale_danni']
const set3 = TARGET.map(byId)
if (!set3.every(Boolean)) { console.error('Campo target non definito'); process.exit(2) }
console.log(`RUN 3 (mancanti veri): ${set3.map((f) => `${f.id}="${f.label}"`).join(' | ')}`)

const t1 = Date.now()
let result
try {
  result = await svc.extractPolizzaFromDocs(docs, null, makeSettings(set3), (p) => {
    process.stdout.write(`\r· batch ${p.batch}/${p.batchTotal}   `)
  })
} catch (e) {
  console.error('\nERRORE:', e?.message || e)
  if (e?.diag) for (const l of e.diag) console.error('  diag:', l)
  process.exit(3)
}
const secs = ((Date.now() - t1) / 1000).toFixed(1)
console.log(`\nFatto in ${secs}s.\nDATA:`)
for (const f of set3) {
  const v = result.data?.[f.id]
  const src = result.sources?.[f.id]
  console.log(`  ${f.id} = ${(v == null || v === '') ? '(VUOTO)' : JSON.stringify(v)}${src && v ? `  [${src.file} · pag.${src.page}]` : ''}`)
}
console.log('\nDIAG:')
for (const l of result.diag || []) console.log(l)

mkdirSync('out', { recursive: true })
writeFileSync('out/experiment_staged_subset.json',
  JSON.stringify({ run3_missing: { data: result.data, sources: result.sources, secs } }, null, 2))
console.log('\nSalvato in out/experiment_staged_subset.json')