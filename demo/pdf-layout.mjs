// Mini motore di impaginazione dei PDF DEMO (pdf-lib di web/node_modules), comune
// ai generatori italiano (generate-pdfs.mjs) e inglese (generate-pdfs-en.mjs).
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '..', 'web', 'package.json'))
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')

export const A4 = [595.28, 841.89]
export const M = 48 // margine

export async function makeDoc(meta) {
  const pdf = await PDFDocument.create()
  pdf.setTitle(meta.title || '')
  pdf.setAuthor(meta.author || '')
  pdf.setCreationDate(new Date('2026-09-30T10:00:00Z'))
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ital = await pdf.embedFont(StandardFonts.HelveticaOblique)
  const ctx = { pdf, font, bold, ital, pages: [], page: null, y: 0, color: meta.color || [0.2, 0.2, 0.2] }
  ctx.newPage = () => { ctx.page = pdf.addPage(A4); ctx.pages.push(ctx.page); ctx.y = A4[1] - M; return ctx.page }
  ctx.newPage()
  return ctx
}

const C = (arr) => rgb(arr[0], arr[1], arr[2])
export const GREY = [0.42, 0.42, 0.45]
export const DARK = [0.1, 0.1, 0.12]
export const LINE = [0.82, 0.83, 0.86]

export function text(ctx, s, x, y, { size = 10, font = ctx.font, color = DARK, align = 'left', width = 0 } = {}) {
  let dx = x
  if (align !== 'left') {
    const w = font.widthOfTextAtSize(s, size)
    dx = align === 'right' ? x + width - w : x + (width - w) / 2
  }
  ctx.page.drawText(s, { x: dx, y, size, font, color: C(color) })
}

export function wrap(font, s, size, maxW) {
  const out = []
  for (const para of String(s).split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word
      if (font.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = word } else line = t
    }
    out.push(line)
  }
  return out
}

export function ensure(ctx, h) { if (ctx.y - h < M + 30) ctx.newPage() }

export function para(ctx, s, { size = 10, font = ctx.font, color = DARK, x = M, width = A4[0] - 2 * M, gap = 4, lh = 1.38 } = {}) {
  const lines = wrap(font, s, size, width)
  for (const l of lines) { ensure(ctx, size * lh); text(ctx, l, x, ctx.y - size, { size, font, color }); ctx.y -= size * lh }
  ctx.y -= gap
}

export function hr(ctx, { color = LINE, thick = 0.8, x1 = M, x2 = A4[0] - M } = {}) {
  ctx.page.drawLine({ start: { x: x1, y: ctx.y }, end: { x: x2, y: ctx.y }, thickness: thick, color: C(color) })
}

export function rect(ctx, x, y, w, h, { fill, border, thick = 0.8 } = {}) {
  ctx.page.drawRectangle({ x, y, width: w, height: h, color: fill ? C(fill) : undefined, borderColor: border ? C(border) : undefined, borderWidth: border ? thick : 0 })
}

export function tint(c, k) { return c.map((x) => x + (1 - x) * k) }

// Carta intestata: banda colorata, nome, indirizzo, identificativo fiscale; titolo
// documento a destra. `tax` è la dicitura stampata (es. "P.IVA …", "VAT …").
export function letterhead(ctx, co, title, subtitle, { tax = `P.IVA ${co.piva}` } = {}) {
  const c = co.color || ctx.color
  rect(ctx, 0, A4[1] - 8, A4[0], 8, { fill: c })
  // marchio: quadrato con iniziali
  const initials = co.name.split(' ').filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join('')
  rect(ctx, M, A4[1] - 84, 40, 40, { fill: c })
  text(ctx, initials, M, A4[1] - 70, { size: 16, font: ctx.bold, color: [1, 1, 1], align: 'center', width: 40 })
  text(ctx, co.name, M + 52, A4[1] - 56, { size: 14, font: ctx.bold, color: c })
  if (co.tag) text(ctx, co.tag, M + 52, A4[1] - 70, { size: 8.5, font: ctx.ital, color: GREY })
  text(ctx, `${co.addr.join(' · ')} · ${tax}`, M + 52, A4[1] - 82, { size: 8, color: GREY })
  const right = A4[0] - M
  text(ctx, title, right - 220, A4[1] - 56, { size: 16, font: ctx.bold, color: DARK, align: 'right', width: 220 })
  if (subtitle) text(ctx, subtitle, right - 220, A4[1] - 72, { size: 9.5, color: GREY, align: 'right', width: 220 })
  ctx.y = A4[1] - 108
}

// Box con titolo e righe chiave/valore.
export function box(ctx, x, w, title, lines, { h } = {}) {
  const lh = 13
  const height = h || 22 + lines.length * lh + 6
  rect(ctx, x, ctx.y - height, w, height, { border: LINE, fill: [0.985, 0.985, 0.99] })
  text(ctx, title.toUpperCase(), x + 10, ctx.y - 14, { size: 7.5, font: ctx.bold, color: GREY })
  lines.forEach((l, i) => {
    const isFirst = i === 0
    text(ctx, l, x + 10, ctx.y - 30 - i * lh, { size: isFirst ? 10 : 9, font: isFirst ? ctx.bold : ctx.font })
  })
  return height
}

