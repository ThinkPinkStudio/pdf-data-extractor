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
import { looseAmount, factNature, descriptionDeniesNature } from './polizzaValidation.js'
import { scanKindForField, NUMERIC_SCAN_KINDS } from './polizzaNumericScan.js'

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
    : `${field?.label || ''}`
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

// ─── Veto sulla SORGENTE (opzioni del questionario) ─────────────────────────
// Problema visto sul campo: il modello pescava il "massimale per sinistro" da
// una CHECKBOX/opzione del "Nuovo Questionario Assuntivo" (1.000.000,00) invece
// che dal valore reale di polizza/dichiarazione (7.500.000,00). Le opzioni di un
// questionario sono SCELTE POSSIBILI, non il valore effettivo del campo. La
// rilevazione è per CONTENUTO (mai per tipo file: documenti tutti uguali): un
// documento è "con opzioni" se il testo porta i marcatori di scelta (☐/[ ]/
// "spuntare"/"opzionale"/"selezionare"/"barrare"/ecc).

/** Marcatori di documento-questionario/opzioni nel TESTO (mai dipendenti dal nome). */
const OPTION_MARKER_RE =
  /questionario|opzione|scelta\s+tra|spuntar|barrare|selezionar|\u2610|\[[ xX]?\]|uno\s+o\s+(?:pi[ùu]|piu)\s+|deselezion|possibili\s+pret|\bselect\b/i

/** true se il testo del documento parla di opzioni/checkbox (contenuto, non nome). */
export function detectOptionLikeText(text) {
  return OPTION_MARKER_RE.test(String(text || ''))
}

/**
 * Vetta un candidato che per un campo STRUTTURALE (massimale/franchigia/scoperto/
 * tutela) porta un importo LARGO il cui UNICO diritto nel fascicolo è un documento
 * questionario/opzioni: è una scelta tra più possibilità, non il valore effettivo.
 *
 * Granularità PER-PAGINA: un file che contiene sia la SCHEDA REALE del contratto
 * sia il questionario (fascicoli AmTrust: scheda p2 con massimali reali + modulo
 * a pagine successive) NON va trattato tutto come "opzioni". Il candidato passa
 * se la cifra esiste in almeno una pagina NON-opzione dello stesso file o di un
 * altro documento. `optionPages` è un Set di `nomeDoc|numeroPagina` (1-based)
 * rivelate come opzioni; senza di esso resta il comportamento storico (per-file).
 *
 * @param registry registro {facts,index}
 * @param {Array<string>|Set<string>} optionDocs nomi documento rivelati come opzioni
 * @param {object} cand candidato { valore, file }
 * @param {Set<string>} [optionPages] chiavi `doc|page` delle pagine-opzione
 * @returns {boolean} true = vetto (la cifra esiste SOLO in pagine-opzione)
 */
export function vetoOptionSourceOnly(registry, optionDocs, cand, optionPages = null) {
  if (!registry || !cand || !optionDocs) return false
  const amt = looseAmount(cand?.valore)
  if (amt == null || !Number.isFinite(amt) || amt < LARGE_AMOUNT_THRESHOLD) return false
  const matches = findFactsByValue(registry, amt)
  if (!matches.length) return false
  const docSet = new Set(matches.filter((f) => f.kind === 'amount').map((f) => f.doc))
  if (!docSet.size) return false
  // Con la granularità PER-PAGINA: se una qualunque occorrenza della cifra sta in
  // una pagina NON-opzione (anche dello stesso file marcato opzione nel suo
  // complesso), il valore ha un diritto reale nel fascicolo → non vettare.
  if (optionPages && optionPages.size) {
    const inCleanPage = matches.some((f) => {
      if (f.kind !== 'amount' || f.page == null) return false
      return !optionPages.has(`${f.doc}|${f.page}`)
    })
    if (inCleanPage) return false
  }
  // Vetto solo se TUTTI i testimoni della cifra sono documenti-opzione.
  return [...docSet].every((d) => optionDocs.has(d))
}

