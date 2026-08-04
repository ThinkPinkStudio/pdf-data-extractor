/**
 * Ricostruzione SPAZIALE del testo OCR: da parole con coordinate (i `blocks` di
 * tesseract.js) a una griglia monospace che preserva l'allineamento a colonne
 * della pagina originale.
 *
 * Perché: Tesseract "srotola" i layout tabellari in ordine di lettura — con
 * frontespizi e quietanze a riquadri l'etichetta finisce righe lontano dal suo
 * valore e il modello sbaglia campo. Nella griglia le colonne restano
 * incolonnate ("SCAD. RATA   RATA SUCC." sopra, "31/12/2024   31/12/2025"
 * sotto, alla stessa colonna): il modello vede la tabella com'è sulla carta.
 *
 * Modulo PURO (niente Electron/tesseract/pdfjs): testabile in Node puro con
 * blocks sintetici — vedi test/ocrLayout.test.mjs.
 */

// Larghezza massima della griglia: oltre non c'è layout reale, solo rumore di
// coordinate (parole ruotate, bbox impazzite). Il padding si tronca qui.
const MAX_COLS = 600

function median(nums) {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Estrae tutte le parole {text, x0, x1, cy, h} dai blocks tesseract.js
// (blocks → paragraphs → lines → words). Struttura difensiva: ogni livello
// può mancare o essere null.
function collectWords(blocks) {
  const words = []
  for (const b of Array.isArray(blocks) ? blocks : []) {
    for (const p of b?.paragraphs || []) {
      for (const l of p?.lines || []) {
        const rowH = l?.rowAttributes?.rowHeight || null
        for (const w of l?.words || []) {
          const text = String(w?.text || '').trim()
          const bb = w?.bbox
          if (!text || !bb || !(bb.x1 > bb.x0) || !(bb.y1 > bb.y0)) continue
          words.push({
            text,
            x0: bb.x0,
            x1: bb.x1,
            cy: (bb.y0 + bb.y1) / 2,
            h: rowH || (bb.y1 - bb.y0),
          })
        }
      }
    }
  }
  return words
}

/**
 * Pagina → griglia monospace con colonne preservate.
 *
 * - larghezza-carattere = MEDIANA di bbox/length sulle parole (le scale di
 *   rendering variano tra server 4400px, browser e desktop 2200px: mai
 *   costanti dpi);
 * - righe VISIVE per centro-y: due riquadri affiancati producono "line"
 *   Tesseract separate alla stessa altezza — qui vengono fuse sulla stessa
 *   riga di testo, che è tutto il punto;
 * - colonna = round(x0/charW), padding di spazi; parole che collidono →
 *   separatore di un solo spazio (mai sovrascrivere).
 *
 * @param {Array|null} blocks  data.blocks di tesseract.js (o null)
 * @returns {string} griglia, '' se non ci sono parole utilizzabili
 */
export function buildSpatialPage(blocks) {
  const words = collectWords(blocks)
  if (!words.length) return ''

  const charW = median(words.map((w) => (w.x1 - w.x0) / w.text.length).filter((v) => v > 0))
  if (!(charW > 0)) return words.map((w) => w.text).join(' ')
  const rowTol = Math.max(1, median(words.map((w) => w.h)) / 2)

  // Righe visive: parole ordinate per centro-y, nuova riga quando il centro
  // si stacca oltre la tolleranza dalla MEDIA della riga corrente (più stabile
  // del confronto con la singola parola precedente su scansioni storte).
  const sorted = [...words].sort((a, b) => a.cy - b.cy || a.x0 - b.x0)
  const rows = []
  let row = null
  let rowCySum = 0
  for (const w of sorted) {
    if (row && Math.abs(w.cy - rowCySum / row.length) <= rowTol) {
      row.push(w)
      rowCySum += w.cy
    } else {
      row = [w]
      rowCySum = w.cy
      rows.push(row)
    }
  }

  const lines = rows.map((r) => {
    r.sort((a, b) => a.x0 - b.x0)
    let line = ''
    for (const w of r) {
      const col = Math.min(MAX_COLS, Math.round(w.x0 / charW))
      line += line.length < col ? ' '.repeat(col - line.length) : (line ? ' ' : '')
      line += w.text
    }
    return line
  })
  return lines.join('\n')
}

/**
 * Griglia spaziale → testo PIATTO equivalente al vecchio output riga-per-riga:
 * per ogni riga collassa le run di spazi a uno e toglie l'indentazione.
 * È l'UNICA derivazione piatto←spaziale: regex, embeddings, chunk RAG e
 * matching normalizzato lavorano su questo, i prompt sul testo spaziale.
 */
export function collapseSpatial(page) {
  return String(page || '')
    .split('\n')
    .map((l) => l.replace(/\s{2,}/g, ' ').trim())
    .join('\n')
}

/**
 * Lunghezza "UTILE" di un testo: i caratteri dopo il collasso delle run di
 * spazi. Le run costano quasi zero token (il BPE le comprime) ma 1:1 nei
 * budget in caratteri: misurare il budget qui evita batch rimpiccioliti dal
 * padding — cioè etichetta e valore separati in batch diversi.
 */
export function usefulLength(s) {
  return String(s || '').replace(/ {2,}/g, ' ').length
}
