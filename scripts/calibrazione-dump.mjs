#!/usr/bin/env node
/**
 * Stampa il testo (piatto + spaziale) dei PDF di una cartella, per leggere le
 * polizze e costruire i golden. Non lancia Ollama.
 *
 * Uso:
 *   node scripts/calibrazione-dump.mjs --dir <cartella> [--file "x.pdf"] [--maxpages N]
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i + 1 >= process.argv.length) return fallback
  return process.argv[i + 1]
}
const dir = arg('dir')
const fileArg = arg('file')
const maxPages = arg('maxpages') ? Number(arg('maxpages')) : 9999
if (!dir) { console.error('Uso: node scripts/calibrazione-dump.mjs --dir <cartella> [--file "x.pdf"]'); process.exit(2) }

const { buildSpatialPage, collapseSpatial } = await import(join(root, 'src/services/ocrLayout.js'))

async function extractPages(filePath) {
  const pdfjsMod = await import('pdfjs-dist/legacy/build/pdf.js')
  const pdfjs = pdfjsMod.default || pdfjsMod
  if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = ''
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(filePath)),
    useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true, disableFontFace: true,
  }).promise
  const pageTexts = []
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    if (pageNum > maxPages) break
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent({ includeMarkedContent: false })
    const words = []
    for (const item of content.items) {
      if (!('str' in item)) continue
      const str = item.str
      if (!str) continue
      const x0 = item.transform[4], y0 = item.transform[5]
      const fs = Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 10
      const totW = (item.width !== undefined && item.width > 0) ? item.width : str.length * fs * 0.6
      const parts = str.match(/\S+/g) || []
      let pos = 0
      const cw = totW / str.length
      for (const p of parts) {
        const idx = str.indexOf(p, pos)
        pos = idx + p.length
        const wpx = cw * (p.length + 1.5)
        words.push({ text: p, x0: x0 + idx, x1: x0 + idx + wpx, y0, y1: y0 + fs, cy: y0 + fs / 2, h: fs, bbox: { x0: x0 + idx, x1: x0 + idx + wpx, y0, y1: y0 + fs } })
      }
    }
    if (!words.length) continue
    words.sort((a, b) => a.cy - b.cy || a.x0 - b.x0)
    const rows = []
    let cur = null
    const rowTol = Math.max(1, Math.abs(words[0].h) / 2 || 5)
    for (const w of words) {
      if (cur && Math.abs(w.cy - cur.cy) <= rowTol) { cur.words.push(w); cur.cy = (cur.cy + w.cy) / 2 }
      else { cur = { cy: w.cy, h: w.h, words: [w] }; rows.push(cur) }
    }
    const lines = rows.map((r) => {
      r.words.sort((a, b) => a.x0 - b.x0)
      return { words: r.words.map((w) => ({ text: w.text, bbox: { x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1 } })), rowAttributes: { rowHeight: r.h } }
    })
    const blocks = [{ paragraphs: [{ lines }] }]
    const spatial = buildSpatialPage(blocks)
    if (spatial.trim()) pageTexts.push(spatial.trim())
  }
  return pageTexts
}

let files
if (fileArg) files = [fileArg]
else files = readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).sort()

for (const f of files) {
  const p = join(dir, f)
  if (!existsSync(p)) { console.warn(`!! manca ${f}`); continue }
  console.log(`\n\n═══════════════════════════════════════════════`)
  console.log(`FILE: ${f}`)
  console.log(`═══════════════════════════════════════════════`)
  const pages = await extractPages(p)
  for (let i = 0; i < pages.length; i++) {
    console.log(`\n───── PAGINA ${i + 1} (piatta) ─────`)
    console.log(collapseSpatial(pages[i]))
    console.log(`\n───── PAGINA ${i + 1} (SPAZIALE) ─────`)
    console.log(pages[i])
  }
}