/**
 * Numero di DOCUMENTI DISTINTI che testimonia una cifra nel registro. È il
 * segnale type-blind di "valore ripetuto in più sorgenti" (più affidabile) vs
 * "valore in un solo documento" (spesso un'opzione o un clausola isolata).
 * @returns {number} n° documenti distinti che contengono `value` (0 se assente)
 */
export function factDocCount(registry, value, tolerance = AMOUNT_TOLERANCE) {
  if (!registry || value == null || !Number.isFinite(value)) return 0
  const matches = findFactsByValue(registry, value, tolerance)
  return new Set(matches.filter((f) => f.kind === 'amount').map((f) => f.doc)).size
}

/**
 * true se la description del campo VIETA il riuso di un importo identico a un
 * altro campo ("DEVE essere diverso", "non riutilizzare", "non ... il massimale",
 * "non 7500"). È la condizione che rende lo "spill" dello stesso valore da un
 * campo strutturale a un altro un FALSO POSITIVO da vetare nel merge.
 */
export function demandsDistinctValue(field) {
  const s = String(field?.description || '')
  return /diverso|non\s+riutiliz|non\s+deve|non\s+uscir|non\s+(?:essere|es)|\b7500\b|\bnon\s+o+(?:\s+il)?\s*(?:massimale|massimo)/i.test(s)
}

/**
 * Vetto la DUPLICAZIONE di un importo su campi strutturali che esigono un valore
 * DISTINTO: quando la description del campo vieta il riuso ("non essere il
 * massimale", "non 7500") e il valore proposto è GIÀ quello (entro tolleranza)
 * di un ALTRO campo già valorizzato in `best`, il candidato è un "spill" → veto.
 *
 * Il campo stesso è escluso dal confronto (`excludeId`): se `best[k]` vale già
 * lo stesso importo non si vetta, perché vivrebbe comunque ossesso; il veto qui
 * blocca lo spill tra campi DIVERSI.
 *
 * @returns {boolean} true = rifiutare il candidato DUPLICATO
 */
export function vetoStructuralDuplicate(field, cand, best, excludeId, tolerance = AMOUNT_TOLERANCE) {
  if (!field || !cand || !best) return false
  if (!demandsDistinctValue(field)) return false
  const amt = looseAmount(cand?.valore)
  if (amt == null || !Number.isFinite(amt)) return false
  const tol = tolerance == null ? AMOUNT_TOLERANCE : Math.max(0, tolerance)
  for (const [id, b] of Object.entries(best)) {
    if (id === excludeId) continue
    if (b == null || !('valore' in b)) continue
    const other = looseAmount(b.valore)
    if (other == null || !Number.isFinite(other)) continue
    const scale = Math.max(Math.abs(amt), Math.abs(other))
    if (!(scale > 0)) continue
    if (Math.abs(other - amt) <= scale * tol) return true
  }
  return false
}

// ─── Disambiguazione grandezze (FIX 1 / FIX 2) ───────────────────────────────
// Due candidati distinti dello stesso importo possono avere NATURA diversa a
// seconda del contesto (un importo è SEMANTICAMENTE un "premio/imponibile",
// un "massimale", una "franchigia"). Il veto qui decide quando l'importo NON
// può essere promosso come valore del campo: non per tipo FILE (documenti tutti
// uguali) ma perché il testo attorno al numero parla di un'altra grandezza.
//
// Fascicolo Cedam (RC PROF MED V2): c'è UN SOLO valore strutturale grande, il
// 7.500.000,00 della dichiarazione citato "Unico per sinistro". Un `13.068,00`
// (imponibile+imposta di quietanza) NON è il "massimale annuo"; il 7.500.000
// massimale NON è il "fatturato dichiarato". Regola del profilo già presente:
// descrizioni NUMERO/IMPORTO che vietano il valore di un'altra grandezza.

/**
 * FIX 1 — massimale annuo: la description vieta il valore di un'altra grandezza
 * e l'importo candidato nel registro NON compare mai accanto a "massimale",
 * oppure compare SOLO accanto a premi/imponibile/fatturato → natura estranea.
 * @returns {boolean} true = rifiutare (l'importo è di un'altra grandezza)
 */
