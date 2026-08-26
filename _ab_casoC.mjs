#!/usr/bin/env node
// PROBE CASO C — pre-check di pertinenza: Globale Fabbricati vs profili A e B.
// Deve risultare MISMATCH con keyword/semantic (e precheck off → skipped).
// Genera la cache OCR se manca, poi out/_ab_caso_C.json con runPrecheck per
// entrambi i profili × 3 mode.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://192.168.37.10:11434'
const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b-instruct'
const EMBED = 'bge-m3'
const OCR_CACHE = join(process.cwd(), 'out/ocr')
const PROFILI = process.env.PROFILI_JSON || '/Volumes/Dock/francesco/Downloads/profili-polizza (1).json'
const FOLDER = '/tmp/prep_casi/zip1/campione polizze x test 07 08 2026 1/Cond Via della libertà 55'

const here = dirname(fileURLToPath(import.meta.url))
const canvasMod = await import(pathToFileURL(join(here, 'web/node_modules/@napi-rs/canvas/index.js')).href)
const createCanvas = canvasMod.createCanvas

const svc = await import('./src/main/services/polizzaService.js')
const precheckSvc = await import('./src/main/services/polizzaPrecheckService.js')

const settings = {
  ollamaUrl: OLLAMA_URL, ollamaModel: MODEL, embeddingModel: EMBED,
  ollamaNumCtx: 24576, llmProvider: 'ollama',
}

// ── render + OCR spaziale (stessa pipeline del probe _ab_esteso) ─────────────
class NodeCanvasFactory {
  create(width, height) { const canvas = createCanvas(Math.max(1, width), Math.max(1, height)); return { canvas, context: canvas.getContext('2d') } }
  reset(cc, w, h) { cc.canvas.width = Math.max(1, w); cc.canvas.height = Math.max(1, h) }
  destroy(cc) { cc.canvas.width = 0; cc.canvas.height = 0; cc.canvas = null; cc.context = null }
}
const RENDER_LONG_SIDE = 4400, RENDER_MAX_SCALE = 6

async function renderPageToPng(doc, pageNum) {
  const page = await doc.getPage(pageNum)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(RENDER_MAX_SCALE, RENDER_LONG_SIDE / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })
  const canvasFactory = new NodeCanvasFactory()
  const cc = canvasFactory.create(viewport.width, viewport.height)
  await page.render({ canvasContext: cc.context, viewport, canvasFactory }).promise
  try {
    const imgData = cc.context.getImageData(0, 0, cc.canvas.width, cc.canvas.height)
    const d = imgData.data, contrast = 1.35, intercept = 128 * (1 - contrast)
    for (let i = 0; i < d.length; i += 4) {
      let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      g = g * contrast + intercept
      d[i] = d[i + 1] = d[i + 2] = g < 0 ? 0 : g > 255 ? 255 : g
    }
    cc.context.putImageData(imgData, 0, 0)
  } catch {}
  const png = cc.canvas.toDataURL('image/png')
  page.cleanup()
  return png
}

async function pdfToPngs(file) {
  const data = new Uint8Array(readFileSync(file))
  pdfjs.GlobalWorkerOptions.workerSrc = ''
  let doc
  try {
    doc = await pdfjs.getDocument({ data, isEvalSupported: false, useWorkerFetch: false, disableFontFace: true, canvasFactory: new NodeCanvasFactory() }).promise
  } catch { return [] }
  const pngs = []
  for (let i = 1; i <= doc.numPages; i++) { try { pngs.push(await renderPageToPng(doc, i)) } catch (e) { console.log(`  ⚠ pagina ${i} non renderizzabile: ${e.message}`); pngs.push(null) } }
  try { await doc.destroy() } catch {}
  return pngs
}

const pdfs = readdirSync(FOLDER).filter((f) => f.toLowerCase().endsWith('.pdf'))
const ocrState = await svc.probeOcr({})
console.log('probeOcr:', JSON.stringify(ocrState))
const docs = []
for (const f of pdfs) {
  const cacheFile = join(OCR_CACHE, `cond_via_della_liberta_55__${f.replace(/[^a-z0-9.]+/gi, '_')}.json`)
  let pages = null
  try { pages = JSON.parse(readFileSync(cacheFile, 'utf8')) } catch {}
  if (!Array.isArray(pages) || !pages.length) {
    console.log(`— ${f}: CACHE MANCANTE → render pdfjs + OCR …`)
    const pngs = await pdfToPngs(join(FOLDER, f))
    pages = []
    for (let i = 0; i < pngs.length; i++) {
      if (!pngs[i]) { pages.push(''); continue }
      pages.push(await svc.ocrPageText(pngs[i], settings))
      process.stdout.write(`p${i + 1}=${(pages[i] || '').length}ch `)
    }
    console.log('\n— salvataggio cache OCR …')
    mkdirSync(OCR_CACHE, { recursive: true })
    writeFileSync(cacheFile, JSON.stringify(pages))
  }
  const spatial = Object.keys(pages).map((k) => String(pages[k] || ''))
  const valid = spatial.filter((p) => p && p.trim())
  console.log(`— ${f}: ${valid.length}/${spatial.length} pagine con testo`)
  if (valid.length) docs.push({ name: f, pages: spatial })
}
if (!docs.length) { console.error('Nessun documento OCR per il caso C'); process.exit(1) }

const profili = JSON.parse(readFileSync(PROFILI, 'utf8'))
const fieldDefsFor = (name) => (profili.find((p) => p.name === name)?.fields || []).filter((f) => f.enabled !== false).map((f) => ({ id: f.id, label: f.label, description: f.description }))
const profileOf = (name) => profili.find((p) => p.name === name)

const out = { fileName: 'caso C pre-check', profileA: 'Rc Professionale V3', profileB: 'RC PROF MED V2', docs: docs.map((d) => d.name), prelimA: {}, prelimB: {} }
for (const [key, profName] of [['prelimA', 'Rc Professionale V3'], ['prelimB', 'RC PROF MED V2']]) {
  for (const mode of ['keywords', 'semantic', 'llm']) {
    try {
      const r = await precheckSvc.runPrecheck({ docs, fieldDefs: fieldDefsFor(profName), profile: profileOf(profName), profileName: profName, mode, settings })
      console.log(`[${key}] mode=${mode.padEnd(9)} → verdict=${r.verdict} score=${r.score ?? '—'} soglia=${r.threshold ?? '—'} (${r.reason})`)
      out[key][mode] = { verdict: r.verdict, mode: r.mode, score: r.score, threshold: r.threshold, reason: r.reason, matched: r.matched || [], missing: r.missing || [], detected: r.detected }
    } catch (e) {
      console.log(`[${key}] mode=${mode} ERRORE: ${e.message}`)
      out[key][mode] = { verdict: 'error', error: e.message }
    }
  }
}

writeFileSync('out/_ab_caso_C.json', JSON.stringify(out, null, 2))
console.log('Scritto out/_ab_caso_C.json')