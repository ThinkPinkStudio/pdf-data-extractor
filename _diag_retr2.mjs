import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { embedTexts, chunkText, classifyDocType, detectDocYear } from './src/main/services/vectorIndexService.js'
import { cosineSim } from './src/main/services/polizzaPrecheck.js'
import { isStructuralField, isPeriodicEconomicField, stripFieldExamples } from './src/main/services/polizzaValidation.js'
import { collapseSpatial } from './src/main/services/ocrLayout.js'
import { buildEvidenceWindows } from './src/main/services/polizzaGrounding.js'

const here = dirname(fileURLToPath(import.meta.url))
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.37.10:11434'
const EMBED = 'bge-m3'
const PROFILI = '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'
const CASO = process.argv[2] || 'ODON'
const MAP = {
  ODON: { key: 'risolgi_odon', folder: '/tmp/risolgi_scan/campione polizze x test 07 08 2026 3/2C ODON' },
  PROF: { key: 'risolgi_prof', folder: '/tmp/risolgi_scan/campione polizze x test 07 08 2026 4/RC PROF.LE' },
}
const key = MAP[CASO].key

const settings = { ollamaUrl: OLLAMA_URL, embeddingModel: EMBED, ollamaNumCtx: 24576 }
const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))
const profilo = profili.find((x) => x.name === 'RC PROF MED V2')
const activeFields = (profilo.fields || []).filter((f) => f.enabled !== false)

const docsForWindows = []
for (const cf of readdirSync(join(here, 'out/ocr'))) {
  if (!cf.startsWith(key + '__')) continue
  let pages
  try { pages = JSON.parse(readFileSync(join(here, 'out/ocr', cf), 'utf8')) } catch { continue }
  const name = cf.replace(key + '__', '').replace(/\.json$/, '')
  const spatial = Object.keys(pages).map((k) => String(pages[k] || ''))
  docsForWindows.push({ name, pages: spatial })
}

const chunks = []
for (const cf of readdirSync(join(here, 'out/ocr'))) {
  if (!cf.startsWith(key + '__')) continue
  let pages
  try { pages = JSON.parse(readFileSync(join(here, 'out/ocr', cf), 'utf8')) } catch { continue }
  const name = cf.replace(key + '__', '').replace(/\.json$/, '')
  const docType = classifyDocType(name)
  const all = Object.keys(pages).map((k) => String(pages[k] || ''))
  const docYear = detectDocYear(name, all.join('\n'))
  all.forEach((spatial, pIdx) => {
    const flat = collapseSpatial(spatial)
    for (const t of chunkText(flat)) chunks.push({ text: t, spatialPage: spatial, file: name, page: pIdx + 1, doc_type: docType, doc_year: docYear })
  })
}
console.log('chunks:', chunks.length, 'docs:', docsForWindows.length)
const B = 32
for (let i = 0; i < chunks.length; i += B) {
  const batch = chunks.slice(i, i + B)
  const vecs = await embedTexts(settings, batch.map((c) => c.text))
  batch.forEach((c, j) => { c.vector = vecs[j] })
}
const STRUCT_DOCTYPES = ['polizza', 'appendice', 'condizioni', 'altro']
const queries = activeFields.map((f) => `${f.label}. ${stripFieldExamples(f.description || f.label || f.id)}`)
const qvecs = []
for (let i = 0; i < queries.length; i += B) qvecs.push(...await embedTexts(settings, queries.slice(i, i + B)))

function cosineTopK(q, opts) {
  const { docTypes = null, k = 6, recencyBoost = false } = opts || {}
  const scored = []
  for (const cd of chunks) {
    if (docTypes && !docTypes.includes(cd.doc_type)) continue
    scored.push({ cd, score: cosineSim(q, cd.vector) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).map((s) => s.cd)
}

let total = 0, zero = 0
const noWindow = []
const kArg = process.argv[3] ? parseInt(process.argv[3], 10) : 6
activeFields.forEach((f, i) => {
  const opts = isStructuralField(f) ? { docTypes: STRUCT_DOCTYPES, k: kArg } : { docTypes: null, k: kArg, recencyBoost: isPeriodicEconomicField(f) }
  const hits = cosineTopK(qvecs[i], opts)
  total += hits.length
  const windows = buildEvidenceWindows(f, docsForWindows)
  if (!hits.length) { zero++ }
  if (!windows.length) noWindow.push(f.label)
})
console.log(`hits totali ${total}, campi con 0 hit ${zero}`)
console.log(`campi senza windows deterministiche (${noWindow.length}): ${noWindow.join(' | ')}`)

// stampa top-hit testuale per i campi critici
const crit = ['N° Polizza', 'Compagnia', 'Contraente/Assicurato', 'P. IVA / Cod. Fiscale', 'Decorrenza', 'Premio lordo']
activeFields.forEach((f, i) => {
  if (!crit.includes(f.label)) return
  const opts = isStructuralField(f) ? { docTypes: STRUCT_DOCTYPES, k: kArg } : { docTypes: null, k: kArg, recencyBoost: isPeriodicEconomicField(f) }
  const hits = cosineTopK(qvecs[i], opts)
  console.log(`\n--- ${f.label} (${f.id}) ---`)
  for (const h of hits.slice(0, 4)) {
    const t = h.spatialPage || h.text
    console.log(`  [${h.file} p${h.page} ${h.doc_type}] ${t.slice(0, 180).replace(/\n/g, ' ')}`)
  }
})