export function vetoForeignNatureMassimaleAnnuo(registry, field, candidateAmount) {
  if (!registry || !field) return false
  const label = String(field.label || '')
  if (!/annuo/i.test(label) || !/massimale/i.test(label)) return false
  const amt = looseAmount(candidateAmount)
  if (amt == null || !Number.isFinite(amt)) return false
  const matches = findFactsByValue(registry, amt)
  if (!matches.length) return false // senza registro non si giudica
  const natures = matches.map((f) => factNature(f.cats)).filter(Boolean)
  // alcuna occorrenza come "vero massimale" (categoria massimale, non premium)
  const hasTrueMassimale = matches.some((f) => factNature(f.cats) === 'massimale' && !isPremiumNature(f))
  if (hasTrueMassimale) return false
  if (!natures.length) return false // nessuna label: conservativo, non veto
  // tutte le etichette concordano su natura NON-massimale → estraneo
  return natures.every((n) => n !== 'massimale')
}

/**
 * FIX 1 — fatturato: la description parla di "fatturato dichiarato" (autonomo,
 * NON il massimale) e l'importo candidato nel testo compare SOLO nel contesto
 * "Massimali Assicurati" (RCT/RCO, "Unico per sinistro") → è il massimale, non
 * il fatturato. Senza label leggibile non si giudica.
 * @returns {boolean} true = rifiutare (l'importo è il massimale, non il fatturato)
 */
export function vetoForeignNatureFatturato(registry, field, candidateAmount) {
  if (!registry || !field) return false
  if (!/\bfatturato\b/i.test(String(field.description || ''))) return false
  const amt = looseAmount(candidateAmount)
  if (amt == null || !Number.isFinite(amt)) return false
  const matches = findFactsByValue(registry, amt)
  if (!matches.length) return false
  // un'occorrenza che parli di "premio/preventivo/regolazione/quota" → non-only-massimale
  const hasFatturatoLike = matches.some((f) => /fatturat|preventiv|quotazion|regolazion|premio/i.test(String(f?.label || '') + ' ' + String(f?.cats || '')))
  if (hasFatturatoLike) return false
  const massimaleOnly = matches.filter((f) => factNature(f.cats) === 'massimale')
  if (!massimaleOnly.length) return false // non è (solo) il massimale
  // il massimale è l'UNICA natura: l'importo è il massimale, non il fatturato
  return matches.every((f) => factNature(f.cats) !== null && factNature(f.cats) === 'massimale')
}

/**
 * FIX 2 — franchigia/scoperto (piccoli): la description esige un numero INFERIORE
 * al massimale ("non il massimale", "non 7500") e l'importo candidato è un
 * valore MILIONARIO che nel registro è il massimale di polizza (o un'opzione):
 * non è la franchigia. Se NON c'è alcuna occorrenza più piccola coerente, il
 * veto resta comunque prudente sui milioni.
 * @returns {boolean} true = rifiutare (importo nell'ordine del massimale)
 */
export function vetoForeignNatureFranchigia(registry, field, candidateAmount) {
  if (!registry || !field) return false
  const blob = `${String(field.id || '')} ${String(field.label || '')} ${String(field.description || '')}`
  if (!/franchig|scopert/i.test(blob)) return false
  if (!descriptionDeniesNature(field.description || '')) return false
  const amt = looseAmount(candidateAmount)
  if (amt == null || !Number.isFinite(amt)) return false
  if (amt < 100000) return false // valore piccolo: mai veto
  const matches = findFactsByValue(registry, amt)
  // nessuna cifra: non giudicabile dal registro → lascia decidere al merge
  if (!matches.length) return false
  // se il valore è TUTTO massimale/dichiarazione (natura massimale ovunque) → no
  const massNatures = matches.filter((f) => factNature(f.cats) === 'massimale')
  const anySmallCoherent = registry.facts.some((f) =>
    f.kind === 'amount' && factNature(f.cats) === 'basso' && f.value >= 1000 && f.value < 100000)
  // milioni e sempre (o mai) etichettati massimale → non franchigia; se nel
  // fascicolo c'è un valore piccolo coerente, è quello la franchigia, non i milioni
  if (massNatures.length && massNatures.length / matches.length >= 0.5) return true
  if (anySmallCoherent && amt >= 1000000) return true
  return false
}

