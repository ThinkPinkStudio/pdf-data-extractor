/**
 * Pre-controllo di PERTINENZA profilo↔fascicolo — parte PURA e testabile.
 *
 * Prima di spendere minuti di LLM su un fascicolo, si verifica che il suo
 * CONTENUTO sia davvero relativo al profilo scelto (es. profilo "RCT/RCO" su
 * una polizza incendio → blocco con "Procedi comunque" in UI). Tre metodi,
 * confrontabili sul campo con lo switch `polizzaPrecheckMode`:
 *  - 'keywords': parole chiave di CONTENUTO del profilo cercate nel testo OCR;
 *  - 'semantic': affinità embeddings pagine ↔ descrizioni dei campi;
 *  - 'llm': breve chiamata al modello ("che tipo di polizza è?") confrontata
 *    coi termini del profilo.
 *
 * Questo modulo NON importa Electron/Ollama/pdfjs: solo funzioni deterministiche
 * (le chiamate embeddings/LLM stanno in polizzaPrecheckService.js). Le SOGLIE
 * sono esportate per essere tarabili nei test.
 */

// Soglie del verdetto. Prudenti per costruzione: il pre-check BLOCCA un job, un
// falso allarme costa un click ("Procedi comunque"), ma un pre-check lasco non
// serve a niente. Tarate sui punteggi osservabili in diagnostica.
export const KEYWORD_MIN_RATIO = 0.2   // almeno 1 keyword su 5 trovata nel testo
export const SEMANTIC_MIN = 0.45       // media top-K cosine descrizioni↔pagine
export const LLM_MIN = 0.2             // overlap token rilevati↔termini profilo

/**
 * Normalizzazione per il matching di contenuto: minuscole, senza diacritici,
 * solo [a-z0-9] e spazi singoli (gli spazi restano: servono ai confini parola).
 */
