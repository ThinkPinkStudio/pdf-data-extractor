#!/usr/bin/env node
// PROBE MULTI-POLIZZA — verifica del motore per-campo (post-fix) su nuovi fascicoli
// col profilo RC PROF MED V2. Genera/riusa la cache OCR in out/ocr (pdfjs-spatial
// per PDF testuali, render+Tesseract spaziale per le immagini) e lancia
// extractPolizzaWithDocs con polizzaPerField=true + grounding.
// NON committare (script-uno python root temporaneo).
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

const here = dirname(fileURLToPath(import.meta.url))
const OCR_CACHE = join(here, 'out/ocr')
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.37.10:11434'
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b-instruct'
const EMBED = 'bge-m3'
const PROFILI = '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'

const svc = await import('./src/main/services/polizzaService.js')
const layout = await import('./src/main/services/ocrLayout.js')
const { usefulLength } = layout

const canvasMod = await import(pathToFileURL(join(here, 'web/node_modules/@napi-rs/canvas/index.js')).href)
const createCanvas = canvasMod.createCanvas
const RENDER_LONG_SIDE = 4400
const RENDER_MAX_SCALE = 6

const FASCICOLI = [
  {
    id: 'ODON', nome: '2C ODON (SARA)',
    folder: '/tmp/risolgi_scan/campione polizze x test 07 08 2026 3/2C ODON',
    folderCacheKey: 'risolgi_odon',
    skip: [],
  },
  {
    id: 'PROF', nome: 'RC PROF.LE (AmTrust Professioni Sanitarie)',
    folder: '/tmp/risolgi_scan/campione polizze x test 07 08 2026 4/RC PROF.LE',
    folderCacheKey: 'risolgi_prof',
    skip: [],
  },
]

function settingsFor(over = {}) {
  return { ollamaUrl: OLLAMA_URL, ollamaModel: MODEL, embeddingModel: 'bge-m3', ollamaNumCtx: 24576, llmProvider: 'ollama', polizzaOcrEnabled: true, ...over }
}

function makeSettings(profilo, staged = false) {
  const fields = (profilo.fields || []).filter((f) => f.enabled !== false)
  return settingsFor({
    polizzaFields: fields,
    polizzaPromptExtra: profilo.promptExtra || '',
    polizzaPerField: !staged,
    polizzaGrounding: true,
    polizzaStagedCascade: false,
    polizzaConstrainedJson: true,
    polizzaConstrainedFormat: 'schema',
    polizzaPrecheckMode: 'off',
    polizzaAutoVerify: false,
    polizzaArchivio: false,
  })
}

// ── pdfjs-spatial per PDF con testo ─────────────────────────────────────────
async function pdfjsSpatialPages(file) {
  const data = new Uint8Array(readFileSync(file))
  pdfjs.GlobalWorkerOptions.workerSrc = ''
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useWorkerFetch: false, disableFontFace: true }).promise
  const pages = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent({ includeMarkedContent: false })
    let text = '', prevX = null, prevY = null
    for (const item of content.items) {
      if (!('str' in item)) continue
      const x = item.transform[4], y = item.transform[5]
      if (prevY !== null) {
        const dy = Math.abs(y - prevY)
        const fsz = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 10
        if (item.hasEOL || dy > fsz * 0.4) { text += '\n'; prevX = null }
        else if (prevX !== null) {
          const gap = x - prevX
          const cw = (item.width > 0 && item.str.length > 0) ? item.width / item.str.length : fsz * 0.5
          if (gap > cw * 0.3) text += ' '
        }
      }
      text += item.str
      prevX = x + (item.width || item.str.length * (Math.abs(item.transform[0]) || (Math.abs(item.transform[3]) || 10) * 0.5))
      prevY = y
    }
    page.cleanup()
    pages.push(text.trim())
  }
  try { await doc.destroy() } catch {}
  return pages
}

// ── render + Tesseract per immagini (copiato da _ab_esteso) ────────────────
class NodeCanvasFactory {
  create(w, h) { const canvas = createCanvas(Math.max(1, w), Math.max(1, h)); return { canvas, context: canvas.getContext('2d') } }
  reset(cc, w, h) { cc.canvas.width = Math.max(1, w); cc.canvas.height = Math.max(1, h) }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; cc.canvas = null; cc.context = null }
}
async function renderPageToPng(doc, n) {
  const page = await doc.getPage(n)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(RENDER_MAX_SCALE, RENDER_LONG_SIDE / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })
  const cf = new NodeCanvasFactory()
  const cc = cf.create(viewport.width, viewport.height)
  await page.render({ canvasContext: cc.context, viewport, canvasFactory: cf }).promise
  const img = cc.context.getImageData(0, 0, cc.canvas.width, cc.canvas.height)
  const d = img.data; const contrast = 1.35; const intercept = 128 * (1 - contrast)
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]
    g = g * contrast + intercept
    d[i] = d[i+1] = d[i+2] = g < 0 ? 0 : g > 255 ? 255 : g
  }
  cc.context.putImageData(img, 0, 0)
  const png = cc.canvas.toDataURL('image/png')
  page.cleanup(); cf.destroy(cc)
  return png
}
async function pdfToPngs(file) {
  const data = new Uint8Array(readFileSync(file))
  pdfjs.GlobalWorkerOptions.workerSrc = ''
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useWorkerFetch: false, disableFontFace: true, canvasFactory: new NodeCanvasFactory() }).promise
  const pngs = []
  for (let i = 1; i <= doc.numPages; i++) {
    try { pngs.push(await renderPageToPng(doc, i)) } catch { pngs.push('') }
  }
  try { await doc.destroy() } catch {}
  return pngs
}

