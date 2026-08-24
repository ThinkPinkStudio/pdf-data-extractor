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

// Distanza di Levenshtein con TETTO: appena la distanza minima possibile supera
// `cap` ritorna cap+1 (non serve il valore esatto, solo "entro il tetto o no").
function boundedLevenshtein(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < rowMin) rowMin = cur[j]
    }
    if (rowMin > cap) return cap + 1
    prev = cur
  }
  return prev[b.length]
}

/**
 * Riconduce una chiave della risposta del modello a uno degli id campo
 * RICHIESTI anche se il modello l'ha storpiata di 1-2 caratteri.
 *
 * Visto in produzione (qwen2.5 q4, Stadio E): risposta con chiave
 * "311ac411-…" per il campo "311ac415-…" — un valore VALIDO buttato via
 * perché la chiave non combaciava. I modelli piccoli ricopiano male gli id
 * lunghi (UUID); il refuso è dell'id, non del dato.
 *
 * Prudenza: match esatto prima di tutto; fuzzy SOLO su chiavi lunghe (≥8),
 * distanza ≤2, e SOLO se il candidato è UNIVOCO — due id compatibili → null
 * (meglio scartare che attribuire al campo sbagliato).
 */
export function matchFieldKey(key, ids) {
  const k = String(key || '')
  if (!k) return null
  if (ids.includes(k)) return k
  if (k.length < 8) return null
  let best = null
  for (const id of ids) {
    if (String(id).length < 8) continue
    if (boundedLevenshtein(k, String(id), 2) <= 2) {
      if (best) return null // ambiguo: mai tirare a indovinare tra due campi
      best = id
    }
  }
  return best
}

/**
 * Rimuove dalla descrizione di un campo SOLO l'esempio, lasciando intatto tutto
 * ciò che viene dopo.
 *
 * Bug visto sul campo: la vecchia regola tagliava da ", es. …" fino a FINE RIGA,
 * e le descrizioni sono scritte su una riga sola — così metà istruzione spariva
 * sia dal prompt sia dal vettore di affinità. Su "Parametro regolazione" restava
 * «…la dicitura che contiene 'Retribuzioni' (oppure Salari, Fatturato, Ricavi)»
 * e si perdeva il «VIETATO restituire da sole le parole 'Consuntivo'… ometti il
 * campo»: il modello rispondeva con l'intestazione di colonna nuda.
 */
