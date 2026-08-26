#!/usr/bin/env node
// Diagnostica pagine PDF caso C (dimensioni) — nessuna OCR.
import { readFileSync, writeFileSync } from 'fs'
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js'

const FOLDER = '/tmp/prep_casi/zip1/campione polizze x test 07 08 2026 1/Cond Via della libertà 55'
const { createCanvas } = await import('./web/node_modules/@napi-rs/canvas/index.js')

pdfjs.GlobalWorkerOptions.workerSrc = ''
class F {
  create(w, h) { const canvas = createCanvas(Math.max(1, w), Math.max(1, h)); return { canvas, context: canvas.getContext('2d') } }
  reset(c, w, h) { c.canvas.width = Math.max(1, w); c.canvas.height = Math.max(1, h) }
  destroy(c) { c.canvas.width = 0; c.canvas.height = 0; c.canvas = null; c.context = null }
}

const files = ['cond della libertà 55 - Gloable Fabbricati - polizza .pdf', 'cond della libertà 55 - Gloable Fabbricati - q.za 25 26.pdf']
const out = []
for (const f of files) {
  const data = new Uint8Array(readFileSync(`${FOLDER}/${f}`))
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useWorkerFetch: false, disableFontFace: true }).promise
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const base = page.getViewport({ scale: 1 })
    const scale = Math.min(6, 4400 / Math.max(base.width, base.height))
    const vp = page.getViewport({ scale })
    out.push(`${f.slice(0, 20)} p${i}: base ${base.width.toFixed(0)}x${base.height.toFixed(0)} · render scale ${scale.toFixed(2)} → ${Math.round(vp.width)}x${Math.round(vp.height)}px`)
    page.cleanup()
  }
  await doc.destroy()
}
writeFileSync('out/_diagnostica_C.txt', out.join('\n'))
console.log(out.join('\n'))