function isPremiumNature(f) {
  return /premi|imponib|impost|fatturat|preventiv|retrib/.test(String(f?.cats || '').toLowerCase())
}

/**
 * Regola 9 — FRANCHIGIA NON è MASSIMALE: per un campo massimale-per-sinistro
 * (o annuo), un importo candidato che nel registro è SEMANTICAMENTE una
 * franchigia/scoperto BASSA (piccola, etichettata "franchigia/scoperto") e
 * che NON compare mai come vero massimale, non può essere promosso a
 * massimale. Il LLM o l'arbitro l'hanno pescato dal contesto (la regola
 * "franchigia frontale di € 20.000,00" finiva sul massimale per sinistro
 * nel fascicolo storico Cedam).
 *
 * Guardia SEVERA (monotona): interviene solo quando l'importo è < 1.000.000
 * (un massimale realistico è >= 1.000.000) e il registro dimostra che il
 * valore compare SOLO come franchigia/scoperto (natura 'basso'). Se l'importo
 * compare anche come vero massimale → il candidato può essere il massimale.
 *
 * @returns {boolean} true = rifiutare (importo è la franchigia, non il massimale)
 */
export function vetoFranchigiaAsMassimale(registry, field, candidateAmount) {
  if (!registry || !field) return false
  const blob = `${String(field.id || '')} ${String(field.label || '')} ${String(field.description || '')}`
  if (!/massimal/i.test(blob)) return false // solo campi massimale
  const amt = looseAmount(candidateAmount)
  if (amt == null || !Number.isFinite(amt)) return false
  if (amt >= 1000000) return false // importo da massimale: mai veto
  const matches = findFactsByValue(registry, amt)
  if (!matches.length) return false // senza registro non si giudica
  // c'è una occorrenza come VERO massimale (categoria massimale, non franchigia)?
  if (matches.some((f) => factNature(f.cats) === 'massimale' && !isPremiumNature(f))) return false
  const bassa = matches.filter((f) => factNature(f.cats) === 'basso')
  if (!bassa.length) return false // non etichettata franchigia/scoperto → non giudico
  // SOLO franchigie/scoperti (o non-label): è la franchigia, non il massimale
  return true
}

// ─── NATURA ESTRANEA MASSIMALE (generalizzazione CEDAM) ─────────────────────
// Sul fascicolo CEDAM (Rc Professionale V3) il 7.500.000 della dichiarazione è
// il MASSIMALE PER SINISTRO. Un campo la cui natura NON è un massimale-per-
// sinistro/annuo NON può ricevere un importo che nel registro è
// SEMANTICAMENTE SOLO un massimale: "Estensioni operative", "Esclusioni",
// "Legge Merloni", "Visto pesante", "Attività giudiziale" ecc. ricevevano il
// 7.500.000 via LLM/arbitro.
//
// Regola MONOTONA e type-blind: NON si usa MAI l'assenza/"non presente" per
// decidere (i dati sono dinamici). Si vetta SOLO quando il registro DIMOSTRA
// che l'importo compare ESCLUSIVAMENTE come "massimale" (natura massimale in
// TUTTE le occorrenze, mai accanto a premi/fatturato/regolazione) e il campo
// NON è un massimale per sinistro/annuo (`scanKindForField`): un campo che ha
// solo "massimale" nella label per un'ALTRA garanzia/prodotto (Visto pesante,
// RC Prodotti, Progettazione/DL) NON ha quella natura e non deve ricevere il
// massimale generale del contratto. Meglio vuoto che un importo di natura
// sbagliata.
//
// @returns {boolean} true = rifiutare (l'importo è un massimale in un campo che
// non è un massimale per sinistro/annuo)
export function vetoForeignNatureMassimale(registry, field, candidateAmount) {
  if (!registry || !field) return false
  // Il campo deve avere la natura STRETTA di massimale-per-sinistro o
  // massimale-annuo (scanKindForField) per poter accettare un detto massimale.
  // Un campo che nella descrizione cita "massimale" solo per contrapposizione
  // o per un ALTRO prodotto/garanzia NON ha quella natura.
  const kind = scanKindForField(field)
  const isScanSinistro = kind === NUMERIC_SCAN_KINDS.MASSIMALE_SINISTRO
  const isScanAnnuo = kind === NUMERIC_SCAN_KINDS.MASSIMALE_ANNUO
  if (isScanSinistro || isScanAnnuo) return false
  const amt = looseAmount(candidateAmount)
  if (amt == null || !Number.isFinite(amt)) return false
  if (amt < 100000) return false // valori piccoli: mai veto
  const matches = findFactsByValue(registry, amt)
  if (!matches.length) return false // senza registro non si giudica
  // più debole: un'occorrenza NON-massimale (premio/fatturato/ecc.) → il valore
  // non è un "solo massimale", non veto.
  const anyNonMassimale = matches.some((f) => {
    const n = factNature(f.cats)
    return n !== null && n !== 'massimale'
  })
  if (anyNonMassimale) return false
  // tutte le occorrenze sono massimali (o non-etichettate) → è il massimale e il
  // campo non è un massimale per sinistro/annuo: natura estranea → veto.
  const mass = matches.filter((f) => factNature(f.cats) === 'massimale')
  if (!mass.length) return false // nessuna etichettata massimale: conservativo
  return true
}

