/**
 * Registro dei "fatti" numerici — guardia anti-fantasma strutturale.
 *
 * Costruito DOPO Stadio A, in modo DETERMINISTICO (zero LLM). Per ogni documento
 * e per ogni valore numerico del testo memorizza { value, raw, label (finestra
 * circostante), doc, page }. Serve a:
 *   (1) whitelist di importi plausibili per un campo (verifica di evidenza);
 *   (2) controllo prudente nel merge: un importo LARGO che NON compare in NESSUN
 *       documento del fascicolo è un candidato fantasma, non "l'ultima parola
 *       del modello" su ciò che esiste.
 *
 * Vincoli voluti (decisioni già prese, non riaprire):
 *   - TYPE-BLIND: nessuna logica per tipo documento; il registro porta label e
 *     valore, MAI priorità/setti per tipo di file ("documenti tutti uguali").
 *   - Solo funzioni pure deterministiche, nessuna chiamata LLM.
 *
 * Il modulo dipende SOLO da polizzaValidation (puro) per `normForMatch` e
 * `looseAmount`. Nessun accoppiamento ai servizi di import: testabile in Node
 * puro come gli altri test del repo.
 */
import { looseAmount } from './polizzaValidation.js'

// Importo "LARGO": sotto questa soglia un candidato senza riscontro nel registro
// non viene MAI bloccato (troppo facile far scattare falsi veto su cifre piccole,
// anni, numeri di pagina o righe di tabella).
export const LARGE_AMOUNT_THRESHOLD = 100000

// Tolleranza "equivalenti" per considerare uguali due importi (default ±1%).
export const AMOUNT_TOLERANCE = 0.01

// Dizionario keyword → categoria di campo. Serve a (a) etichettare ogni fatto con
// le categoria rilevate attorno al numero, e (b) derivare le categorie di un campo
// da id/etichetta. Intenzionalmente poche ma giuste ("meglio poche label giuste
// che lami").
const LABEL_CATEGORIES = [
  { cat: 'massimale', re: /\bmassimal/i },
  { cat: 'scoperto', re: /\bscopert/i },
  { cat: 'franchigia', re: /\bfranchig/i },
  { cat: 'premio', re: /\bpremi/i },
  { cat: 'imposta', re: /\bimpost/i },
  { cat: 'tasso', re: /\btasso\b|%|per\s+cent/i },
  { cat: 'parametro', re: /\bparametro\b|regolazion/i },
  { cat: 'preventivo', re: /\bpreventiv/i },
]

// Numeri-importo italiani: cifre con migliaia `.` e decimale `,`. Non cattura le
// date con `/` (restano fuori come importo).
const AMOUNT_RE = /\d[\d.]*(?:,\d+)?/g
// Date GG/MM/AAAA, GG.MM.AAAA, AAAA-MM-GG: registrate come fatti di tipo `date`.
const DATE_RE = /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b|\b\d{4}-[01]\d-[0-3]\d\b/g

/**
 * Categorie di un campo (da etichetta/id). Accetta un oggetto campo `{label,id}`
 * o una stringa grezza. Vuoto = campo non classificabile → giudizio conservativo.
 */
export function fieldCategories(field) {
  const s = typeof field === 'string'
    ? field
    : `${field?.label || ''} ${String(field?.id || '').replace(/[_-]+/g, ' ')}`
  const low = ` ${s.toLowerCase()}`
  const cats = []
  for (const { cat, re } of LABEL_CATEGORIES) if (re.test(low)) cats.push(cat)
  return cats
}

/**
 * Finestra "label" attorno a un numero: ultime parole prima del numero + il fatto
 * di questo pasio. NON pretende la perfezione: una label scarsa è innocua, una
 * label giusta vale. Ritorna { cats, label }.
 */
function contextLabel(rawText, tokenIndex, tokenLen) {
  const start = Math.max(0, tokenIndex - 48)
  const end = Math.min(rawText.length, tokenIndex + tokenLen + 24)
  const win = rawText.slice(start, end)
  const cats = []
  for (const { cat, re } of LABEL_CATEGORIES) if (re.test(win)) cats.push(cat)
  const before = rawText.slice(Math.max(0, tokenIndex - 40), tokenIndex).split(/\s+/).filter(Boolean)
  return { cats, label: before.slice(-3).join(' ') || null }
}

// Anno banale a 4 cifre (1900-2099): boilerplate, non un dato da whitelist.
// Importi legittimi tipo 1000/2500 restano dentro.
function isYearToken(token) {
  return /^\d{4}$/.test(token) && token >= '1900' && token <= '2099'
}

// Data puntinata/trattinata (31.12.2025 o 31-12-2025): il regex degli importi la
// catturerebbe come numero enorme ("31122025") ma è boilerplate di datazione,
// NON un importo da whitelist (le policce usano anche il punto come separatore).
function isDottedDateToken(token) {
  return /^\d{1,2}[.\-]\d{1,2}[.\-]\d{2,4}$/.test(token)
}

/**
 * Costruisce il registro dei fatti numerici del fascicolo.
 *
 * @param {Array<{name?:string,pages?:string[],text?:string}|string>} docs
 *   documenti (o direttamente testi). Per ogni pagina/testo estrae gli importi e
 *   le date, ciascuno con l'etichetta circostante.
 * @returns {{facts:Array, index:Map}}  `facts` = record {kind,value,raw,label,
 *   cats,doc,page}; `index` = Map valore-arrotondato → array di fatti IMPORTI
 *   (lookup "esiste la cifra?").
 */
