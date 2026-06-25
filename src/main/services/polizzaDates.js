/**
 * Logica PURA di data/recenza per l'estrazione polizze RC.
 *
 * Questo modulo NON importa Electron, pdfjs o provider LLM: contiene solo
 * funzioni deterministiche su stringhe. Per questo e' importabile e testabile
 * in Node puro (vedi test/polizzaDates.test.mjs).
 *
 * Concetto chiave — "documento piu' recente":
 *   per decidere quale documento riporta il dato piu' aggiornato si usa il
 *   PERIODO DI COPERTURA a cui i dati si riferiscono (scadenza / periodo /
 *   decorrenza), NON la data in cui il documento e' stato emesso o stampato.
 *
 *   Esempio del bug originale: una "regolazione premio 2024" viene EMESSA nel
 *   2025 ma descrive il 2024. Usando la data di emissione (2025) scavalcava la
 *   quietanza/polizza corrente, sovrascrivendo massimali e scadenze con valori
 *   del periodo precedente. Usando il periodo di copertura (2024) resta
 *   correttamente "piu' vecchia" della quietanza 2025.
 */

// ─── Parsing date da riga di contesto ────────────────────────────────────────

/**
 * Cerca la PRIMA data in una riga di testo corrispondente al pattern.
 * Gestisce sia "GG/MM/AAAA" sia artefatti OCR tipo "31 112 I 2021" → "31/12/2021".
 */
export function parseDateFromContextLine(fullText, linePattern) {
  const lineMatch = fullText.match(linePattern)
  if (!lineMatch) return null
  const line = lineMatch[0]

  // Formato standard
  const std = line.match(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/)
  if (std) {
    return `${std[1].padStart(2, '0')}/${std[2].padStart(2, '0')}/${std[3]}`
  }

  // Formato con artefatti OCR: cerca l'anno (20XX) e lavora all'indietro
  const yearMatch = line.match(/(20\d{2})/)
  if (!yearMatch) return null
  const year = yearMatch[1]
  const beforeYear = line.slice(0, line.indexOf(year))

  // Estrai numeri prima dell'anno; se un numero > 31, prendi le ultime 2 cifre
  const nums = [...beforeYear.matchAll(/\d+/g)].map(m => {
    const n = parseInt(m[0])
    if (n > 31 && m[0].length > 2) return parseInt(m[0].slice(-2))
    return n
  }).filter(n => n >= 1 && n <= 31)

  // Cerca mese (≤ 12) da destra, poi il giorno
  let month = null, day = null
  for (let i = nums.length - 1; i >= 0; i--) {
    if (month === null && nums[i] >= 1 && nums[i] <= 12) {
      month = nums[i]
    } else if (month !== null) {
      day = nums[i]
      break
    }
  }

  if (day && month) {
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
  }
  return null
}

/**
 * Come parseDateFromContextLine ma restituisce l'ULTIMA data standard
 * (GG/MM/AAAA) presente nella riga. Utile per i periodi di regolazione
 * "PER IL PERIODO 01/01/2024 - 31/12/2024" dove ci interessa la data di FINE.
 */
export function parseLastDateFromContextLine(fullText, linePattern) {
  const lineMatch = fullText.match(linePattern)
  if (!lineMatch) return null
  const line = lineMatch[0]
  const all = [...line.matchAll(/(\d{1,2})[/.](\d{1,2})[/.](\d{4})/g)]
  if (all.length === 0) return null
  const m = all[all.length - 1]
  return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`
}

// Righe che indicano QUANDO il documento e' stato prodotto (emesso/stampato):
// la loro data NON rappresenta il periodo coperto e va esclusa dalla recenza.
const EMISSION_LINE_RE = /(EMESS|EMISSIONE|STAMPAT|RILASCIAT|DATA\s+DOC)/i

/**
 * Ultima (massima) data GG/MM/AAAA presente nel testo, ESCLUDENDO le righe di
 * emissione/stampa. Fallback quando non si trovano scadenza/periodo/decorrenza.
 */
export function latestDateExcludingEmission(text) {
  let best = null
  let bestTs = -Infinity
  for (const rawLine of String(text).split(/\r?\n/)) {
    if (EMISSION_LINE_RE.test(rawLine)) continue
    for (const m of rawLine.matchAll(/(\d{1,2})[/.](\d{1,2})[/.](20\d{2})/g)) {
      const s = `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3]}`
      const ts = dateStrToTs(s)
      if (ts != null && ts > bestTs) { bestTs = ts; best = s }
    }
  }
  return best
}

// ─── Data di recenza del documento ───────────────────────────────────────────

/**
 * Data di RECENZA del documento (stringa GG/MM/AAAA), sempre LETTA nel
 * contenuto. Indica il periodo di copertura piu' avanzato descritto dal
 * documento, per stabilire quale file e' "il piu' aggiornato".
 *
 * Priorita' (copertura prima, emissione MAI):
 *   1. SCADENZA <data>            fine copertura (polizza / quietanza)
 *   2. PERIODO ... <data fine>    fine periodo di regolazione ("AL 31/12/2024")
 *   3. DECORRENZA / EFFETTO <data> inizio copertura
 *   4. ultima data del testo che NON sia su una riga di emissione/stampa
 */
export function extractDocumentDateString(text) {
  if (!text) return null

  // 1. Scadenza della copertura — il segnale piu' forte di recenza
  const scad = parseDateFromContextLine(text, /SCADENZA\b[^\n]{0,100}/i)
  if (scad) return scad

  // 2. Periodo di regolazione: la data di FINE periodo
  //    (es. "DATI REGOLAZIONE PREMIO PER IL PERIODO 01/01/2024 - 31/12/2024")
  const periodo = parseLastDateFromContextLine(text, /PERIODO\b[^\n]{0,140}/i)
  if (periodo) return periodo

  // 3. Inizio copertura
  const dec = parseDateFromContextLine(text, /DECORRENZA\b[^\n]{0,100}/i)
  if (dec) return dec
  const eff = parseDateFromContextLine(text, /EFFETTO\b[^\n]{0,100}/i)
  if (eff) return eff

  // 4. Fallback: ultima data utile, escluse le righe di emissione/stampa
  return latestDateExcludingEmission(text)
}

/**
 * Data di recenza come timestamp (ms). 0 se non determinabile (cosi' i documenti
 * senza data finiscono in fondo all'ordinamento crescente = trattati come piu'
 * vecchi).
 */
export function extractDocumentDate(text) {
  const str = extractDocumentDateString(text)
  if (!str) return 0
  const [dd, mm, yyyy] = str.split('/')
  return new Date(+yyyy, +mm - 1, +dd).getTime()
}

// ─── Normalizzazione e confronto valori ──────────────────────────────────────

/**
 * Normalizza una data in formato GG/MM/AAAA. Accetta GG/MM/AAAA, GG.MM.AAAA,
 * GG-MM-AAAA e AAAA-MM-GG. Restituisce null se non e' una data riconoscibile.
 */
export function normalizeDateValue(raw) {
  const v = String(raw).trim()
  let d, m, y
  let match = v.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/)
  if (match) { d = +match[1]; m = +match[2]; y = +match[3] }
  else {
    match = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (match) { y = +match[1]; m = +match[2]; d = +match[3] }
  }
  if (!match || d < 1 || d > 31 || m < 1 || m > 12) return null
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`
}