// ─── Sottolimiti contrattuali (FIX 3) ────────────────────────────────────────
// Il campo "Sottolimiti" (TESTO elenco) deve estrarre i sottolimiti dalle
// CONDIZIONI DELLA POLIZZA (dove sono elencati per garanzia), NON dalle opzioni
// del questionario. Sul campo (fascicolo Cedam): i veri sottolimiti contrattuali
// sono 740.000/500.000/260.000 (polizza p.8); il modello proponeva invece
// "RCO: 2.000.000 / RCT: 1.000.000" (opzioni del questionario). Il veto
// opzione-questionario per IMPORTI singoli non bastava: il TESTO elenco
// (rct_parametro) è una stringa con più importi, non un unico importo largo,
// quindi il veto per singolo importo non scattava e la stringa dalle opzioni
// resta l'unica proposta.
//
// Regola: se la description è TESTO elenco con "sottolimiti" e il valore include
// importi che nel registro esistono SOLO in documenti-opzione, mentre il CORPO
// della polizza (non-opzione) porta sottolimiti reali per garanzia, preferire
// la stringa del contratto a quella delle opzioni.

/**
 * true se la description del campo parla di "sottolimiti" con garanzia (elenco):
 * è il campo TESTO elenco della polizza (es. "Tutti i sottolimiti indicati, con
 * la garanzia a cui si riferiscono").
 */
export function isSottolimitiField(field) {
  const blob = `${String(field?.id || '')} ${String(field?.label || '')} ${String(field?.description || '')}`
  return /sottolimit/i.test(blob)
}

/**
 * Importi (≈) presenti nel TESTO del valore estratto (elenco "RCO: 2.000.000
 * / RCT: 1.000.000" → [2000000, 1000000]).
 */
export function amountsInValue(value) {
  const s = String(value || '')
  const out = []
  for (const m of s.matchAll(/\d[\d.]*(?:,\d+)?/g)) {
    const amt = parseFloat(String(m[0]).replace(/\./g, '').replace(',', '.'))
    if (Number.isFinite(amt) && amt >= 100000) out.push(amt)
  }
  return out
}

/**
 * FIX 3 — un valore di "Sottolimiti" che contiene importi presenti SOLO in
 * documenti-opzione del questionario, mentre il corpo della polizza (pagine
 * non-opzione) porta sottolimiti reali per garanzia, deve essere scartato:
 * la stringa dalle opzioni NON è il contenuto contrattuale (valido sul campo).
 *
 * @returns {boolean} true = rifiutare il valore (stringa fatta di sole opzioni)
 */
