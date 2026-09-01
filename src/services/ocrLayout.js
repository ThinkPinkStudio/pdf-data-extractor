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

// ═════════════════════════════════════════════════════════════════════════════
// ALIGNER COLONNARE DETERMINISTA (feature A): coppie ETICHETTA ⟶ VALORE.
//
// La griglia spaziale conserva le colonne ma come testo libero con spazi; i
// modelli piccoli leggono la struttura come rumore. Qui si ricostruiscono in
// modo DETERMINISTICO le coppie `ETICHETTA ⟶ VALORE` adiacenti, in modo
// TIPO-BLIND (nessuna ipotesi su polizze/fatture/regolazioni).
//
// Limiti (messi in chiaro): il rumore OCR può produrre etichette sbagliate e
// "stare sulla stessa colonna" è un'euristica. L'implementazione è quindi
// PRUDENTE: meglio poche coppie corrette che tante inventate — se la struttura
// di una pagina non parla, si ritorna []. La guardia di verità resta A VALLE
// (evidence check / merge). Il blocco deve andare nel prompt in AGGIUNTA, mai
// al posto del testo spaziale grezzo.
//
// Algoritmo (deterministico, spiegabile):
//   1. tokenizza ogni riga in parole con la colonna-x di inizio;
//   2. raggruppa in CELLE: run di token separati da ≤1 spazio (i collisionali
//      di buildSpatialPage), gap ≥2 apre una nuova cella;
//   3. SOTTO-RIGA (same row): un token che termina con ":" è un'etichetta; il
//      valore è la run di token successiva della STESSA riga, purché contenga
//      un token value-like (data/numero);
//   4. STESSA COLONNA: se una riga è fatta solo di etichette (nessun valore) e
//      la riga sotto ha valori, associa ogni valore al label della cella più
//      vicina in colonna-x (entro COL_TOL);
//   5. filtri: BOILERPLATE (pag., data, pagina, n., rif.), etichette vuote,
//      valori non value-like o troppo lunghi; cap di coppie per pagina.
//
// @param {string[]|string} lines  righe della griglia OPPURE il testo di una
//   pagina (viene diviso in righe)
// @returns {Array<{row:number,label:string,value:string,column:number}>}
export function detectLabelValuePairs(lines) {
  const raw = Array.isArray(lines) ? lines : String(lines || '').split('\n')
  const rows = raw.map((l, i) => ({ idx: i + 1, toks: tokenizeLine(l), cells: null }))
  for (const r of rows) r.cells = lineCells(r.toks)

  const pairs = []

  // ── Passaggio 1: SOTTO-RIGA (colon) ──────────────────────────────────────
  for (const r of rows) {
    let pendingLabel = []    // token di etichetta accumulati prima di un ':'
    let colLabel = null      // etichetta corrente dopo aver trovato un ':'
    let valToks = []         // token del valore corrente (stessa riga)
    for (let i = 0; i < r.toks.length; i++) {
      const t = r.toks[i]
      if (t.text.endsWith(':')) {
        // flush di una eventuale coppia precedente sulla stessa riga
        if (colLabel !== null) {
          const pair = buildPair(r.idx, colLabel, valToks, null)
          if (pair) pairs.push(pair)
        }
        // la label = token precedenti (non-valore) + questo, meno i ':' finali
        colLabel = [...pendingLabel, t.text.slice(0, -1)].join(' ')
        pendingLabel = []
        valToks = []
      } else if (colLabel !== null) {
        valToks.push(t.text)
      } else if (!isValueLike(t.text)) {
        pendingLabel.push(t.text)
      }
    }
    if (colLabel !== null) {
      const pair = buildPair(r.idx, colLabel, valToks, null)
      if (pair) pairs.push(pair)
    }
  }

  // ── Passaggio 2: STESSA COLONNA (griglia) ────────────────────────────────
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.toks.length) continue
    // riga "sola etichette": nessun token value-like e almeno una cella
    if (r.toks.some((t) => isValueLike(t.text))) continue
    const next = rows[i + 1]
    if (!next || !next.toks.length) continue
    // la riga sotto deve portare almeno un valore per associare le colonne
    if (!next.toks.some((t) => isValueLike(t.text))) continue

    for (const cell of r.cells) {
      if (badLabel(cell.text)) continue
      // trova nella riga sotto il token-valore più vicino in colonna (x)
      let best = null
      let bestD = Infinity
      for (const tk of next.toks) {
        if (!isValueLike(tk.text)) continue
        const d = Math.abs(cell.x - tk.x)
        if (d <= COL_TOL && d < bestD) { best = tk; bestD = d }
      }
      if (!best) continue
      const pair = { row: i + 1, label: cell.text.trim(), value: best.text, column: cell.x }
      if (acceptable(pair)) pairs.push(pair)
    }
  }

  return prunePairs(pairs)
}