async function ensureOcrPages(file, cacheFile) {
  try {
    const existing = JSON.parse(readFileSync(cacheFile, 'utf8'))
    if (Array.isArray(existing) && existing.length) return existing
  } catch {}
  const spatial = await pdfjsSpatialPages(file)
  const hasText = spatial.some((p) => p && p.trim().length > 50)
  if (hasText) {
    writeFileSync(cacheFile, JSON.stringify(spatial))
    return spatial
  }
  // immagini: render + Tesseract spaziale (pesante)
  console.log(`  … ${basename(file)} è immagini → Tesseract`)
  const pngs = await pdfToPngs(file)
  const pages = []
  for (let i = 0; i < pngs.length; i++) {
    if (!pngs[i]) { pages.push(''); continue }
    pages.push(await svc.ocrPageText(pngs[i]))
    process.stdout.write(`p${i+1}=${(pages[i]||'').length}ch `)
  }
  console.log('')
  writeFileSync(cacheFile, JSON.stringify(pages))
  return pages
}

async function buildDocs(f) {
  const pdfs = readdirSync(f.folder).filter((x) => x.toLowerCase().endsWith('.pdf')).filter((x) => !f.skip.includes(x))
  const docs = []
  mkdirSync(OCR_CACHE, { recursive: true })
  for (const pdf of pdfs) {
    const cacheFile = join(OCR_CACHE, `${f.folderCacheKey}__${pdf.replace(/[^a-z0-9.]+/gi, '_')}.json`)
    const pages = await ensureOcrPages(join(f.folder, pdf), cacheFile)
    const spatial = Object.keys(pages).map((k) => String(pages[k] || ''))
    const valid = spatial.filter((p) => p && p.trim())
    const chars = spatial.reduce((s, p) => s + p.length, 0)
    const useful = spatial.reduce((s, p) => s + usefulLength(p), 0)
    console.log(`- ${pdf}: ${spatial.length} pag, ${valid.length} con testo, ${chars} ch (useful ${useful})`)
    if (valid.length) docs.push({ name: pdf, pages: spatial })
  }
  return docs
}

const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))
const profilo = profili.find((x) => x.name === 'RC PROF MED V2')
if (!profilo) throw new Error('Profilo RC PROF MED V2 non trovato')

// NB: niente probeOcr qui — per i PDF testuali usiamo pdfjs-spatial; per le
// immagini il Tesseract viene creato on-demand dentro ocrPageText. (probeOcr su
// questo host resta appeso nel loader.)
const runCase = process.argv[2] || 'BOTH'
const staged = process.env.STAGED === '1'

for (const f of FASCICOLI) {
  if (runCase !== 'BOTH' && !runCase.includes(f.id)) continue
  console.log(`\n══════ ${f.id} — ${f.nome} ══════`)
  const docs = await buildDocs(f)
  console.log(`${docs.length} documenti`)
  const settings = makeSettings(profilo, staged)
  const t0 = Date.now()
  let res
  try {
    res = await svc.extractPolizzaFromDocs(docs, null, settings, (p) => {
      if (p.field != null) process.stdout.write(`\r· campo ${p.field}/${p.fieldTotal}   `)
      else process.stdout.write(`\r· ${p.batch}/${p.batchTotal}   `)
    })
  } catch (e) {
    console.error('\nERRORE:', e?.message || e)
    process.exit(3)
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`\n→ ${secs}s, ${Object.keys(res.data || {}).length} campi (${staged ? 'STAGED' : 'per-field'})\n`)
  for (const [k, v] of Object.entries(res.data || {})) {
    const src = res.sources?.[k]
    console.log(`  ${k} = ${JSON.stringify(v)}${src ? `  [${String(src.file).split('/').pop()} · pag.${src.page}${src.line ? ` r${src.line}` : ''}]` : ''}`)
  }
  console.log('\n— DIAGNOSTICA —')
  for (const l of res.diag || []) console.log(l)
  writeFileSync(`out/_risolgi_${f.id}_${staged ? 'staged' : 'perfield'}.json`, JSON.stringify({ caso: f.id, nome: f.nome, profilo: 'RC PROF MED V2', model: MODEL, staged, secs, data: res.data, sources: res.sources, diag: res.diag, fields: (profilo.fields || []).filter((ok) => ok.enabled !== false) }, null, 2))
}