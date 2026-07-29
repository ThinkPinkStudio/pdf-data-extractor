/**
 * Validazione PURA dei valori estratti dalle polizze RC + logica di partizione
 * campi e di recenza dei candidati per il motore a stadi.
 *
 * Questo modulo NON importa Electron, pdfjs o provider LLM: solo funzioni
 * deterministiche su stringhe/oggetti. Per questo e' importabile e testabile in
 * Node puro (vedi test/polizzaChecksums.test.mjs). Puo' dipendere unicamente da
 * polizzaDates.js (a sua volta puro).
 */

import { normalizeDateValue, dateStrToTs, shouldReplaceValue } from './polizzaDates.js'

// ─── Importi "puri" ──────────────────────────────────────────────────────────

/**
 * Converte in numero SOLO una stringa che e' un importo "puro" (cifre +
 * separatori italiani, es. "4.000.000,00", "10.000", "2,5"). Restituisce null
 * se contiene altro (testo, date con "/", percentuali, sigle).
 */
export function parsePureAmount(v) {
  if (v == null) return null
  const s = String(v).trim()
  if (!/^[€\s]*\d[\d.\s]*(?:,\d+)?\s*€?$/.test(s)) return null
  const n = parseFloat(s.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// ─── Placeholder ("meglio vuoto che sbagliato") ──────────────────────────────

// Valori che i modelli piccoli scrivono al posto di OMETTERE il campo: non sono
// dati, sono l'assenza di un dato. Match SEMPRE full-string (mai substring: un
// valore legittimo che contiene "nd" deve sopravvivere), case-insensitive, dopo
// normalizzazione di spazi/virgolette.
const PLACEHOLDER_SET = new Set([
  'non specificato', 'non specificata', 'non indicato', 'non indicata',
  'non presente', 'non disponibile', 'non applicabile', 'non riportato',
  'non riportata', 'non pervenuto', 'non definito', 'non definita',
  'non trovato', 'non trovata', 'non previsto', 'non prevista',
  'n/d', 'n.d.', 'n.d', 'nd', 'n/a', 'n.a.', 'n.a', 'na',
  'null', 'none', 'nil', 'undefined',
  'nessuno', 'nessuna', 'sconosciuto', 'sconosciuta',
  'da definire', 'da compilare', 'da verificare',
  'vuoto', 'assente', 'mancante',
  'x', 'xxx', '?', '??', '???', '...',
])

/** true se il valore e' un placeholder di assenza-dato e va scartato. */
export function isPlaceholderValue(raw) {
  if (raw == null) return true
  let v = String(raw).trim()
  // Virgolette/parentesi di contorno + spazi interni multipli
  v = v.replace(/^["'«»()[\]{}\s]+|["'«»()[\]{}\s]+$/g, '').replace(/\s+/g, ' ').toLowerCase()
  if (!v) return true
  if (PLACEHOLDER_SET.has(v)) return true
  if (/^[-–—_.·\s]+$/.test(v)) return true       // trattini/underscore/puntini
  if (/^vedi\s/i.test(v)) return true            // rinvio ("vedi condizioni"), non un dato
  return false
}

// ─── Checksum P.IVA / Codice Fiscale ─────────────────────────────────────────

/**
 * Partita IVA italiana: 11 cifre con cifra di controllo (variante Luhn ufficiale).
 * Rigetta anche le sequenze con le prime 10 cifre tutte uguali (es. 00000000000):
 * formalmente valide per l'algoritmo ma mai reali, tipiche di OCR/allucinazioni.
 */
export function isValidPartitaIva(s) {
  const v = String(s || '')
  if (!/^\d{11}$/.test(v)) return false
  if (/^(\d)\1{9}/.test(v)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const d = v.charCodeAt(i) - 48
    if (i % 2 === 0) sum += d                    // posizioni dispari (1-based)
    else { const y = 2 * d; sum += y > 9 ? y - 9 : y }
  }
  return (10 - (sum % 10)) % 10 === (v.charCodeAt(10) - 48)
}

// Tabelle ufficiali del carattere di controllo del Codice Fiscale.
const CF_ODD = {
  0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21,
  K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14,
  U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
}
const CF_EVEN = {
  0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9,
  A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9,
  K: 10, L: 11, M: 12, N: 13, O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19,
  U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
}
// Struttura del CF con supporto omocodia (cifre sostituibili da LMNPQRSTUV).
const CF_STRUCTURE_RE =
  /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/

/** Codice Fiscale italiano (16 caratteri): struttura + carattere di controllo. */
export function isValidCodiceFiscale(s) {
  const v = String(s || '').toUpperCase()
  if (v.length !== 16 || !CF_STRUCTURE_RE.test(v)) return false
  let sum = 0
  for (let i = 0; i < 15; i++) {
    const c = v[i]
    sum += (i % 2 === 0) ? CF_ODD[c] : CF_EVEN[c] // i pari (0-based) = posizioni dispari
  }
  return String.fromCharCode(65 + (sum % 26)) === v[15]
}

// Confusioni OCR tipiche lettera→cifra, usate SOLO per riparare candidati P.IVA
// (dove ogni carattere dev'essere una cifra). Mai applicate al CF: li' le lettere
// sono legittime.
const OCR_DIGIT_REPAIR = { O: '0', o: '0', I: '1', i: '1', l: '1', S: '5', s: '5', B: '8' }

/**
 * Valida e normalizza il valore del campo codice_fiscale_iva.
 * @returns {string|null} P.IVA (11 cifre) o CF (16 char) VALIDATI col checksum,
 *   altrimenti null ("meglio vuoto che sbagliato"). Un tentativo di riparazione
 *   OCR (O→0, I/l→1, S→5, B→8) e' ammesso solo se il risultato passa il checksum.
 */
export function validateCodiceFiscaleIva(raw) {
  const compact = String(raw || '').replace(/[\s.\-]/g, '').toUpperCase()
  if (!compact) return null
  if (/^\d{11}$/.test(compact)) return isValidPartitaIva(compact) ? compact : null
  // Casella modulistica a 16 caratteri (formato CF) riempita con ZERI davanti a
  // una P.IVA a 11 cifre — visto sul campo: "0000000151510344" = 00000 + 00151510344.
  // Se il prefisso oltre le ultime 11 cifre e' tutto zeri e le 11 finali passano
  // il checksum, il valore pulito e' quella P.IVA.
  if (/^\d{12,16}$/.test(compact) && /^0+$/.test(compact.slice(0, -11))) {
    const tail = compact.slice(-11)
    if (isValidPartitaIva(tail)) return tail
  }
  if (compact.length === 16) return isValidCodiceFiscale(compact) ? compact : null
  if (compact.length === 11) {
    const repaired = compact.split('').map((c) => OCR_DIGIT_REPAIR[c] ?? c).join('')
    if (/^\d{11}$/.test(repaired) && isValidPartitaIva(repaired)) return repaired
  }
  return null
}

// ─── Classificazione campi e documenti ───────────────────────────────────────

/** Campo "strutturale" (massimali/franchigie/scoperti/attivita'/garanzie…): vive
 *  in polizza/appendici/condizioni, MAI in quietanze/regolazioni. */
export function isStructuralField(field) {
  const s = `${field?.id || ''} ${field?.label || ''} ${field?.description || ''}`
  return /massimal|franchig|scopert|attivit|prodott|qualific|garanz/i.test(s)
}

/** Campo economico-periodico (premi/tassi/imposte/importi): cambia ogni anno,
 *  vive nel documento periodico piu' recente. */
export function isPeriodicEconomicField(field) {
  if (isStructuralField(field)) return false
  const s = `${field?.id || ''} ${field?.label || ''}`
  return /premio|tasso|imposta|importo|parametro|preventiv/i.test(s)
}

/** true se il NOME file e' di un documento periodico (quietanza/regolazione). */
export function isPeriodicDocName(name) {
  return /quietanz|regolazion/i.test(String(name || ''))
}

/**
 * Partiziona i campi attivi nei tre gruppi del motore a stadi.
 * I campi non classificabili finiscono in "anagrafica" (contesto piu' sicuro).
 */
export function partitionFields(activeFields) {
  const strutturali = [], economici = [], anagrafica = []
  for (const f of activeFields || []) {
    if (isStructuralField(f)) strutturali.push(f)
    else if (isPeriodicEconomicField(f)) economici.push(f)
    else anagrafica.push(f)
  }
  return { strutturali, economici, anagrafica }
}

// ─── Verifica di evidenza ────────────────────────────────────────────────────

/**
 * Normalizzazione aggressiva per il confronto testuale: minuscole, senza
 * diacritici, solo [a-z0-9]. Uccide il rumore OCR di spazi/punteggiatura/case.
 */
export function normForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

// Token alfanumerici (≥3 char, senza diacritici) di un valore, per la copertura.
function matchTokens(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)
}

/**
 * Verifica che un valore estratto sia davvero ancorato al TESTO inviato al
 * modello ("meglio vuoto che sbagliato", ma tarata per non scartare le semplici
 * riformattazioni).
 *
 * @param {object} field    definizione campo (per type 'date')
 * @param {string} cleaned  valore gia' sanitizzato
 * @param {object} entry    entry del modello (per l'evidenza)
 * @param {string} normCtx  normForMatch() del contesto ESATTO inviato al modello
 * @returns {boolean} true = il valore e' supportato dal testo
 */
export function passesStagedEvidence(field, cleaned, entry, normCtx) {
  const evidenza = (entry && typeof entry === 'object' && typeof entry.evidenza === 'string' && entry.evidenza.trim())
    ? entry.evidenza.trim() : null

  // Date PRIMA degli importi: "31.12.2025" è fatta di cifre e punti e passerebbe
  // per un importo, ma se l'intera stringa è una data va giudicata come data.
  // Le cifre GGMMAAAA devono comparire nel contesto normalizzato.
  const asDate = normalizeDateValue(cleaned)
  if (asDate) {
    if (normCtx.includes(asDate.replace(/\//g, ''))) return true
    if (evidenza) {
      const ne = normForMatch(evidenza)
      if (ne && normCtx.includes(ne) && ne.includes(asDate.slice(-4))) return true
    }
    return false
  }

  // Importi: verifica SIMMETRICA.
  // (a) Le cifre della parte intera compaiono nel CONTESTO → il valore è ancorato
  //     al testo: passa anche SENZA evidenza (i modelli piccoli omettono spesso la
  //     chiave "evidenza": punire un valore vero per una chiave mancante svuotava
  //     interi gruppi di massimali/premi).
  // (b) Cifre NON nel contesto → serve un'evidenza che le contenga E che sia a sua
  //     volta contenuta nel contesto (un'evidenza fabbricata auto-coerente non
  //     basta più a far passare un importo inventato).
  const amount = parsePureAmount(cleaned)
  if (amount != null) {
    const intDigits = String(Math.trunc(Math.abs(amount)))
    if (intDigits.length >= 4) {
      if (normCtx.includes(intDigits)) return true
      if (!evidenza) return false
      if (!evidenza.replace(/\D/g, '').includes(intDigits)) return false
      const ne = normForMatch(evidenza)
      return ne.length >= 10 && normCtx.includes(ne)
    }
    if (evidenza) {
      const ne = normForMatch(evidenza)
      if (ne.length >= 15 && !normCtx.includes(ne)) return false
    }
    return true
  }

  // Testi: containment normalizzato, poi copertura token ≥80% (le riformattazioni
  // del modello — case, punteggiatura, ordine minore — non vanno punite)
  const nv = normForMatch(cleaned)
  if (nv.length >= 4) {
    if (normCtx.includes(nv)) return true
    const tokens = matchTokens(cleaned)
    if (tokens.length > 0) {
      const covered = tokens.filter((t) => normCtx.includes(t)).length
      return covered >= Math.ceil(tokens.length * 0.8)
    }
    return false
  }
  // Valori cortissimi: serve l'evidenza, e deve stare nel contesto
  const ne = evidenza ? normForMatch(evidenza) : ''
  return !!ne && normCtx.includes(ne)
}

// ─── Recenza dei candidati ("il piu' recente vince, mai first-found") ────────

// Priorita' (rank più basso = preferito) del TIPO documento per genere di campo,
// usata SOLO quando le date non decidono (assenti o uguali).
const KIND_PRIORITY = {
  anagrafica: { appendice: 0, polizza: 1, altro: 2, condizioni: 3, quietanza: 4, regolazione: 4 },
  economici: { regolazione: 0, quietanza: 1, appendice: 2, polizza: 3, altro: 4, condizioni: 5 },
  strutturali: { appendice: 0, polizza: 1, condizioni: 2, altro: 3, quietanza: 9, regolazione: 9 },
}

/** Tabella di priorita' dei tipi documento per un genere di campo. */
export function docKindPriority(kind) {
  return KIND_PRIORITY[kind] || KIND_PRIORITY.anagrafica
}

/**
 * Sceglie tra il candidato corrente e uno nuovo secondo la regola vincolante
 * "il documento piu' recente vince" — MAI per ordine di inserimento.
 *
 * 1. Date effettive diverse (o una sola presente) → decide shouldReplaceValue:
 *    un valore DATATO non viene mai sostituito da uno non datato o piu' vecchio.
 * 2. Date pari o entrambe assenti → priorita' del tipo documento per il genere
 *    di campo; tra due appendici vince l'ordinale ("appendice 12" > "appendice 8").
 * 3. Ultima risorsa, esplicita e deterministica: posizione originale piu' bassa.
 *
 * @param {object} cur  { valore, effDate, docType, appendixOrd, docPos, ... }
 * @param {object} cand idem
 * @param {'anagrafica'|'strutturali'|'economici'} kind
 * @returns {object} il candidato vincente
 */
export function pickMoreRecentCandidate(cur, cand, kind) {
  if (!cur) return cand
  if (!cand) return cur
  const curTs = dateStrToTs(cur.effDate)
  const candTs = dateStrToTs(cand.effDate)
  if (curTs !== candTs) {
    return shouldReplaceValue(cur.effDate, cand.effDate) ? cand : cur
  }
  const prio = docKindPriority(kind)
  const a = prio[cur.docType] ?? 9
  const b = prio[cand.docType] ?? 9
  if (a !== b) return b < a ? cand : cur
  const ordA = cur.appendixOrd, ordB = cand.appendixOrd
  if (ordA !== ordB) return (ordB ?? -1) > (ordA ?? -1) ? cand : cur
  return (cand.docPos ?? Infinity) < (cur.docPos ?? Infinity) ? cand : cur
}
