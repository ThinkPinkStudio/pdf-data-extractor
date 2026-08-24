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

// ─── Coppie ETICHETTA → VALORE (allineamento colonnare determinista) ─────────
// Dalla griglia spaziale si ricostruiscono le coppie chiave/valore senza LLM:
// stessa riga (celle separate da 2+ spazi), stesso cella dopo ":", riga sotto
// alla stessa colonna. Il blocco va iniettato nel prompt PRIMA del testo grezzo
// della pagina, così il modello piccolo non deve "scoprire" la coppia dalla
// griglia. Type-blind: nessuna preferenza per tipo documento.

const PAIR_DATE_RE = /^\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}$/
const PAIR_AMOUNT_RE = /^(?:€\.?\s*)?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$|^\d+,\d{2}$/
const PAIR_VAT_RE = /^\d{11}$|^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/i

function splitCells(line) {
  const cells = []
  let pos = 0
  for (const part of String(line || '').split(/( {2,})/)) {
    if (/^ +$/.test(part)) { pos += part.length; continue }
    const t = part.trim()
    if (t) cells.push({ text: t, col: pos })
    pos += part.length
  }
  return cells
}

export function looksLikeValue(text) {
  const t = String(text || '').trim()
  if (!t) return false
  if (PAIR_DATE_RE.test(t) || PAIR_AMOUNT_RE.test(t) || PAIR_VAT_RE.test(t)) return true
  if (/^\d{1,3}(?:\.\d{3})+$/.test(t)) return true
  if (/^(?:€\.?\s*)?\d{4,}$/.test(t)) return true
  // Codici agenzia / n. polizza: cifre + separatori, corti
  if (/^[\d][\d./\s-]{2,24}$/.test(t) && /\d{3,}/.test(t) && t.length <= 24) return true
  return false
}

export function looksLikeLabel(text) {
  const t = String(text || '').replace(/[:.]+$/g, '').trim()
  if (t.length < 3 || t.length > 70) return false
  if (looksLikeValue(t)) return false
  if (!/[a-zA-Zàèéìòù]/i.test(t)) return false
  return true
}

function sameColumn(a, b, tol = 6) {
  return Math.abs((a?.col ?? 0) - (b?.col ?? 0)) <= tol
}

/**
 * Pagina spaziale → coppie { label, value, row, col }.
 * Determinista, JS puro. Input degeneri → [].
 */
export function extractLabelValuePairs(spatialPage) {
  const lines = String(spatialPage || '').split('\n')
  const rows = lines.map((line, i) => ({ i: i + 1, cells: splitCells(line) }))
  const pairs = []
  const seen = new Set()
  const add = (label, value, row, col) => {
    const lab = String(label || '').replace(/[:]+$/g, '').trim()
    const val = String(value || '').trim()
    if (!lab || !val) return
    const key = `${lab.toLowerCase()}|${val}|${row}`
    if (seen.has(key)) return
    seen.add(key)
    pairs.push({ label: lab, value: val, row, col: col ?? 0 })
  }

  for (const row of rows) {
    for (const c of row.cells) {
      const colon = c.text.match(/^(.{3,50}?)\s*:\s+(.{1,60})$/)
      if (colon && looksLikeLabel(colon[1]) && (looksLikeValue(colon[2]) || colon[2].length <= 48)) {
        add(colon[1], colon[2], row.i, c.col)
      }
    }
    for (let i = 0; i < row.cells.length - 1; i++) {
      const a = row.cells[i], b = row.cells[i + 1]
      if (looksLikeLabel(a.text) && looksLikeValue(b.text)) add(a.text, b.text, row.i, a.col)
    }
  }

  for (let r = 0; r < rows.length - 1; r++) {
    for (const a of rows[r].cells) {
      if (!looksLikeLabel(a.text)) continue
      const below = rows[r + 1].cells.filter((b) => looksLikeValue(b.text) && sameColumn(a, b, 6))
      if (below.length === 1) add(a.text, below[0].text, rows[r].i, a.col)
    }
  }
  return pairs
}

/** true se la ristrutturazione è abbastanza densa da valere i token extra. */
export function pairsQuality(pairs, page) {
  const n = Array.isArray(pairs) ? pairs.length : 0
  const lines = String(page || '').split('\n').filter((l) => l.trim()).length
  return { count: n, good: n >= 3 || (n >= 1 && lines > 0 && n >= lines / 20) }
}

export function formatPairsBlock(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return ''
  return 'COPPIE ETICHETTA → VALORE (allineamento colonnare della pagina):\n'
    + pairs.slice(0, 80).map((p) => `RIGA ${p.row} — "${p.label}" → ${p.value}`).join('\n')
}

// Etichette strutturali type-blind: densità di DATI in una pagina, non tipo file.
const DENSITY_LABELS = [
  'scadenza', 'decorrenza', 'massimale', 'premio', 'contraente', 'agenzia',
  'polizza', 'imposta', 'tasso', 'preventivo', 'franchigia', 'partita',
  'fiscale', 'indirizzo', 'compagnia', 'quietanza', 'appendice', 'effetto',
]

/**
 * Densità di etichette strutturali in una pagina (0..1). Type-blind:
 * misura quanto la pagina PARLA di dati di polizza, indipendentemente dal
 * nome file. Usata per i batch focalizzati (G).
 */
export function labelDensity(page) {
  const n = String(page || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  if (usefulLength(n) < 40) return 0
  let hits = 0
  for (const l of DENSITY_LABELS) if (n.includes(l)) hits++
  return hits / DENSITY_LABELS.length
}