export function vetoSottolimitiOptionOnly(registry, optionDocs, field, value) {
  if (!registry || !optionDocs || !field) return false
  if (!isSottolimitiField(field)) return false
  const amounts = amountsInValue(value)
  if (amounts.length < 2) return false // un solo importo: non è l'elenco
  // ogni importo dell'elenco deve esistere SOLO in documenti-opzione
  const anyFromBody = amounts.some((amt) => {
    const matches = findFactsByValue(registry, amt)
    if (!matches.length) return false // non nel registro → non dimostrabile da opzioni
    const docSet = new Set(matches.map((f) => f.doc))
    return [...docSet].some((d) => !optionDocs.has(d))
  })
  if (anyFromBody) return false
  // nessun importo dell'elenco ha riscontro fuori dalle opzioni: si può avere
  // anche senza opzioni abilitate (nessun doc-opzione = nessun "solo-opzione"
  // da rifiutare, a meno che gli importi non esistano da nessuna parte)
  if (!optionDocs.size) return false
  return true
}

// ─── Guardrail ANTI-SPILL (generalizzazione): ───────────────────────────────
// Problema (A/B esteso, fascicolo CEDAM V3): quando un profilo NON ha i campi
// "acquistati" (massimali/scoperti comprati) e il documento porta un solo
// massimale grande, il modello copia QUEL valore su TUTTI i campi numerici
// della stessa famiglia (rcp_massimale_sinistro/annuo/mat/interr e i tre
// rcp_scoperto_*_mondo/usa tutti = 7.500.000,00 mentre atteso vuoto).
//
// Regola MONOTONA: non tocca un campo già corretto in un profilo che porta i
// massimali veri (lì i valori sono vari). Interviene SOLO quando
//  1. il nominativo della famiglia è "massimali/scoperti" con valore atteso
//     specifico per sotto-garanzia (il profilo ripete la parola nei campi), e
//  2. il valore da assegnare compare già IDENTICO su >= SPILL_MAX_CAMPI campi
//     della famiglia, e
//  3. i campi della famiglia hanno SOSTANZIALMENTE TUTTI "acquistati" (manca
//     la varietà che c'è quando i valori sono veri).
// Allora è spill: NON valorizzare (resta vuoto).
export const SPILL_MAX_CAMPI = 3
export const SPILL_FAMILIES = ['massimale', 'scoperto']

const SPILL_LABEL_RE = /massimal|scopert/

/**
 * Ripulisce da `best` i valori che sono SPILL di un unico importo su troppi
 * campi della stessa famiglia "massimali/scoperti" quando la famiglia nel
 * profilo è acquistata/non-variata (i campi veri hanno valori diversi).
 *
 * Muta `best` (delete) e appende note diagnostiche. Ritorna il numero di campi
 * svuotati.
 */
export function guardAntiSpill(best, activeFields, notes = []) {
  if (!best || typeof best !== 'object') return 0
  const list = Array.isArray(activeFields) ? activeFields : []
  let cleared = 0

  for (const family of SPILL_FAMILIES) {
    const members = list.filter((f) => SPILL_LABEL_RE.test(`${f.id || ''} ${f.label || ''}`))
    if (members.length < SPILL_MAX_CAMPI + 1) continue

    // tra i campi con un valore numerico effettivo, quante distinte cifre?
    const valued = members
      .map((f) => ({ f, v: looseAmount(best[f.id]?.valore ?? best[f.id]) }))
      .filter((x) => x.v != null && Number.isFinite(x.v))
    if (valued.length < SPILL_MAX_CAMPI) continue
    const distinct = new Set(valued.map((x) => x.v.toFixed(2)))
    if (distinct.size !== 1) continue // valori vari: famiglia vera, non intervengo

    const amt = valued[0].v
    // soglia di plausibilità spill: riguarda valori strutturali (>= 100.000)
    if (amt < 100000) continue

    for (const { f, v } of valued) {
      const id = f.id
      const prev = best[id]
      if (prev && typeof prev === 'object' && 'valore' in prev) delete best[id]
      else delete best[id]
      cleared++
      if (Array.isArray(notes)) {
        notes.push(`Anti-spill: ${family} "${String(v).slice(0, 20)}" identico su ${valued.length} campi senza varietà → ${id} svuotato (meglio vuoto che sbagliato)`)
      }
    }
  }
  return cleared
}