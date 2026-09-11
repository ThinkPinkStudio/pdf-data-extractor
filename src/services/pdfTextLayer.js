/**
 * Testo SPAZIALE di un PDF dal suo text layer (pdfjs → griglia a colonne).
 *
 * UN SOLO percorso per tutti: il worker web, gli script di calibrazione e i
 * test usano QUESTA funzione. Prima la stessa logica era copiata in quattro
 * posti (worker, calibrazione-run, test-guffanti, test-docling) e bastava una
 * riga diversa perché "in test funziona, in produzione no".
 *
 * Ogni pagina è ricostruita come griglia monospace con `buildSpatialPage`
 * (stessa trasformazione dell'OCR Tesseract): le colonne restano allineate per
 * coordinate reali, così etichetta e valore adiacente restano sulla stessa
 * riga nel prompt.
 *
 * Le pagine SENZA text layer (scansioni) restano come stringa VUOTA nella
 * posizione giusta: chi chiama sa quali pagine mancano (e può mandarle
 * all'OCR) e la numerazione delle pagine nelle fonti non slitta.
 */
import { buildSpatialPage } from './ocrLayout.js'

/**
 * Converte il `textContent` di pdfjs in blocchi/righe/parole con bbox, il
 * formato che `buildSpatialPage` si aspetta (lo stesso dei blocks tesseract).
 */
export function textContentToBlocks(content, opts = {}) {
  // ORIENTAMENTO. pdf.js dà `transform[4..5]` nello spazio PDF: origine in
  // BASSO a sinistra, y che CRESCE verso l'alto. buildSpatialPage (come
  // tesseract) vuole y che cresce verso il BASSO. Senza conversione la pagina
  // usciva CAPOVOLTA: piè di pagina per primo, "POLIZZA N." per ultimo, ogni
  // riga di VALORI prima della riga delle sue ETICHETTE (decorrenza letta
  // come scadenza, massimale per anno = massimale per sinistro, ecc.).
  // `viewport` (page.getViewport({scale:1})) converte anche le pagine ruotate;
  // in mancanza, `pageHeight` ribalta l'asse; senza nulla si ribalta il segno
  // (l'ordine relativo delle righe resta corretto).
  const vp = opts.viewport || null
  const pageHeight = Number.isFinite(opts.pageHeight) ? opts.pageHeight : null
  const toTop = (x, y) => {
    if (vp && typeof vp.convertToViewportPoint === 'function') { const [vx, vy] = vp.convertToViewportPoint(x, y); return [vx, vy] }
    if (pageHeight != null) return [x, pageHeight - y]
    return [x, -y]
  }
  const words = []
  for (const item of content?.items || []) {
    if (!item || typeof item.str !== 'string' || !item.str) continue
    const tr = item.transform || [1, 0, 0, 1, 0, 0]
    const fs = Math.abs(tr[3]) || Math.abs(tr[0]) || 10
    // baseline in coordinate "dall'alto": il box del glifo sta SOPRA la baseline
    const [x0, yBase] = toTop(tr[4], tr[5])
    const y0 = yBase - fs
    const totW = item.width && item.width > 0 ? item.width : item.str.length * fs * 0.6
    const parts = item.str.match(/\S+/g) || []
    let pos = 0
    const cw = totW / item.str.length
    for (const w of parts) {
      const idx = item.str.indexOf(w, pos)
      pos = idx + w.length
      const wpx = cw * (w.length + 1.5)
      const bbox = { x0: x0 + idx, x1: x0 + idx + wpx, y0, y1: y0 + fs }
      words.push({ text: w, bbox, cy: y0 + fs / 2, h: fs, x0: bbox.x0 })
    }
  }
  if (!words.length) return []
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
    return { words: r.words.map((w) => ({ text: w.text, bbox: w.bbox })), rowAttributes: { rowHeight: r.h } }
  })
  return [{ paragraphs: [{ lines }] }]
}

/**
 * Pagine spaziali di un PDF (una stringa per pagina, '' se la pagina non ha
 * text layer). Lancia solo se il PDF non si apre affatto.
 *
 * @param {Buffer|Uint8Array} pdfBuf
 * @param {{ password?: string }} [opts]
 * @returns {Promise<string[]>}
 */
export async function spatialPagesFromPdf(pdfBuf, opts = {}) {
  const pdfjsMod = await import('pdfjs-dist/legacy/build/pdf.js')
  const pdfjs = pdfjsMod.default || pdfjsMod
  if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = ''
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdfBuf),
    useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true, disableFontFace: true,
    ...(opts.password ? { password: opts.password } : {}),
  }).promise
  try {
    const pages = []
    for (let p = 1; p <= doc.numPages; p++) {
      let spatial = ''
      try {
        const page = await doc.getPage(p)
        const content = await page.getTextContent({ includeMarkedContent: false })
        const blocks = textContentToBlocks(content, { viewport: page.getViewport({ scale: 1 }) })
        spatial = blocks.length ? buildSpatialPage(blocks).trim() : ''
      } catch {
        spatial = '' // pagina illeggibile: resta vuota, la numerazione non slitta
      }
      pages.push(spatial)
    }
    return pages
  } finally {
    try { await doc.destroy() } catch { /* già distrutto */ }
  }
}

/** true se almeno una pagina ha testo. */
export function hasTextLayer(pages) {
  return (pages || []).some((p) => p && p.trim())
}