export function stripFieldExamples(desc) {
  return String(desc || '')
    // "(es. …)": l'esempio è tutto e solo dentro le parentesi
    .replace(/\s*\(\s*es\.[^)]*\)/gi, '')
    // "es. '…'" / «es. "…"»: l'esempio finisce con la citazione CHIUSA
    .replace(/[,;:]?\s*\bes\.\s*['"«][^'"»\n]*['"»]/gi, '')
    // "es. …" senza virgolette: finisce alla prima fine di FRASE — punto o
    // punto-e-virgola seguito da spazio/fine testo. Il punto interno a un
    // importo ("3.000.000,00") è seguito da una cifra, quindi non conta.
    .replace(/[,;:]?\s*\bes\.\s[^\n]*?(?=[.;](?:\s|$)|$)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Indice per la ricerca NORMALIZZATA dentro un testo: `norm` è il testo ridotto
 * a [a-z0-9] e `map[i]` è l'indice nel testo GREZZO del carattere normalizzato
 * i-esimo. Serve a trovare un valore ignorando maiuscole, accenti, spazi e
 * punteggiatura (il rumore tipico dell'OCR) risalendo comunque al testo vero.
 */
export function buildNormIndex(text) {
  const src = String(text || '')
  let norm = ''
  const map = []
  for (let i = 0; i < src.length; i++) {
    const lower = src[i].toLowerCase()
    // fast path: la grande maggioranza dei caratteri è già [a-z0-9]
    const kept = ((lower >= 'a' && lower <= 'z') || (lower >= '0' && lower <= '9'))
      ? lower : normForMatch(lower)
    if (!kept) continue
    norm += kept
    for (let k = 0; k < kept.length; k++) map.push(i)
  }
  return { text: src, norm, map }
}

/**
 * Finestra di testo GREZZO (±span char) attorno alla prima occorrenza del valore
 * — o, in mancanza, dell'evidenza — dentro il documento sorgente. È il contesto
 * su cui l'arbitro semantico misura l'affinità con la descrizione del campo.
 *
 * La ricerca avviene sul testo NORMALIZZATO: prima bastava una maiuscola diversa
 * ("Acqui Terme" invece di "ACQUI TERME") perché la finestra non si trovasse,
 * l'affinità risultasse `null` e l'arbitro — cieco su entrambi i lati — ricadesse
 * sulla sola recency. Metà dei candidati testuali finiva così.
 *
 * @param {string|{norm:string,map:number[],text:string}} docText testo o indice
 * @returns {string|null} finestra di testo grezzo, o null se il valore non c'è
 */
export function findValueWindow(docText, value, evidenza, span = 200) {
  const idx = (docText && typeof docText === 'object' && Array.isArray(docText.map))
    ? docText : buildNormIndex(docText)
  const { text, norm, map } = idx
  if (!text || !norm) return null
  const cut = (at, len) => {
    const start = map[at]
    const end = map[Math.min(norm.length - 1, at + len - 1)] + 1
    return text.slice(Math.max(0, start - span), Math.min(text.length, end + span))
  }
  for (const needle of [value, evidenza]) {
    const nn = normForMatch(needle)
    if (nn.length < 3) continue
    const at = norm.indexOf(nn)
    if (at !== -1) return cut(at, nn.length)
    // Importi/date: le cifre sono l'ancora, i separatori li mette l'OCR
    const digits = nn.replace(/\D/g, '')
    if (digits.length < 3) continue
    const atD = norm.indexOf(digits)
    if (atD !== -1) return cut(atD, digits.length)
  }
  return null
}

// ─── Guardie di merge (visti sul campo: run EULIP 18:24) ─────────────────────
// La regola "il documento più recente vince" è giusta quando il documento nuovo
// RIDEFINISCE davvero il campo (rinnovo con nuovi massimali). Ma un batch di sole
// appendici, interrogato su 10 campi, propone numeri qualsiasi (sub-limiti,
// franchigie, premi) che passano l'evidenza perché ESISTONO nel testo — e da
// documenti "più recenti" della polizza non datata sovrascrivevano i valori
// giusti del frontespizio (massimale 4.000.000 → "€. 10.000"). Queste guardie
// pure decidono quando un candidato NON può sostituire un valore esistente.

// Parse permissivo di importo (accetta anche "€. 10.000,00" e testo attorno).
export function looseAmount(v) {
  const m = String(v == null ? '' : v).match(/\d[\d.\s]*(?:,\d+)?/)
  if (!m) return null
  const n = parseFloat(m[0].replace(/[\s.]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

// Stemmi "forti" (≥5 char, troncati a 7) di etichetta+id del campo: per capire se
// il testo attorno al valore parla DAVVERO di quel campo.
export function fieldLabelStems(field) {
  const words = `${field?.label || ''} ${String(field?.id || '').replace(/[_-]+/g, ' ')}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 5)
  return [...new Set(words.map((w) => w.slice(0, 7)))]
}

/**
 * true se ALMENO un'occorrenza del valore nel testo del documento ha, entro
 * `span` caratteri (nel testo normalizzato), uno stem dell'etichetta del campo.
 * false anche quando il valore non compare affatto nel testo.
 */
export function hasLabelEvidenceNear(docText, value, field, span = 200) {
  const norm = normForMatch(docText)
  const nv = normForMatch(value)
  if (!norm || !nv || nv.length < 3) return false
  const stems = fieldLabelStems(field)
  if (!stems.length) return true // etichetta senza parole forti: guardia non applicabile
  let idx = norm.indexOf(nv)
  while (idx !== -1) {
    const win = norm.slice(Math.max(0, idx - span), idx + nv.length + span)
    if (stems.some((s) => win.includes(s))) return true
    idx = norm.indexOf(nv, idx + 1)
  }
  return false
}

/**
 * Override SOSPETTO di un campo strutturale già valorizzato.
 * - massimali: un massimale non crolla mai al di sotto del 20% del valore
 *   corrente per via di un rinnovo (4.000.000 → 10.000 è un sub-limite pescato
 *   male da una clausola);
 * - tutti: il nuovo documento deve parlare del campo vicino al valore
 *   (stem dell'etichetta entro la finestra), altrimenti non lo sta ridefinendo.
 * @returns {boolean} true = rifiutare il candidato, tenere il valore esistente
 */
export function isSuspectStructuralOverride(field, oldValue, newValue, newDocText) {
  const isMassimale = /massimal/i.test(`${field?.id || ''} ${field?.label || ''}`)
  if (isMassimale) {
    const oldAmt = looseAmount(oldValue)
    const newAmt = looseAmount(newValue)
    if (oldAmt != null && newAmt != null && newAmt < oldAmt * 0.2) return true
  }
  if (newDocText && !hasLabelEvidenceNear(newDocText, newValue, field)) return true
  return false
}

/**
 * ARBITRO SEMANTICO del merge — agnostico rispetto ai campi: niente classi a
 * parole chiave, decide l'AFFINITÀ tra la descrizione del campo e il contesto
 * attorno al valore nel documento sorgente (calcolata dal chiamante, embeddings
 * o fallback lessicale, su cand.affinity ∈ [0,1] o null se non calcolabile).
 *
 * Regole, in ordine:
 * 1. collasso numerico: un candidato che riduce un valore numerico di oltre
 *    l'80% passa SOLO con affinità nettamente superiore (un sub-limite pescato
 *    da una clausola non sostituisce un massimale, un conguaglio non sostituisce
 *    un premio annuo — vale per QUALUNQUE campo numerico);
 * 2. affinità nettamente diversa (Δ > margin): vince la più alta, anche contro
 *    la recency (il consuntivo della regolazione perde sul campo la cui
 *    descrizione parla di preventivo, ovunque stia la data);
 * 3. affinità comparabili (o non calcolabili): decide la RECENCY — i dati nuovi
 *    sovrascrivono i vecchi, regola invariata.
 */
export function pickSemanticCandidate(oldC, newC, kind, opts = {}) {
  // Margini ASIMMETRICI e prudenti — tarati sul campo: con margine unico 0.06
  // il rumore degli embeddings su finestre corte/numeriche RIBALTAVA la recency
  // nella direzione sbagliata (premio totale preso dalla regolazione invece che
  // dalla quietanza più recente). L'affinità decide SOLO con segnale forte:
  // - promuovere contro la recency richiede Δ > 0.15;
  // - vetare un override richiede Δ > 0.10;
  // - altrimenti comanda la RECENCY, come nel comportamento migliore osservato.
  const promoteMargin = opts.promoteMargin ?? 0.15
  const vetoMargin = opts.vetoMargin ?? 0.10
  if (!oldC) return newC
  if (!newC) return oldC
  const a0 = typeof oldC.affinity === 'number' ? oldC.affinity : null
  const a1 = typeof newC.affinity === 'number' ? newC.affinity : null
  const o = looseAmount(oldC.valore)
  const n = looseAmount(newC.valore)
  const collapse = o != null && n != null && o > 0 && n < o * 0.2
  if (collapse && !(a0 != null && a1 != null && a1 - a0 > promoteMargin)) return oldC
  if (a0 != null && a1 != null) {
    if (a1 - a0 > promoteMargin) return newC
    if (a0 - a1 > vetoMargin) return oldC
  }
  return pickMoreRecentCandidate(oldC, newC, kind)
}

// Valore di "attività assicurata" che è un RINVIO o una parafrasi della domanda
// ("l'attività per la quale è prestata l'assicurazione") invece della
// descrizione concreta: una vera attività non parla di assicurazione/polizza.
export function isRinvioAttivita(value) {
  const v = String(value || '').trim()
  if (v.length < 12) return true
  // NB: \w non matcha le lettere accentate ("attività") → \S*
  return /assicurazion|assicurat|polizz|garanz|per la quale|di cui (?:alla|sopra)|indicat[ao] (?:in|nella)|descritt[ao] (?:in|nella)|attivit\S*\s+(?:della|del|di)\s+(?:spett|ditta|contraente|azienda)/i.test(v)
}

// Valore di "agenzia" che in realtà è la denominazione della COMPAGNIA
// (forma societaria/marchio assicurativo): l'agenzia vera è una piazza
// ("MILANO 901", "AGENZIA DI ACQUI TERME"), mai una società per azioni.
export function isCompanyNameAsAgency(value) {
  return /\bs\.?\s*p\.?\s*a\b|\bs\.?\s*r\.?\s*l\b|societa|società|\bassicurazioni\b|\bcompagnia\b/i.test(String(value || ''))
}

// P.IVA/CF che nel documento sorgente compare SOLO nel footer societario della
// compagnia (Sede legale… Registro Imprese… Capitale Sociale… IVASS): è
// l'identità dell'assicuratore, mai quella del contraente.
const INSURER_FOOTER_RE = /sede\s+legale|capitale\s+sociale|impresa\s+autorizzata|registro\s+(?:delle\s+)?imprese|ivass|direzione\s+e\s+coordinamento|r\.?\s*e\.?\s*a\.?\s*n/i
export function isInsurerFooterPIva(docText, value) {
  const text = String(docText || '')
  const digits = String(value || '').replace(/\D/g, '')
  if (!text || digits.length < 10) return false
  let found = false
  // Occorrenze del valore anche con separatori OCR in mezzo (spazi/punti)
  const re = new RegExp(digits.split('').join('[\\s.]?'), 'g')
  for (const m of text.matchAll(re)) {
    found = true
    const around = text.slice(Math.max(0, m.index - 200), m.index + m[0].length + 120)
    if (!INSURER_FOOTER_RE.test(around)) return false // almeno un'occorrenza "pulita"
  }
  return found // trovato, e SOLO in contesto footer
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
    if (!tokens.length) return false
    const hit = tokens.filter((t) => normCtx.includes(t))
    // TOLLERANZA OCR (visto sul campo): su una scansione almeno una parola per
    // riga esce storpiata — "olii" letto "olti" — e il modello, che la corregge,
    // veniva punito come se avesse inventato tutto: l'attività assicurata
    // «produzione di olii e grassi vegetali» finiva scartata come senza-evidenza
    // e il campo restava a un valore qualsiasi di un altro documento.
    // Si concede UNA parola non trovata (mai più di una su cinque), ma solo se
    // le parole trovate coprono la MAGGIORANZA dei caratteri del valore: una
    // sola parola in comune non basta mai a far passare un valore inventato.
    if (tokens.length >= 3 && hit.length >= tokens.length - Math.max(1, Math.floor(tokens.length * 0.2))) {
      const chars = tokens.reduce((n, t) => n + t.length, 0)
      const hitChars = hit.reduce((n, t) => n + t.length, 0)
      if (hitChars >= chars * 0.6) return true
    }
    return hit.length >= Math.ceil(tokens.length * 0.8)
  }
  // Valori cortissimi: serve l'evidenza, e deve stare nel contesto
  const ne = evidenza ? normForMatch(evidenza) : ''
  return !!ne && normCtx.includes(ne)
}

// ─── Recenza dei candidati ("il piu' recente vince, mai first-found") ────────

// NB: la vecchia tabella di priorità per TIPO documento (KIND_PRIORITY) è
// stata RIMOSSA per decisione definitiva: ogni dato può stare in qualsiasi
// tipologia di file, i documenti sono tutti uguali. A pari data lo spareggio
// è la somiglianza lessicale col testo della descrizione del campo (`lex`).

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
  // PARI DATA — DECISIONE DEFINITIVA (mai più logiche per tipo documento):
  // ogni dato può stare in qualsiasi file, i documenti sono TUTTI UGUALI.
  // Lo spareggio è la somiglianza LESSICALE tra il contesto attorno al valore
  // e la DESCRIZIONE del campo (deterministica, portata dal candidato in
  // `lex`): le parole le decide l'utente nelle descrizioni — cambiano quelle,
  // cambia lo spareggio. Es.: descrizione con "di cui imposta della quietanza"
  // → vince la finestra che contiene quelle parole, di qualunque file sia.
  const lexA = typeof cur.lex === 'number' ? cur.lex : null
  const lexB = typeof cand.lex === 'number' ? cand.lex : null
  if (lexA != null && lexB != null && lexA !== lexB) return lexB > lexA ? cand : cur
  const ordA = cur.appendixOrd, ordB = cand.appendixOrd
  if (ordA !== ordB) return (ordB ?? -1) > (ordA ?? -1) ? cand : cur
  return (cand.docPos ?? Infinity) < (cur.docPos ?? Infinity) ? cand : cur
}

// ─── Validazione cross-field (post-LLM) ──────────────────────────────────────

function entryValore(best, id) {
  const e = best?.[id]
  if (e == null) return null
  if (typeof e === 'object' && !Array.isArray(e) && 'valore' in e) return e.valore
  return e
}

function dropField(best, id, notes, reason) {
  if (!id || !(id in best)) return
  notes.push(reason)
  delete best[id]
}

function fieldBlob(f) {
  return `${f?.id || ''} ${f?.label || ''} ${f?.description || ''}`
}

/**
 * Coerenza tra campi già estratti. Mutates `best` (stesso oggetto del motore a
 * stadi: { id: { valore } } oppure mappa piatta id → stringa).
 * Regola: meglio VUOTO che un valore logicamente impossibile.
 *
 * @param {object} best
 * @param {Array} fields  definizioni campo attive
 * @param {{ hasAnnualPeriodics?: boolean }} [opts]
 * @returns {string[]} note diagnostiche (una per drop)
 */
export function validateCrossFields(best, fields, opts = {}) {
  const notes = []
  if (!best || typeof best !== 'object') return notes
  const list = Array.isArray(fields) ? fields : []

  // ── Decorrenza / scadenza ────────────────────────────────────────────────
  const decField = list.find((f) => /decorrenz|data\s+(?:di\s+)?inizio|\beffetto\b/i.test(fieldBlob(f)))
  const scaField = list.find((f) => /scadenz|data\s+(?:di\s+)?fine/i.test(fieldBlob(f)))
  const decTs = decField ? dateStrToTs(normalizeDateValue(entryValore(best, decField.id))) : null
  const scaTs = scaField ? dateStrToTs(normalizeDateValue(entryValore(best, scaField.id))) : null
  if (decField && scaField && decTs != null && scaTs != null) {
    const THIRTEEN_MONTHS = 400 * 24 * 3600 * 1000
    if (decTs >= scaTs) {
      dropField(best, decField.id, notes,
        `Coerenza date: decorrenza ${entryValore(best, decField.id)} ≥ scadenza ${entryValore(best, scaField.id)} → decorrenza svuotata (impossibile)`)
    } else if (opts.hasAnnualPeriodics && scaTs - decTs > THIRTEEN_MONTHS) {
      dropField(best, decField.id, notes,
        `Coerenza date: decorrenza ${entryValore(best, decField.id)} incoerente con scadenza ${entryValore(best, scaField.id)} su polizza a rate annuali → decorrenza svuotata (meglio vuoto che sbagliato)`)
    }
  }

  // ── Massimali per prefisso (rct_ / rcp_ / custom) ─────────────────────────
  const massGroups = new Map()
  for (const f of list) {
    const m = String(f.id || '').match(/^(.*)_massimale_(sinistro|annuo|persona|danni|prestatore|mat|interr)$/)
    if (!m) continue
    const g = massGroups.get(m[1]) || {}
    g[m[2]] = f
    massGroups.set(m[1], g)
  }
  for (const [prefix, g] of massGroups) {
    const amt = (role) => {
      const f = g[role]
      return f ? looseAmount(entryValore(best, f.id)) : null
    }
    const annuo = amt('annuo')
    const sinistro = amt('sinistro')
    if (g.annuo && g.sinistro && annuo != null && sinistro != null && annuo < sinistro) {
      dropField(best, g.annuo.id, notes,
        `Coerenza massimali ${prefix}: annuo ${entryValore(best, g.annuo.id)} < sinistro ${entryValore(best, g.sinistro.id)} → annuo svuotato (impossibile)`)
    }
    const afterSinistro = amt('sinistro') // può essere invariato
    for (const role of ['persona', 'danni']) {
      const sub = amt(role)
      if (g[role] && afterSinistro != null && sub != null && sub > afterSinistro) {
        dropField(best, g[role].id, notes,
          `Coerenza massimali ${prefix}: ${role} ${entryValore(best, g[role].id)} > sinistro ${entryValore(best, g.sinistro.id)} → ${role} svuotato`)
      }
    }
  }

  // ── Premio totale ≈ imponibile + imposta (stesso prefisso RCT/RCP) ────────
  const triples = new Map()
  for (const f of list) {
    const id = String(f.id || '')
    let role = null
    let prefix = null
    if (/premio_imponibile$/.test(id)) { role = 'imponibile'; prefix = id.replace(/_?premio_imponibile$/, '') }
    else if (/premio_totale$/.test(id)) { role = 'totale'; prefix = id.replace(/_?premio_totale$/, '') }
    else if (/_imposta$/.test(id) || id === 'imposta') { role = 'imposta'; prefix = id.replace(/_?imposta$/, '') }
    if (!role) continue
    prefix = prefix || '_'
    const slot = triples.get(prefix) || {}
    slot[role] = f
    triples.set(prefix, slot)
  }
  for (const [prefix, t] of triples) {
    if (!t.totale || !t.imponibile || !t.imposta) continue
    if (!(t.totale.id in best) || !(t.imponibile.id in best) || !(t.imposta.id in best)) continue
    const tot = parsePureAmount(entryValore(best, t.totale.id)) ?? looseAmount(entryValore(best, t.totale.id))
    const imp = parsePureAmount(entryValore(best, t.imponibile.id)) ?? looseAmount(entryValore(best, t.imponibile.id))
    const tax = parsePureAmount(entryValore(best, t.imposta.id)) ?? looseAmount(entryValore(best, t.imposta.id))
    if (tot == null || imp == null || tax == null) continue
    const sum = imp + tax
    const tol = Math.max(1, Math.abs(tot) * 0.02)
    if (Math.abs(tot - sum) > tol) {
      dropField(best, t.totale.id, notes,
        `Coerenza premio ${prefix}: totale ${entryValore(best, t.totale.id)} ≠ imponibile+imposta ${imp}+${tax} → totale svuotato`)
    }
  }

  return notes
}