// Build di una coppia dal passaggio colon: normalizza e valida.
function buildPair(row, label, valToks, column) {
  const lab = cleanLabel(label)
  const val = (valToks || []).join(' ').trim()
  const pair = { row, label: lab, value: val, column: column ?? null }
  return acceptable(pair) ? pair : null
}

// Rendibilità di una coppia grezza: label sensata, valore value-like e non
// troppo lungo/multitoken.
function acceptable(p) {
  if (!p || badLabel(p.label)) return false
  if (badValue(p.value)) return false
  return true
}

// Un token è un VALORE se ha la forma di data/numero/importo; le parole brevi
// alfanumeriche ("ACQUI", "TERME") NON lo sono (niente cifre).
function isValueLike(tok) {
  const t = String(tok || '').trim()
  if (!t) return false
  if (/^[+-]?\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(t)) return true
  if (/^[+-]?\d{4}$/.test(t)) return true
  if (/^[+-]?\d{1,3}(\.\d{3})*(,\d+)?[€¢]?$/.test(t)) return true
  if (/^[+-]?\d+(,\d+)?[ ]?[€%]?$/.test(t)) return true
  if (/\d/.test(t) && t.replace(/[0-9.,:€%/+ -]/g, '').length <= 1) return true
  return false
}

// Tokenizza una riga della griglia: token {text, x} con x = colonna di inizio.
function tokenizeLine(line) {
  const toks = []
  const s = String(line || '')
  let i = 0
  while (i < s.length) {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++
    if (i >= s.length) break
    const start = i
    while (i < s.length && s[i] !== ' ' && s[i] !== '\t') i++
    toks.push({ text: s.slice(start, i), x: start })
  }
  return toks
}

// Raggruppa i token di una riga in CELLE. Una cell vengono separatori di
// ≤1 spazio (collisionali della griglia); run di spazi ≥ CELL_GAP = confine.
function lineCells(toks) {
  const cells = []
  if (!toks.length) return cells
  let cur = { x: toks[0].x, tokens: [toks[0].text] }
  for (let i = 1; i < toks.length; i++) {
    const prevEnd = toks[i - 1].x + toks[i - 1].text.length
    const gap = toks[i].x - prevEnd
    if (gap >= CELL_GAP) {
      cells.push(toCell(cur))
      cur = { x: toks[i].x, tokens: [toks[i].text] }
    } else {
      cur.tokens.push(toks[i].text)
    }
  }
  cells.push(toCell(cur))
  return cells
}
function toCell(c) {
  const text = c.tokens.join(' ')
  return { x: c.x, text, end: c.x + text.length }
}

// Un'etichetta è sterile se boilerplate, troppo corta o puro numero.
function badLabel(label) {
  const l = String(label || '').trim()
  if (!l || l.length < 2) return true
  if (BOILERPLATE_LABELS.has(l.toLowerCase())) return true
  if (/^[\d.,:/-]+$/.test(l)) return true
  return false
}

// Un valore è scartabile se vuoto, troppo lungo/multitoken o senza cifre.
function badValue(value) {
  const t = String(value || '').trim()
  if (!t) return true
  if (t.length > MAX_VAL_CHARS) return true
  const nTok = t.split(/\s+/).length
  if (nTok > MAX_VAL_TOKENS) return true
  if (!/\d/.test(t)) return true
  return false
}

// Toglie i ':' finali (e le estetiche) da una label; trims.
function cleanLabel(l) {
  return String(l || '').replace(/:+$/g, '').trim()
}

const MAX_VAL_CHARS = 50
const MAX_VAL_TOKENS = 5
const MAX_PAIRS_PAGE = 12
const COL_TOL = 3
const CELL_GAP = 2

const BOILERPLATE_LABELS = new Set([
  'pag', 'p', 'pg', 'pagina', 'p.', 'n', 'n.', 'nr', 'nr.', 'n°', 'num', 'no.',
  'rif', 'rif.', 'tel', 'tel.', 'fax', 'email', 'e-mail', 'cc', 'c.c',
  'data', 'dat', 'di', 'e', 'il', 'la', 'le', 'l', 'del', 'della', 'delle',
  'dei', 'per', 'con', 'su', 'oggetto', 'sede', 'cod', 'cod.', 'numero',
])

// Rimozione duplicati + cappello (compatto).
function prunePairs(pairs) {
  const seen = new Set()
  const out = []
  for (const p of pairs) {
    const k = `${p.row}|${p.label}|${p.value}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(p)
    if (out.length >= MAX_PAIRS_PAGE) break
  }
  return out
}