/** Converte una data GG/MM/AAAA in timestamp (ms), null se non valida. */
export function dateStrToTs(d) {
  if (!d || typeof d !== 'string') return null
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const ts = new Date(+m[3], +m[2] - 1, +m[1]).getTime()
  return Number.isFinite(ts) ? ts : null
}

/**
 * Regola "vince il dato piu' recente":
 * dato il valore ESISTENTE (con la sua data effettiva) e un NUOVO valore
 * candidato (con la sua), decide se il nuovo deve sostituire l'esistente.
 *
 * Il valore datato vince: un valore con data nota NON viene mai sostituito da
 * uno piu' vecchio o privo di data. A parita'/assenza di data, il nuovo passa
 * (l'ordine di elaborazione fa da spareggio).
 *
 * @param {string|null} oldEffective  data effettiva del valore esistente (GG/MM/AAAA)
 * @param {string|null} newEffective  data effettiva del nuovo valore (GG/MM/AAAA)
 * @returns {boolean} true = sostituisci con il nuovo
 */
export function shouldReplaceValue(oldEffective, newEffective) {
  const oldTs = dateStrToTs(oldEffective)
  const newTs = dateStrToTs(newEffective)
  if (oldTs != null && (newTs == null || newTs < oldTs)) return false
  return true
}

/**
 * Ricava la DATA INTERNA del documento dai campi appena estratti (testo o OCR
 * vision). Serve a datare i valori non-data (massimali, premi) di un documento
 * SCANSIONATO: senza questa data, i valori letti via OCR non riuscirebbero a
 * scavalcare quelli piu' vecchi letti da documenti con testo.
 *
 * Priorita': campo "scadenza" → "decorrenza" → qualunque campo di tipo data →
 * prima data GG/MM/AAAA presente in un valore.
 *
 * @param {object} updated     delta di campi { id: valore | {valore,...} }
 * @param {object} fieldsById  { id: definizione campo } per riconoscere i type 'date'
 * @returns {string|null} data GG/MM/AAAA o null
 */
export function pickDocDateFromExtracted(updated, fieldsById = {}) {
  if (!updated || typeof updated !== 'object' || Array.isArray(updated)) return null

  const getVal = (e) => {
    if (e == null) return null
    if (typeof e === 'string' || typeof e === 'number') return String(e)
    if (typeof e === 'object' && 'valore' in e) return e.valore != null ? String(e.valore) : null
    return null
  }

  // 1. Campi di copertura espliciti
  for (const key of ['scadenza', 'decorrenza']) {
    if (key in updated) {
      const d = normalizeDateValue(getVal(updated[key]) || '')
      if (d) return d
    }
  }
  // 2. Qualunque campo dichiarato di tipo data
  for (const [k, e] of Object.entries(updated)) {
    if (fieldsById[k]?.type === 'date') {
      const d = normalizeDateValue(getVal(e) || '')
      if (d) return d
    }
  }
  // 3. Prima data GG/MM/AAAA trovata in un valore qualsiasi
  for (const e of Object.values(updated)) {
    const v = getVal(e)
    const m = v && v.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2})\b/)
    if (m) {
      const d = normalizeDateValue(`${m[1]}/${m[2]}/${m[3]}`)
      if (d) return d
    }
  }
  return null
}
