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
import { joinSplitNumbers } from './splitNumbers.js'

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
 * Valori dei CAMPI COMPILABILI (AcroForm) come voci di testo nella loro
 * posizione. Stanno nelle annotazioni «widget», non nel contenuto della
 * pagina: getTextContent non li vede e il modello riceveva «CONTRAENTE:» col
 * vuoto accanto (Mastrantonio: numero di polizza, contraente e indirizzo SOLO
 * nei campi), «ha ricevuto l'importo di EURO ……» senza l'importo (quietanze
 * GUFFANTI), il questionario SPALLINO senza fatturato né risposte. Caselle e
 * pulsanti di scelta come [X] / [ ], come l'OCR visivo. Campi nascosti e
 * pulsanti d'azione esclusi. Nessun valore interpretato: il testo del campo.
 * @param {any[]} annotations  page.getAnnotations()
 */
export function formFieldItems(annotations) {
  const items = []
  for (const a of annotations || []) {
    if (!a || a.subtype !== 'Widget' || !Array.isArray(a.rect) || a.rect.length < 4) continue
    if ((a.annotationFlags || 0) & (0x02 | 0x20)) continue // HIDDEN, NOVIEW
    let str = ''
    if (a.checkBox || a.radioButton) {
      const on = a.checkBox
        ? a.fieldValue != null && a.fieldValue !== 'Off' && a.fieldValue !== false && a.fieldValue !== ''
        : a.fieldValue != null && a.fieldValue === a.buttonValue
      str = on ? '[X]' : '[ ]'
    } else if (a.fieldType === 'Tx' || a.fieldType === 'Ch') {
      const v = Array.isArray(a.fieldValue) ? a.fieldValue.join(', ') : a.fieldValue
      str = String(v ?? '').replace(/\s+/g, ' ').trim()
    }
    if (!str) continue
    const [x1, y1, x2, y2] = a.rect
    const h = Math.abs(y2 - y1) || 10
    const fs = Math.max(6, Math.min(11, h * 0.7))
    items.push({ str, transform: [fs, 0, 0, fs, Math.min(x1, x2) + 1, Math.min(y1, y2) + Math.max(1, (h - fs) / 2)], width: str.length * fs * 0.5 })
  }
  return items
}

// joinSplitNumbers vive in splitNumbers.js (modulo foglia: lo usa anche il
// controllo dell'evidenza in polizzaValidation.js, che non può importare questo
// modulo senza chiudere un ciclo). Riesportato qui: gli import esistenti restano.
export { joinSplitNumbers, joinSplitNumbersInPages } from './splitNumbers.js'

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
        let items = content.items || []
        // Campi compilabili solo su pagine che hanno già testo: una scansione
        // con un campo firma o data resterebbe «digitale» e salterebbe l'OCR
        // (il rendering per l'OCR disegna comunque i campi).
        if (items.some((it) => it && typeof it.str === 'string' && it.str.trim())) {
          try {
            const extra = formFieldItems(await page.getAnnotations({ intent: 'display' }))
            if (extra.length) items = [...items, ...extra]
          } catch { /* annotazioni illeggibili: solo il testo della pagina */ }
        }
        const blocks = textContentToBlocks({ items }, { viewport: page.getViewport({ scale: 1 }) })
        spatial = blocks.length ? buildSpatialPage(blocks).trim().split('\n').map(joinSplitNumbers).join('\n') : ''
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

/**
 * Pagine lette dalla CACHE OCR con le pagine DIGITALI prese dal text layer di
 * ADESSO. Per un PDF con testo la cache contiene la griglia di quando il file
 * fu letto la prima volta: una correzione del percorso testo (campi
 * compilabili, numeri spezzati…) non arrivava mai ai fascicoli già visti. Le
 * pagine senza text layer (scansioni) restano quelle dell'OCR in cache: niente
 * OCR rifatto. Conteggi diversi = PDF diverso da quello in cache: invariato.
 * @param {string[]} cached
 * @param {string[]|null} layer  spatialPagesFromPdf dello stesso PDF
 */
export function withFreshTextLayer(cached, layer) {
  if (!Array.isArray(cached) || !Array.isArray(layer) || cached.length !== layer.length) return cached
  return cached.map((t, i) => (layer[i] && layer[i].trim() ? layer[i] : t))
}

/** true se almeno una pagina ha testo. */
export function hasTextLayer(pages) {
  return (pages || []).some((p) => p && p.trim())
}
