#!/usr/bin/env node
/**
 * Runner E2E per calibrazione: estrae i dati di un profilo da una cartella di PDF
 * e salva il risultato in un JSON { data: { campo: valore } }.
 *
 * Modellato su test-guffanti.mjs (pdfjs spaziale + extractPolizzaStaged).
 *
 * Uso:
 *   node scripts/calibrazione-run.mjs --dir <cartella> --profile "<Nome profilo>" --out <out.json> [--files "a.pdf,b.pdf"] [--ollama <url>]
 *
 * Se --files è omesso usa TUTTI i PDF della cartella (esclude .txt/.json).
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  return process.argv[i + 1]
}

const dir = arg('dir')
const profileName = arg('profile')
const out = arg('out')
const filesArg = arg('files')
const ollamaUrl = arg('ollama', process.env.OLLAMA_URL || 'http://192.168.37.10:11434')
const modelName = arg('model', process.env.OLLAMA_MODEL || 'qwen3:8b')
const profileJson = arg('profile-json', join(root, 'polizze_test/profili-polizza (5).json'))
const onlyFields = arg('only-fields') // lista id separati da virgola
const ctx = arg('ctx') ? Number(arg('ctx')) : 8192
if (!dir || !profileName || !out) {
  console.error('Uso: node scripts/calibrazione-run.mjs --dir <cartella> --profile "<Nome>" --out <out.json> [--files "a,b"] [--ollama <url>] [--profile-json <file>] [--only-fields "id1,id2"] [--model qwen3:8b]')
  process.exit(2)
}

const PROFILE_JSON = profileJson
const profiles = JSON.parse(readFileSync(PROFILE_JSON, 'utf8'))
const profile = profiles.find((p) => p.name === profileName)
if (!profile) { console.error(`Profilo "${profileName}" non trovato`); process.exit(2) }
let fields = profile.fields.filter((f) => f.enabled !== false)
if (onlyFields) {
  const keep = new Set(onlyFields.split(',').map((s) => s.trim()).filter(Boolean))
  fields = fields.filter((f) => keep.has(f.id))
}
console.log(`Profilo: ${profile.name} — ${fields.length} campi attivi${onlyFields ? ' (solo --only-fields)' : ''}`)

const svc = await import(join(root, 'src/services/polizzaService.js'))
const { collapseSpatial } = await import(join(root, 'src/services/ocrLayout.js'))
const { spatialPagesFromPdf } = await import(join(root, 'src/services/pdfTextLayer.js'))

// UN SOLO percorso pdfjs per worker e script: src/services/pdfTextLayer.js.
// Le pagine senza text layer restano '' (così `hasEmptyPage` sotto vede
// davvero le scansioni: prima venivano saltate e l'OCR non partiva mai).
async function extractPages(filePath) {
  return spatialPagesFromPdf(readFileSync(filePath))
}

let files
if (filesArg) {
  files = filesArg.split(',').map((s) => s.trim()).filter(Boolean)
} else {
  files = readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).sort()
}
console.log(`File da elaborare (${files.length}):`)
for (const f of files) console.log(`  - ${f}`)

const docs = []
for (const f of files) {
  const p = join(dir, f)
  if (!existsSync(p)) { console.warn(`  !! manca: ${f}`); continue }
  let pages = await extractPages(p)
  const flat = pages.map((pg) => collapseSpatial(pg)).join('\n')
  docs.push({ name: f, pages, text: flat })
  console.log(`  doc: ${f} — ${pages.length} pagine, ${flat.length} char`)
}
if (!docs.length) { console.error('Nessun documento utilizzabile.'); process.exit(2) }

// OCR attivo solo se servono pagine (scan senza text layer): per i PDF con
// testo leggibile l'OCR è uno spreco. I docs hanno `pages` (piatta) già
// popolate; una pagina vuota = potrebbe essere scan → attiviamo Tesseract.
const hasEmptyPage = docs.some((d) => (d.pages || []).some((p) => !String(p || '').trim()))

const settings = {
  ollamaUrl,
  ollamaModel: modelName,
  polizzaFields: fields,
  polizzaConstrainedJson: true,
  polizzaPerField: false,
  polizzaStagedCascade: false,
  polizzaOcrEnabled: hasEmptyPage,
  embeddingModel: 'bge-m3',
  polizzaBatchContext: ctx,
}

const started = Date.now()
try {
  const res = await svc.extractPolizzaStaged(docs, settings, () => {})
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  const dataOut = {}
  for (const f of fields) {
    const v = res.data[f.id]
    if (v != null && v !== '') dataOut[f.id] = v
  }
  writeFileSync(out, JSON.stringify({ data: dataOut }, null, 2))
  console.log(`\n=== RISULTATO (${secs}s) — ${Object.keys(dataOut).length}/${fields.length} campi ===`)
  for (const f of fields) {
    const v = res.data[f.id]
    const src = res.sources?.[f.id]
    const label = f.label || f.id
    console.log(`  ${v != null && v !== '' ? 'OK ' : '-- '} ${String(label).padEnd(42)} = ${v != null && v !== '' ? String(v).slice(0, 80) : '(vuoto)'}${src ? `  [${src.file}${src.page ? ` p${src.page}` : ''}]` : ''}`)
  }
  console.log(`\nSalvato in ${out}`)
  const diagPath = out.replace(/\.json$/, '-diag.txt')
  writeFileSync(diagPath, (res.diag || []).join('\n'))
  console.log(`Diagnostica in ${diagPath}`)
} catch (err) {
  console.error('ERRORE:', err.message)
  console.error(err)
  process.exit(1)
}
