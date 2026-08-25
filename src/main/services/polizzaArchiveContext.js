/**
 * Contesto storico dall'archivio Qdrant (FEATURE E) — modulo PURO.
 *
 * Quando la STESSA polizza (`polizza_numero`) è già stata estratta/indicizzata in
 * passato, fornisce al LLM un blocco "ARCHIVIO (storico)" coi valori storici
 * (con anno). È SOLO lettura/supporto: NON deve mai dare precedenza sul dato del
 * documento attuale più recente — la recency del merge resta sovrano, e il blocco
 * lo esplicita istruendo il modello.
 *
 * Disattivato di default (`settings.polizzaArchivio === true` per attivarlo). La
 * funzione di ricerca NON è importata da qui: viene INIETTATA (argomento
 * `search`) così il modulo resta puro e i test usano un MOCK senza Qdrant reale.
 * Un guasto di Qdrant → `null` silenzioso, mai throw.
 */

/** Soglia di score minima (esportata) perché un hit dell'archivio sia usato. */
export const ARCHIVE_MIN_SCORE = 0.60

/** Lunghezza massima del testo di un hit storico nel blocco (poche decine di token). */
export const ARCHIVE_SNIPPET_LEN = 200

/**
 * Raggruppa gli hit grezzi di `searchVector` in voci snelle per il prompt.
 *
 * @param {Array<object>} hits  [{ score, dossier, file, page, doc_year, text, … }]
 * @param {{minScore?:number, maxLen?:number}} [opts]
 * @returns {Array<{year:string|null, text:string, doc:string, score:number}>}
 */
export function interpretHistorical(hits, opts = {}) {
  const { minScore = ARCHIVE_MIN_SCORE, maxLen = ARCHIVE_SNIPPET_LEN } = opts
  if (!Array.isArray(hits) || !hits.length) return []
  return hits
    .filter((h) => h && typeof h === 'object' && Number(h.score) >= minScore && String(h.text || '').trim())
    .map((h) => ({
      year: (h.doc_year ?? h.year) != null ? String(h.doc_year ?? h.year) : null,
      text: String(h.text || '').slice(0, Math.max(0, Number(maxLen) || ARCHIVE_SNIPPET_LEN)),
      doc: h.file || h.dossier || '',
      score: Number(h.score),
    }))
}

/**
 * Costruisce il blocco `ARCHIVIO (storico)` da mettere nel prompt.
 * Ritorna `null` se non c'è polizza numero o se `historical` è vuoto.
 *
 * @param {object} args
 * @param {string} [args.polizzaNumero]
 * @param {Array<{year?:string|null, text?:string, doc?:string}>} [args.historical]
 * @returns {string|null}
 */
export function buildArchiveContext({ polizzaNumero, historical }) {
  const pn = String(polizzaNumero || '').trim()
  if (!pn) return null
  const list = Array.isArray(historical) ? historical : []
  if (!list.length) return null
  const lines = []
  lines.push(`ARCHIVIO (storico): valori della stessa polizza ${pn} indicizzati in passato — SOLO lettura di supporto. Usali SOLO se il documento attuale NON li contiene, o come CONFERMA; MAI come priorità sul dato più recente del fascicolo attuale.`)
  for (const h of list) {
    const anno = h.year ? ` (annualità ${h.year})` : ' (anno non noto)'
    lines.push(`HIT "${String(h.text || '').trim()}"${anno}${h.doc ? ` [${h.doc}]` : ''}`)
  }
  return lines.join('\n')
}

/**
 * Combinatore testabile: interroga l'archivio tramite `search` INIETTATA e
 * costruisce il blocco. Un guasto di `search` o l'assenza di hit → `null`
 * SEMPRE (skip silenzioso, mai throw). Default OFF se `settings.polizzaArchivio`
 * non è esattamente `true`.
 *
 * @param {object} args
 * @param {string} [args.polizzaNumero]
 * @param {(polizzaNumero:string)=>Promise<Array<object>>} args.search  funzione iniettata
 * @param {Array} [args.diag]       collettore righe diagnostica (opzionale)
 * @param {object} [args.settings]  per il gate polizzaArchivio
 * @param {object} [args.opts]      { minScore, maxLen }
 * @returns {Promise<string|null>}
 */
export async function loadArchiveContext({ polizzaNumero, search, diag, settings = {}, opts = {} }) {
  if (settings.polizzaArchivio !== true) return null
  const pn = String(polizzaNumero || '').trim()
  if (!pn) return null
  if (typeof search !== 'function') return null
  let hits
  try {
    hits = await search(pn)
  } catch (err) {
    if (Array.isArray(diag)) diag.push(`Archivio Qdrant: non disponibile (${err.message}) — si prosegue senza contesto storico.`)
    return null
  }
  const historical = interpretHistorical(hits, opts)
  if (!historical.length) {
    if (Array.isArray(diag)) diag.push(`Archivio Qdrant: nessun hit storico sopra soglia per la polizza ${pn}.`)
    return null
  }
  const block = buildArchiveContext({ polizzaNumero: pn, historical })
  if (Array.isArray(diag)) diag.push(`Archivio Qdrant: ${historical.length} voci storiche per la polizza ${pn} (sola lettura).`)
  return block
}