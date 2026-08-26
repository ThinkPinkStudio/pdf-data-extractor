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
const CASE = process.argv[2] || 'B'
const CASI = {
  B: { folderCacheKey: 'in_vigore_3', profilo: 'RC PROF MED V2', skip: ['Set_Informativo_AmTrust_Medico_Protetto_Ed062024_Agg072025.pdf'] },
  A: { folderCacheKey: 'in_vigore', profilo: 'Rc Professionale V3', skip: [] },
}
const c = CASI[CASE].profilo

const settings = { ollamaUrl: OLLAMA_URL, embeddingModel: EMBED, ollamaNumCtx: 24576 }
const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))
const profilo = profili.find((x) => x.name === c)
const activeFields = (profilo.fields || []).filter((f) => f.enabled !== false)
const skipFiles = CASI[CASE].skip
const folderCacheKey = CASI[CASE].folderCacheKey

// docs per buildEvidenceWindows: {name, pages (spaziali), dateStr}
const docsForWindows = []
for (const cf of readdirSync(join(here, 'out/ocr'))) {
  if (!cf.startsWith(folderCacheKey + '__')) continue
  const cacheFile = join(here, 'out/ocr', cf)
  let pages
  try { pages = JSON.parse(readFileSync(cacheFile, 'utf8')) } catch { continue }
  const name = cf.replace(folderCacheKey + '__', '').replace(/\.json$/, '')
  const spatial = Object.keys(pages).map((k) => String(pages[k] || ''))
  docsForWindows.push({ name, pages: spatial })
}

// chunks: stessa pipeline per-field, iterando i file della cache OCR del caso
const chunks = []
for (const cf of readdirSync(join(here, 'out/ocr'))) {
  if (!cf.startsWith(folderCacheKey + '__')) continue
  let pages
  try { pages = JSON.parse(readFileSync(join(here, 'out/ocr', cf), 'utf8')) } catch { continue }
  const name = cf.replace(folderCacheKey + '__', '').replace(/\.json$/, '')
  const docType = classifyDocType(name)
  const all = Object.keys(pages).map((k) => String(pages[k] || ''))
  const docYear = detectDocYear(name, all.join('\n'))
  all.forEach((spatial, pIdx) => {
    const flat = collapseSpatial(spatial)
    for (const t of chunkText(flat)) chunks.push({ text: t, spatialPage: spatial, file: name, page: pIdx + 1, doc_type: docType, doc_year: docYear })
  })
}
console.log('chunks totali:', chunks.length, 'docs windows:', docsForWindows.length)

const B = 32
for (let i = 0; i < chunks.length; i += B) {
  const batch = chunks.slice(i, i + B)
  const vecs = await embedTexts(settings, batch.map((c) => c.text))
  batch.forEach((c, j) => { c.vector = vecs[j] })
}
console.log('chunks embeddati')

const STRUCT_DOCTYPES = ['polizza', 'appendice', 'condizioni', 'altro']
const queries = activeFields.map((f) => `${f.label}. ${stripFieldExamples(f.description || f.label || f.id)}`)
const qvecs = []
for (let i = 0; i < queries.length; i += B) qvecs.push(...await embedTexts(settings, queries.slice(i, i + B)))

function cosineTopK(queryVec, opts) {
  const { docTypes = null, k = 6, recencyBoost = false } = opts || {}
  const scored = []
  for (const cd of chunks) {
    if (docTypes && !docTypes.includes(cd.doc_type)) continue
    scored.push({ cd, score: cosineSim(queryVec, cd.vector) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k).map((s) => s.cd)
}

let totalHits = 0, zeroHits = 0, noWin = 0
const zeroHitFields = [], noWindowFields = []
const top3 = {}
activeFields.forEach((f, i) => {
  const opts = isStructuralField(f) ? { docTypes: STRUCT_DOCTYPES, k: 6 } : { docTypes: null, k: 6, recencyBoost: isPeriodicEconomicField(f) }
  const hits = cosineTopK(qvecs[i], opts)
  totalHits += hits.length
  const windows = buildEvidenceWindows(f, docsForWindows)
  top3[f.label] = { lbl: f.label, hitsTop: hits.slice(0, 3).map((h) => `${h.file.split('/').pop()}#p${h.page} ~${cosineSim(qvecs[i], h.vector).toFixed(3)}`), hits: hits.length, windows: windows.length }
  if (!hits.length) { zeroHits++; zeroHitFields.push(f.label) }
  if (!windows.length) { noWin++; noWindowFields.push(f.label) }
})
const hasWin = activeFields.length - noWin
console.log(`\n=== RISULTATO CASO ${CASE} ===`)
console.log(`hits totali: ${totalHits}, campi con hits=0: ${zeroHits}/${activeFields.length}`)
console.log(`windows buildEvidence: ${hasWin} con, ${noWin} senza`)
console.log('\n-- campi con hits=0 --')
console.log(zeroHitFields.join('\n') || 'nessuno')
console.log('\n-- campi con windows vuote --')
console.log(noWindowFields.join('\n') || 'nessuno')
console.log('\n-- dettaglio (top hit + n_windows) --')
for (const [k, v] of Object.entries(top3)) console.log(`${v.lbl}: hits=${v.hits} win=${v.windows}  ${v.hitsTop.join(' | ')}`)