export function normalizeForPrecheck(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "rct, rco; prestatori di lavoro\nresponsabilità civile" → lista pulita. */
export function parseContentKeywords(str) {
  return String(str || '')
    .split(/[,;\n]+/)
    .map((k) => k.trim())
    .filter((k) => k.length >= 3)
}

/**
 * Quante keyword del profilo compaiono nel testo normalizzato (match a
 * SOTTOSTRINGA normalizzata: "RCT/RCO" trova "rct rco", una keyword multi-parola
 * deve comparire come frase).
 * @returns {{ matched: string[], missing: string[], ratio: number }}
 */
export function keywordVerdict(keywords, normText) {
  const kws = (keywords || []).map((k) => ({ raw: k, norm: normalizeForPrecheck(k) })).filter((k) => k.norm)
  if (!kws.length) return { matched: [], missing: [], ratio: 0 }
  const matched = [], missing = []
  for (const k of kws) (normText.includes(k.norm) ? matched : missing).push(k.raw)
  return { matched, missing, ratio: matched.length / kws.length }
}

/** Similarità coseno tra due vettori (spostata qui da polizzaService: pura). */
export function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

/**
 * Punteggio semantico del fascicolo: MEDIA delle migliori affinità per campo
 * (per ogni campo, il max coseno descrizione↔pagine). La media — non il max —
 * perché un fascicolo pertinente parla della MAGGIORANZA dei campi del profilo,
 * mentre un campo generico ("indirizzo") matcha qualsiasi polizza.
 * @param {number[]} perFieldMaxAffinities  una voce per campo, max sulle pagine
 */
export function semanticScore(perFieldMaxAffinities) {
  const v = (perFieldMaxAffinities || []).filter((x) => typeof x === 'number' && !Number.isNaN(x))
  if (!v.length) return null
  return v.reduce((s, x) => s + x, 0) / v.length
}

/**
 * Overlap tra ciò che il modello ha rilevato nel fascicolo (tipo + parole
 * chiave) e i termini del profilo (nome + contentKeywords + label dei campi):
 * frazione dei token RILEVATI che compaiono nei termini del profilo.
 */
export function llmComparisonScore(detected, profileTerms) {
  const tokens = normalizeForPrecheck([detected?.type, ...(detected?.keywords || [])].filter(Boolean).join(' '))
    .split(' ')
    .filter((t) => t.length >= 3)
  if (!tokens.length) return null
  const haystack = ` ${normalizeForPrecheck((profileTerms || []).join(' '))} `
  const hit = tokens.filter((t) => haystack.includes(` ${t} `) || haystack.includes(t)).length
  return hit / tokens.length
}

/**
 * VERDETTO finale, con tutte le degradazioni esplicite:
 * - mode 'off' o nessun profilo → 'skipped' (i job coi campi globali non hanno
 *   un "profilo" con cui confrontare);
 * - 'keywords' senza contentKeywords configurate → degrada a 'semantic';
 * - input del metodo non disponibile (embeddings giù, LLM muto) → 'skipped':
 *   MAI bloccare un job per un guasto infrastrutturale.
 *
 * @param {object} p { mode, hasProfile, hasContentKeywords,
 *                     keyword: {ratio}|null, semantic: number|null, llm: number|null }
 * @returns {{ verdict: 'ok'|'mismatch'|'skipped', mode: string, score: number|null, threshold: number|null, reason: string }}
 */
export function decidePrecheck(p) {
  const mode = p?.mode || 'off'
  if (mode === 'off') return { verdict: 'skipped', mode, score: null, threshold: null, reason: 'pre-check disattivato' }
  if (!p?.hasProfile) return { verdict: 'skipped', mode, score: null, threshold: null, reason: 'nessun profilo sul job (campi globali)' }

  let effective = mode
  if (mode === 'keywords' && !p.hasContentKeywords) effective = 'semantic' // degradazione documentata

  if (effective === 'keywords') {
    if (!p.keyword) return { verdict: 'skipped', mode: effective, score: null, threshold: null, reason: 'testo non disponibile' }
    const ok = p.keyword.ratio >= KEYWORD_MIN_RATIO
    return { verdict: ok ? 'ok' : 'mismatch', mode: effective, score: p.keyword.ratio, threshold: KEYWORD_MIN_RATIO, reason: ok ? 'parole chiave del profilo trovate nel contenuto' : 'nessuna parola chiave del profilo nel contenuto' }
  }
  if (effective === 'semantic') {
    if (typeof p.semantic !== 'number') return { verdict: 'skipped', mode: effective, score: null, threshold: null, reason: 'embeddings non disponibili' }
    const ok = p.semantic >= SEMANTIC_MIN
    return { verdict: ok ? 'ok' : 'mismatch', mode: effective, score: p.semantic, threshold: SEMANTIC_MIN, reason: ok ? 'contenuto affine alle descrizioni dei campi' : 'contenuto NON affine alle descrizioni dei campi del profilo' }
  }
  if (effective === 'llm') {
    if (typeof p.llm !== 'number') return { verdict: 'skipped', mode: effective, score: null, threshold: null, reason: 'modello non disponibile o risposta non valida' }
    const ok = p.llm >= LLM_MIN
    return { verdict: ok ? 'ok' : 'mismatch', mode: effective, score: p.llm, threshold: LLM_MIN, reason: ok ? 'tipo rilevato compatibile col profilo' : 'tipo rilevato incompatibile col profilo' }
  }
  return { verdict: 'skipped', mode, score: null, threshold: null, reason: `modo sconosciuto: ${mode}` }
}

// Stopword per l'estrazione dei termini frequenti (descrizione del contenuto
// nei messaggi di blocco): boilerplate presente in ogni polizza.
const FREQ_STOPWORDS = new Set([
  'polizza', 'polizze', 'assicurato', 'assicurata', 'assicurazione', 'assicurazioni', 'assicurativa',
  'contraente', 'compagnia', 'agenzia', 'della', 'delle', 'dello', 'degli', 'dalla', 'dalle', 'nella',
  'nelle', 'sono', 'come', 'ogni', 'viene', 'euro', 'data', 'numero', 'pagina', 'documento', 'codice',
  'importo', 'totale', 'premio', 'anno', 'annuo', 'articolo', 'condizioni', 'generali', 'partita',
  'fiscale', 'sede', 'legale', 'firma', 'presente', 'quanto', 'alle', 'agli', 'anche', 'oppure',
])

/**
 * I termini più FREQUENTI del testo (per il messaggio "rilevato: …" quando il
 * metodo non è llm): parole ≥5 char, senza stopword di dominio, top N.
 */
export function topContentTerms(normText, n = 5) {
  const counts = new Map()
  for (const t of String(normText || '').split(' ')) {
    if (t.length < 5 || FREQ_STOPWORDS.has(t) || /^\d+$/.test(t)) continue
    counts.set(t, (counts.get(t) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([t]) => t)
}