export function metaRow(ctx, pairs) {
  const w = (A4[0] - 2 * M) / pairs.length
  rect(ctx, M, ctx.y - 34, A4[0] - 2 * M, 34, { fill: tint(ctx.color, 0.9) })
  pairs.forEach(([k, val], i) => {
    text(ctx, k.toUpperCase(), M + 10 + i * w, ctx.y - 13, { size: 7, font: ctx.bold, color: GREY })
    let size = 9.5
    while (size > 6.5 && ctx.bold.widthOfTextAtSize(val, size) > w - 16) size -= 0.5
    text(ctx, val, M + 10 + i * w, ctx.y - 27, { size, font: ctx.bold })
  })
  ctx.y -= 46
}

// Tabella: cols = [{ t, w, a }] (w frazione della larghezza utile).
export function table(ctx, cols, rows, { size = 9, head = true } = {}) {
  const W = A4[0] - 2 * M
  const xs = []; let acc = M
  for (const c of cols) { xs.push(acc); acc += c.w * W }
  const pad = 6
  if (head) {
    rect(ctx, M, ctx.y - 20, W, 20, { fill: ctx.color })
    cols.forEach((c, i) => text(ctx, c.t, xs[i] + pad, ctx.y - 13.5, { size: 7.5, font: ctx.bold, color: [1, 1, 1], align: c.a || 'left', width: c.w * W - 2 * pad }))
    ctx.y -= 20
  }
  rows.forEach((r, ri) => {
    const wrapped = r.map((cell, i) => wrap(ctx.font, String(cell), size, cols[i].w * W - 2 * pad))
    const nl = Math.max(...wrapped.map((x) => x.length))
    const h = nl * (size + 3) + 9
    ensure(ctx, h)
    if (ri % 2 === 1) rect(ctx, M, ctx.y - h, W, h, { fill: [0.975, 0.975, 0.98] })
    wrapped.forEach((lines, i) => lines.forEach((l, li) => text(ctx, l, xs[i] + pad, ctx.y - 6 - size - li * (size + 3), { size, align: cols[i].a || 'left', width: cols[i].w * W - 2 * pad })))
    ctx.y -= h
    hr(ctx, { color: LINE, thick: 0.5 })
  })
  ctx.y -= 10
}

export function totals(ctx, rows) {
  const w = 220; const x = A4[0] - M - w
  rows.forEach(([k, val, strong], i) => {
    const h = strong ? 26 : 18
    if (strong) rect(ctx, x, ctx.y - h, w, h, { fill: ctx.color })
    const col = strong ? [1, 1, 1] : DARK
    text(ctx, k, x + 10, ctx.y - (strong ? 17 : 12.5), { size: strong ? 10.5 : 9, font: strong ? ctx.bold : ctx.font, color: col })
    text(ctx, val, x + 10, ctx.y - (strong ? 17 : 12.5), { size: strong ? 11 : 9, font: ctx.bold, color: col, align: 'right', width: w - 20 })
    ctx.y -= h
    if (!strong && i < rows.length - 1) hr(ctx, { x1: x, x2: x + w, thick: 0.4 })
  })
  ctx.y -= 12
}

export function heading(ctx, s, { size = 11 } = {}) {
  ensure(ctx, size + 14)
  ctx.y -= 6
  text(ctx, s, M, ctx.y - size, { size, font: ctx.bold, color: ctx.color })
  ctx.y -= size + 8
}

export function footers(ctx, left, pageLabel = (i, n) => `Pagina ${i} di ${n}`) {
  ctx.pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 40 }, end: { x: A4[0] - M, y: 40 }, thickness: 0.5, color: C(LINE) })
    p.drawText(left, { x: M, y: 28, size: 7, font: ctx.font, color: C(GREY) })
    const s = pageLabel(i + 1, ctx.pages.length)
    p.drawText(s, { x: A4[0] - M - ctx.font.widthOfTextAtSize(s, 7), y: 28, size: 7, font: ctx.font, color: C(GREY) })
  })
}

export function signatures(ctx, a, b) {
  ensure(ctx, 70)
  ctx.y -= 26
  const w = (A4[0] - 2 * M - 40) / 2
  ;[[a, M], [b, M + w + 40]].forEach(([label, x]) => {
    ctx.page.drawLine({ start: { x, y: ctx.y - 24 }, end: { x: x + w, y: ctx.y - 24 }, thickness: 0.6, color: C(GREY) })
    text(ctx, label, x, ctx.y - 36, { size: 8.5, color: GREY })
  })
  ctx.y -= 50
}

export async function save(ctx, dir, name) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), await ctx.pdf.save())
  return name
}

// Albero di cartelle per la pagina "Cartella bulk": { 'cartella/sotto': [file…] }
// copiati dai PDF generati in pdfDir sotto bulkDir/root.
export function writeBulkTree(bulkDir, root, tree, pdfDir) {
  rmSync(bulkDir, { recursive: true, force: true })
  for (const [dir, files] of Object.entries(tree)) {
    mkdirSync(join(bulkDir, root, dir), { recursive: true })
    for (const f of files) copyFileSync(join(pdfDir, f), join(bulkDir, root, dir, f))
  }
}