export function buildFactsRegistry(docs) {
  const facts = []
  const index = new Map()

  const list = Array.isArray(docs) ? docs : []
  for (const input of list) {
    const doc = (typeof input === 'string') ? { text: input } : (input || {})
    const name = doc.name || 'doc'
    const pages = (Array.isArray(doc.pages) && doc.pages.length)
      ? doc.pages
      : ((typeof doc.text === 'string' && doc.text) ? doc.text.split('\n').filter(Boolean) : [])
    for (let p = 0; p < pages.length; p++) {
      const page = String(pages[p] || '')
      if (!page.trim()) continue

      let m
      AMOUNT_RE.lastIndex = 0
      while ((m = AMOUNT_RE.exec(page)) !== null) {
        const token = m[0]
        if (isYearToken(token) || isDottedDateToken(token)) continue
        const value = looseAmount(token)
        if (value == null || !Number.isFinite(value)) continue
        const { cats, label } = contextLabel(page, m.index, token.length)
        const fact = { kind: 'amount', value, raw: token, label, cats, doc: name, page: p + 1 }
        facts.push(fact)
        const key = Math.round(value)
        const bucket = index.get(key)
        if (bucket) bucket.push(fact)
        else index.set(key, [fact])
      }

      DATE_RE.lastIndex = 0
      while ((m = DATE_RE.exec(page)) !== null) {
        const datum = { kind: 'date', value: null, raw: m[0], date: m[0], label: null, cats: [], doc: name, page: p + 1 }
        facts.push(datum)
      }
    }
  }

  return { facts, index }
}

/**
 * Cerca nel registro le voci-importo il cui valore è "eqform" (entro tolleranza
 * ±tolerance) al numero cercato. Scarta i fatti di tipo date.
 */
export function findFactsByValue(registry, value, tolerance = AMOUNT_TOLERANCE) {
  if (!registry || value == null || !Number.isFinite(value)) return []
  const tol = tolerance == null ? AMOUNT_TOLERANCE : Math.max(0, tolerance)
  const lo = value * (1 - tol)
  const hi = value * (1 + tol)
  return registry.facts.filter((f) => f.kind === 'amount' && f.value >= lo && f.value <= hi)
}

/**
 * Whitelist prudente per un campo: l'importo candidato è plausibile?
 *
 * Contratto di ritorno (comportamento CONSERVATIVO — non blocca mai per assenza
 * di giudizio):
 *   - `true`  → esiste un fatto-importo "eqforms" al candidato con etichetta
 *               coerente con il campo (cifra ESISTE e la label lo sostiene);
 *   - `false` → importo LARGO (>= LARGE_AMOUNT_THRESHOLD) che NON compare in
 *               ALCUN documento: candidato sospetto/fantasma;
 *   - `null`  → cifra esiste ma la label non è giudicabile (o incoerente):
 *               MAI un veto di per sé — la cifra c'è davvero.
 *
 * Critico: la cifra si cerca nel registro INDIPENDENTEMENTE dalla label — la
 * coerenza label è un bonus, mai un requisito duro per un importo che comunque
 * esiste nel documento ("il 90% del valore è che la cifra esiste davvero").
 *
 * @param registry registro {facts,index}
 * @param {object|string} field  campo (id/label) o stringa descrittiva
 * @param {string|number} candidateAmount  valore candidato (es. "4.000.000,00")
 */
export function isFactPlausible(registry, field, candidateAmount) {
  const amt = looseAmount(candidateAmount)
  if (amt == null || !Number.isFinite(amt)) return null
  const matches = findFactsByValue(registry, amt)
  if (!matches.length) {
    // La cifra NON esiste nel fascicolo: veto SOLO se è un importo largo.
    return amt >= LARGE_AMOUNT_THRESHOLD ? false : null
  }
  // La cifra esiste. Categoria: se il campo non è classificabile, non si può
  // giudicare la label → conservativo (null).
  const fcats = fieldCategories(field)
  if (!fcats.length) return null
  const labeled = matches.filter((f) => f.cats.length)
  if (!labeled.length) return null // cifra esiste ma senza label anagrafica: non è un veto
  const coherent = labeled.some((f) => f.cats.some((c) => fcats.includes(c)))
  // cifra esiste + label coerente → true; cifra esiste + label incoerente →
  // MAI bloccante (null).
  return coherent ? true : null
}

/**
 * Wrapper prudente del veto: decide solo quando il candidato è un importo LARGO
 * NON supportato da alcuna voce (fantasma). Ritorna:
 *   - `false` → veto (tieni `best`);
 *   - `null`  → lascia decidere al merge (caso di default, conservativo).
 * Non riceve il campo: usa SOLO l'esistenza della cifra (il 90% del valore).
 */
export function vetoMergeCandidate(best, cand, registry) {
  if (!best || !cand) return null
  const amt = looseAmount(cand?.valore)
  if (amt == null || !Number.isFinite(amt) || amt < LARGE_AMOUNT_THRESHOLD) return null
  if (findFactsByValue(registry, amt).length) return null // la cifra esiste → non veto
  return false // importo largo mai visto nel fascicolo → veto l'override
}