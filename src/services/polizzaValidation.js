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
import { fieldKind, autoKind, fieldNatura } from './polizzaFieldKind.js'

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

/** true se il valore e' un placeholder di assenza e va scartato. */
export function isPlaceholderValue(raw) {
  if (raw == null) return true
  let v = String(raw).trim()
  v = v.replace(/^["'«»()[\]{}\s]+|["'«»()[\]{}\s]+$/g, '').replace(/\s+/g, ' ').toLowerCase()
  if (!v) return true
  if (PLACEHOLDER_SET.has(v)) return true
  if (/^[-–—_.·\s]+$/.test(v)) return true       // trattini/underscore/puntini
  if (/^vedi\s/i.test(v)) return true            // rinvio ("vedi condizioni"), non un caso
  return false
}

/**
 * true se il valore è un IDENTIFICATIVO alfanumerico SPORCO (garbage OCR).
 * Un numero di polizza/proposta/preventivo è una stringa alfanumerica pulita
 * (lettere+cifre, al più `-`/`.`). Un candidato che contiene:
 *   - più di 1 carattere NON-alfanumerico ADIACENTE IDENTICO di fila (`]]`,
 *     `((`, `--`, `||`…), tipici artefatti OCR/font "corsivo" — o
 *   - meno del 70% di caratteri alfanumerici,
 * è spazzatura (visto sul campo: "3ROL]]D" per un vero RCM20100036608) e va
 * scartato: meglio il vuoto che un numero inventato/illeggibile.
 * "Le regole scelgono, non inventano": non si modifica il garbage rischiando di
 * inventare, si scarta e si lascia decidere il candidato valido se ce n'è uno.
 * @param {*} raw
 * @returns {boolean} true = identifier garbage da rifiutare
 */
export function isGarbageIdentifier(raw) {
  if (raw == null) return false
  const s = String(raw).trim()
  if (!s) return false
  // più di 1 carattere non-alfanumerico ADIACENTE identico ("]]", "((", "--")
  if (/([^A-Za-z0-9])\1{1,}/.test(s)) return true
  const total = s.length
  const alnum = (s.match(/[A-Za-z0-9]/g) || []).length
  if (total === 0) return false
  if (alnum / total <= 0.7) return true
  return false
}

// ─── Anti-LABEL (generalizzazione) ──────────────────────────────────────────
// Il modello copia le INTESTAZIONI di sezione come valore del campo (visto nel
// fascicolo A/B): "IL CONTRAENTE" (pagina "il contraente" invece della ragione
// sociale), "Contratto di Assicurazione per la Responsabilità Civile". Sono
// pattern TESTUALI documentali — le parole della sezione, non il dato. Il match
// è SEMPRE full-string normalizzati (mai substring: un valore legittimo che
// contiene "la contraente" deve sopravvivere).
const ANTI_LABEL_PATTERNS = [
  /\bil\s+contraente\b/,
  /\bl[’']?assicurato\b/,
  /\bignorant\b.*\bcontraente\b/,
  /\bcontratto\s+di\s+assicurazione\b/,
  /\bpolizza\s+di\s+assicurazione\b/,
  /\bramo\s+di\s+competenza\b/,
  /\bcentri\s+diagnostici\b/,        // etichetta di sezione, non attività specifica
  /^(?:sezione|garanzia|estensione)s?\b/,
  /\bscoperto\s+generale\b/,
  /\btacito\s+rinnovo\b/,
  /\bfrazionamento\b/,
  /\besclusioni\b/,
  /\bcondizioni\s+particolari\b/,
  /\bfranchigia\s+(?:base|frontale)\b/,
  /\bmassimale\s+annuo\b/,
  /\bmassimale\s+per\s+sinistro\b/,
  // intestazioni TUTTO MAIUSCOLE: dentro un valore, una frase maiuscola con 3+
  // parole e ≥1 parola ≥6 char è un heading, non un dato
]
/**
 * true se il valore sembra UN'INTESTAZIONE/LABEL di sezione piuttosto che un
 * dato estratto: il modello l'ha copiato perché stava in una sezione dedicata.
 * Match FULL-STRING sul testo normalizzato (case/diacritici insensibili, ma
 * parole separate da spazio preservate → i \s+ dei pattern funzionano).
 */
export function isLabelLikeValue(raw) {
  if (raw == null) return false
  const v = String(raw).trim()
  if (!v || v.length < 4) return false
  // normalizzazione che PRESERVA le parole (spazi collassati, diacritici via)
  const norm = v.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!norm) return false
  // heading tutto maiuscolo: ≥3 parole e ≥1 parola lunga ≥6 tra quelle
  // maiuscole nell'originale (un'intestazione di sezione, non un dato)
  const words = v.split(/\s+/).filter(Boolean)
  if (words.length >= 3) {
    const upperLong = words.filter((w) => /^[A-ZÀ-Ý]+$/.test(w) && w.length >= 6)
    if (upperLong.length && upperLong.length >= words.length * 0.5) return true
  }
  for (const p of ANTI_LABEL_PATTERNS) {
    if (p.test(norm)) return true
  }
  return false
}

/**
 * true SOLO per campi la cui natura è testuale: `type` esplicito 'text' o
 * description con prefisso "TESTO" (es. "TESTO.", "TESTO (SÌ/NO)",
 * "TESTO (elenco)"). Viceversa i kind FORTI non-testuali (number → NUMERO/IMPORTO,
 * percent, date, fiscal) lo escludono; 'boolean' ed 'enum' restano testuali
 * (i valori sono parole: SÌ/NO, elenchi).
 *
 * Serve al filtro anti-0: su questi campi lo "0" è un placeholder numerico
 * inespressivo ("niente da dire"), non un dato. Su NUMERO/IMPORTO lo 0 resta
 * legittimo (es. premio, massimale).
 *
 * NB: `type: 'text'` è il DEFAULT STORICO (scritto su quasi tutti i campi già
 * salvati, senza valore semantico): per NON rompere i profili esistenti resta
 * "debole" — se manca un kind forte esplicito decide la DESCRIPTION, come prima
 * del task. I kind forti (number/percent/date/fiscal/boolean/enum) sono la
 * scelta esplicita dell'utente e vincono sulla description.
 */
export function isTextualField(field) {
  if (field == null) return false
  const hasType = field.type != null && String(field.type).trim() !== ''
  const kind = fieldKind(field)
  if (hasType && kind !== 'text') {
    return kind === 'boolean' || kind === 'enum'
  }
  if (/TESTO/.test(String(field?.description || ''))) return true
  // AUTO-KIND dalla LABEL (generalizzazione): un profilo importato senza type
  // esplicito né prefisso "TESTO…" (es. "Tacito Rinnovo", "Frazionamento",
  // "Esclusioni particolari", "Condizioni particolari") resta comunque un campo
  // testuale: lo "0" e i numeri puri lì sono placeholder, non dati. I kind forti
  // (number/date/…) dichiarati sopra hanno già vinto.
  return autoKind(field) === 'text'
}

/**
 * true se il valore è un puro placeholder numerico inespressivo per un campo
 * di TIPO TESTO: "0" (e varianti "0,00"/"0.00"/"€ 0"-style) che il modello
 * scrive al posto di omettere il campo. MAI bloccante su campi NUMERO/IMPORTO
 * (premio/massimale azzerato resta un dato legittimo).
 */
export function isTextualZeroPlaceholder(field, raw) {
  if (!isTextualField(field)) return false
  if (raw == null) return false
  const s = String(raw).trim().replace(/[€\s]/g, '')
  return /^0+(?:[.,]0+)?$/.test(s)
}

/**
 * true se il valore è un PURO NUMERO/IMPORTO/CODICE per un campo di tipo TESTO
 * — es. "13.068,00", "4", "1,2", "75,00", "00751214/001". È il segno che il
 * modello ha risposto col dato sbagliato (un importo/premio/tasso al posto
 * del testo SÌ/NO, "annuale", "retribuzioni", una descrizione): per un campo
 * TESTO un numero puro non è MAI un dato → va scartato (vuoto/"non indicato").
 *
 * MAI bloccante su campi NUMERO/IMPORTO: lì un numero è il valore legittimo.
 *
 * NB: non tocca i valori testuali che CONTENGONO cifre a parole (es. "4 persone",
 * "IVA 22%", un indirizzo con il numero civico): scarta SOLO il valore fatto di
 * sole cifre/separatori.
 */
export function isTextualNumericOnly(field, raw) {
  if (!isTextualField(field)) return false
  if (raw == null) return false
  const s = String(raw).trim()
  if (!s) return false
  if (!/^[-+]?[\d.,\s€%‰']+$/.test(s)) return false
  return parsePureAmount(s) != null
    || /^[-+]?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)
    || /^[-+]?\d+(?:[.,]\d+)?[%‰]?$/.test(s)
}

// ─── Guardia "premio da copertura diversa" ──────────────────────────────────
// Fascicolo RC PROF.LE: più coperture nello stesso fascicolo (una RC profes-
// sionale vera "01. RC PROFESSIONE SANITARIA" e una "RC INFORTUNI"; a volte anche
// "Tutela Legale" / certificati). Il merge sceglieva il premio 25,00 da RC
// INFORTUNI (affinità 0.43) invece del 61,00 della RC professionale (0.40).
// "Le regole scelgono, non inventano": il 25,00 resta valido SOLO se è davvero
// il premio RC; lo si esclude quando la FONTE è un documento di UN'ALTRA
// copertura (nome file con marcatori di altro ramo). Type-blind: guarda il nome
// del documento, non i tipi file, e solo i campi di natura PREMIO.
const OTHER_COVERAGE_DOC_RE = /(?:infortun|tutela[-\s_]*legale|certificat)/i

/** true se il NOME documento appartiene a una copertura NON di RC professionale. */
export function isOtherCoverageDocName(name) {
  const s = String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return OTHER_COVERAGE_DOC_RE.test(s)
}

/** true se il campo ha natura PREMIO (premio totale/imponibile/lordo/annuo o imposta). */
export function isPremiumField(field) {
  if (!field) return false
  // Sola label/description, MAI l'id: gli id premio (rcp_premio_imponibile,
  // rcp_imposta…) vengono RIUSATI su alcuni profili (RC PROF MED V2) con
  // significato testuale (Frazionamento / Tacito Rinnovo SÌ-NO) — lì la natura
  // non è premio. "Le regole scelgono": decide il vocabolo economico espresso.
  const blob = `${String(field?.label || '')} ${String(field?.description || '')}`
  return /premio[_\s-]?(?:totale|imponibile|lordo|annuo)/i.test(blob)
    || /\bimposta\b|\bimposte\b|\btasse\b/i.test(blob)
}

/** true se il candidato-premio deriva da un documento di copertura diversa. */
export function isOtherCoveragePremiumSource(field, sourceName) {
  if (!isPremiumField(field)) return false
  return isOtherCoverageDocName(sourceName)
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
 *  in polizza/appendici/condizioni, MAI in quietanze/regolazioni.
 *  Type-blind: SOLO label+description (l'id è un UUID senza significato). */
export function isStructuralField(field) {
  const s = `${field?.label || ''} ${field?.description || ''}`
  return /massimal|franchig|scopert|attivit|prodott|qualific|garanz/i.test(s)
}

/** Campo economico-periodico (premi/tassi/imposte/importi): cambia ogni anno,
 *  vive nel documento periodico piu' recente. Type-blind: SOLO label+description. */
export function isPeriodicEconomicField(field) {
  if (isStructuralField(field)) return false
  const s = `${field?.label || ''} ${field?.description || ''}`
  return /premio|tasso|imposta|importo|parametro|preventiv/i.test(s)
}

/**
 * true se il NOME file e' di un documento periodico (quietanza/regolazione).
 *
 * NB: la parola "quietanzata" (aggettivo: "polizza quietanzata e firmata") NON
 * è una quietanza — è la POLIZZA stessa firmata/timbrata. Regola: un documento
 * si considera periodico SOLO se il nome inizia con un token di quietanza/
 * regolazione ("Quietanza…", "Regolazione…") o lo contiene come parola intera
 * delimitata, e NON è una polizza. I nomi che contengono "Polizza…" non sono
 * mai periodici, anche se includono "quietanzata" nel nome.
 */
export function isPeriodicDocName(name) {
  const n = String(name || '').trim()
  if (!n) return false
  // Una polizza non è mai un documento periodico, qualunque parola contenga
  // ("Polizza …quietanzata e firmata…" È la polizza, non una quietanza).
  if (/\bpolizz/i.test(n)) return false
  // "quietanza/regolazione" come PAROLA INTERA (delimitata), non come prefisso:
  // "quietanzatissima" NON è "quietanza". Il lookahead unicode esclude i
  // derivati che continuano con lettere/cifre ("quietanza" con "t" dopo non
  // matcha). L'underscore NON è escluso (è un delimitatore valido).
  return /(?:^|[\s_\-.,;:()])(?:quietanza|quiestina|regolazion(?:e|i)?)(?![\p{L}\p{N}])/iu.test(n)
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

// ─── Evidenza di importo: tolleranza alla lettera OCR interposta ─────────────
// Sul campo (fascicolo Cedam, massimale RCT/RCO della dichiarazione 2026): il
// valore reale "7.500.000,00" veniva scartato come [senza-evidenza] e quindi non
// arrivava MAI al merge di recency — l'atto 2018 col "5.000.000,00" restava
// l'unico candidato e vinceva per default. Nei PROMPT il testo è la griglia
// SPAZIALE (colonne allineate con spazi): `normForMatch` rimuove spazi e
// punteggiatura, quindi una run di cifre "7500000" si rompe SOLO se l'OCR ha
// scritto una cifra come la sua lettera di confusione (es. "7.500.000" letto
// "7.500O000", con 0→O nei font scannerizzati). Le cifre però restano DAVVERO
// nel documento: il check evidenza va reso robusto a questo rumore, ma SENZA
// allargare i falsi positivi — un importo resta un'ancora forte: il match è
// sull'INTERO blocco numerico, mai su una sottosequenza (un numero più grande o
// più piccolo NON deve validare quello cercato).

// Lettere che l'OCR confonde davvero con le cifre nei font scannerizzati.
// L'elenco è STRETTO: tollerare altro (es. la vocale "e") renderebbe il check
// permissivo sugli importi inventati. Stringa, non regex con flag /g: il
// matching per carattere non deve tenere stato (lastIndex) tra le chiamate.
const OCR_DIGIT_LETTERS = 'oils'

/**
 * true se il numero `digits` compare in `text` come BLOCCO numerico intero,
 * tollerando per ogni cifra la sua lettera di confusione OCR (0→o, 1→l/i, 5→s)
 * e l'eventuale suffisso decimale ",00" (che `normForMatch` mantiene: nel testo
 * "4.000.000,00" la run normalizzata è "400000000", non "4000000").
 *
 * Regola (conservativa, niente sottosequenze): si normalizza il testo
 * (minuscole, senza spazi/punteggiatura), si scompone in run di cifre e
 * lettere-OCR (ogni altra lettera spezza la run), e per ogni run si confronta
 * la run "ripulita" dalle lettere-OCR con `digits` o `digits+00`: la run deve
 * coincidere ESATTAMENTE (o avere solo i due zeri decimali). Così:
 *   - "4.000.000,00"  → run pulita "4000000"+"00" → valida "4.000.000" ✓
 *   - "7500O000"      → run pulita "7500000"      → valida "7.500.000" ✓
 *   - "40.000.000"    → run "40000000"            → NON valida "4.000.000" ✓
 *   - "750.000"       → run "750000"              → NON valida "7.500.000" ✓
 */
export function hasOcrDigitRun(text, digits) {
  const t = normForMatch(text)
  const n = String(digits || '')
  if (!t || n.length < 4) return false
  const isDigitOrOcr = (ch) => (ch >= '0' && ch <= '9') || OCR_DIGIT_LETTERS.includes(ch)
  const cleanOf = (run) => [...run].filter((c) => !OCR_DIGIT_LETTERS.includes(c)).join('')
  // Blocchi numerici con eventuali lettere-OCR: un match è valido solo se la
  // run intera, una volta tolte le lettere-OCR, è ESATTAMENTE `digits` (o
  // `digits` con i due zeri decimali ",00" in coda).
  let run = ''
  const flush = () => {
    const clean = cleanOf(run)
    const hit = clean !== '' && (clean === n || clean === `${n}00`)
    run = ''
    return hit
  }
  for (const ch of t) {
    if (isDigitOrOcr(ch)) { run += ch; continue }
    if (flush()) return true
  }
  return flush()
}

// ─── Guardrail garanzia Tutela (FIX 4: niente valori inventati da altre garanzie)
// La description del campo deve dichiarare la natura CONDIZIONATA ("Verifica se
// presente/presente") con la garanzia Tutela: è il tratto già usato dal profilo
// RC PROF MED V2 sui campi Tutela. La garanzia "non esiste" nel fascicolo se
// nessun documento parla della copertura con i termini operativi veri: in quel
// caso i campi condizionati restano VUOTI (meglio vuoto che un valore pescato
// dalla garanzia sbagliata — l'estratto 260.000 sottolimite RC o 250 franchigia
// fabbricati presi per "Tutela").
export function isConditionalCoverageField(field) {
  return /verifica\s+se\s+(?:e['’]|è|e)\s+presente|\bpresente\b/i.test(String(field?.description || ''))
}

/**
 * true per i campi che descrivono una GARANZIA SPECIFICA CONDIZIONATA: la
 * descrizione chiede DI VERIFICARE SE la garanzia è presente ("Verifica se è
 * presente la garanzia X", "Se presente la copertura X", "Massimale della
 * garanzia X"…). Su questi il guardrail conserva il valore SOLO se il fascicolo
 * parla della garanzia; altrimenti resta vuoto (meglio vuoto che inventato).
 *
 * La garanzia è DINAMICA (viene dalla descrizione): qui si riconosce la
 * STRUTTURA condizionale, non una parola chiave fissa. Un campo che chiede un
 * dato diretto ("Massimale per sinistro tutela legale", senza "verifica se
 * presente") NON è condizionale → il guardrail NON lo tocca mai.
 */
export function isSpecificCoverageField(field) {
  const desc = String(field?.description || '')
  const label = String(field?.label || '')
  const blob = `${label} ${desc}`
  // Struttura condizionale esplicita nella descrizione: "verifica se presente",
  // "se presente la garanzia/copertura", "è presente".
  if (/\bverifica\s+se\s+(?:e['’]|è|e)?\s*(?:presente|operante)\b/i.test(desc)) return true
  if (/\bse\s+(?:è|e|e['’])?\s*presente\b/i.test(desc)) return true
  if (/\b(?:garanzia|copertura)\b[^.]*\bpresente\b/i.test(desc)) return true
  // "massimale/franchigia/premio/scoperto (lordo) della garanzia X" (la X è
  // dinamica): basta che nomini una garanzia come oggetto del dato richiesto.
  if (/\b(?:massimale|franchigia|premio(?:\s+lordo)?|importo|scoperto|sottolimite)\s+dell[ae]?\s+garanzia\b/i.test(blob)) return true
  return false
}

/**
 * Estrae dalla label+descrizione di un campo i TERMINI DELLA GARANZIA di cui
 * parla ("tutela legale", "garanzia tutela", "garanzia tutela e/o tutela legale"…).
 *
 * Strategia: n-grammi (sequenze di 2-3 token consecutivi) della label+descrizione
 * normalizzata CON gli spazi conservati (minuscole, senza diacritici). I n-grammi
 * che iniziano/finiscono con stop-word generiche sono scartati. I termini di
 * UNA sola parola corta (<8 char) non vengono emessi: "tutela" da sola non è una
 * garanzia, "tutela legale" sì.
 */
const COVERAGE_STOP = new Set(['verifica', 'se', 'è', 'e', 'o', 'la', 'le', 'il', 'lo', 'di', 'del', 'della', 'delle', 'degli', 'dei', 'per', 'con', 'in', 'da', 'che', 'non', 'più', 'piu', 'sono', 'sia', 'anche', 'una', 'un', 'della', 'delle'])

function normSpaced(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim()
}

export function extractCoverageTerms(field) {
  const label = normSpaced(field?.label || '')
  const desc = normSpaced(field?.description || '')
  const tokens = `${label} ${desc}`.split(' ').filter(Boolean)
  const out = new Set()

  const ngram = (start, len) => {
    if (start + len > tokens.length) return
    const first = tokens[start]
    const last = tokens[start + len - 1]
    // un n-gramma che inizia/finisce con una stop generica non identifica la garanzia
    if (COVERAGE_STOP.has(first) || COVERAGE_STOP.has(last)) return
    const term = tokens.slice(start, start + len).join(' ')
    if (term.length >= 8) out.add(term)
  }

  for (let len = 2; len <= 3; len++) {
    for (let i = 0; i <= tokens.length - len; i++) ngram(i, len)
  }

  // Il fascicolo può parlare della garanzia con il nome NUDO della copertura
  // ("massimale della garanzia Tutela"). Lo estraiamo dalla struttura.
  const afterGar = normSpaced(field?.description || '').match(/\bgaranzia\b\s+(.+)/i)
  if (afterGar) {
    const s = afterGar[1].split(/[.,;]/)[0].trim()
    if (s.length >= 4) out.add(s)
  }

  // "tutela" (nome comune delle coperture legali) come termine MONO-PAROLA:
  // l'evidenza la valida SOLO con contesto di garanzia (vedi sotto).
  if (tokens.includes('tutela')) out.add('tutela')

  return [...out].filter(Boolean)
}

/**
 * true se il TESTO di almeno un documento NON-opzione del fascicolo parla della
 * garanzia descritta da `fieldOrTerms`.
 *
 * - `docsOrTexts`: documenti (come nel call-site) o stringhe.
 * - `fieldOrTerms`: un campo (estrazione termini dalla descrizione), un array di
 *   campi (unione dei termini), o un array di stringhe già normalizzate. Se
 *   manca o non produce termini → ritorna TRUE (conserva: senza una specifica
 *   non possiamo dire "la garanzia non c'è").
 *
 * La ricerca è NORMALIZZATA (con spazi) e per termini: niente pattern hardcoded.
 */
export function hasDocumentedTutelaEvidence(docsOrTexts, fieldOrTerms = null) {
  const docBase = Array.isArray(docsOrTexts) ? docsOrTexts
    : (typeof docsOrTexts === 'string' ? [docsOrTexts] : [])

  let terms = []
  if (Array.isArray(fieldOrTerms)) {
    for (const f of fieldOrTerms) {
      terms = terms.concat(typeof f === 'string' ? [normSpaced(f)] : extractCoverageTerms(f))
    }
  } else if (fieldOrTerms && typeof fieldOrTerms === 'object') {
    terms = extractCoverageTerms(fieldOrTerms)
  }
  terms = terms.filter((t) => t && t.length >= 4)
  // Senza una specifica di garanzia non si può asserire "non c'è": conserva.
  if (!terms.length) return true

  for (const input of docBase) {
    const doc = (typeof input === 'object' && input) ? input : {}
    const text = String(doc?.text ?? doc?.norm ?? (typeof input === 'string' ? input : '') ?? '')
    const norm = normSpaced(text)
    if (!norm) continue
    for (const t of terms) {
      if (t === 'tutela') continue // mono-parola: gestita sotto col contesto
      if (norm.includes(t)) return true
    }
    // Termine mono-parola "tutela": la semplice parola in una frase generica
    // ("tutela dei dati personali") NON è una garanzia. Vale solo se vicina a
    // parole di garanzia operative (massimale/garanzia/copertura/sezione…).
    if (terms.includes('tutela') && /\btutela\b/i.test(norm)) {
      const context = /(?:massimale|garanzia|copertura|sezione|premio|franchigia|scoperto)\b[^\n]{0,80}\btutela\b|\btutela\b[^\n]{0,80}\b(?:massimale|garanzia|copertura|sezione|premio|franchigia|scoperto)\b/i
      if (context.test(norm)) return true
    }
  }
  return false
}

// ─── Natura del valore: pred puri per la disambiguazione (FIX 1 / FIX 2) ────
// I veti veri (che leggono il registro fatti) vivono in polizzaFactsRegistry.js
// (dove c'è già findFactsByValue): queste funzioni sono i PREDICATI puri che il
// vet Riesce riusa e che si testano da soli senza registro.

/**
 * La description del campo vieta esplicitamente che il valore sia della natura
 * di un'altra grandezza ("non il massimale", "non un importo premio/imponibile",
 * "NON il massimale"). È la condizione che rende lo "spill" da un'altra grandezza
 * un falso positivo da vetare nel merge.
 */
export function descriptionDeniesNature(desc) {
  const s = String(desc || '')
  if (/\bnon\b[^.,;]*(?:massimal|imponibile|premio|franchigia|scoperto|fatturato)/i.test(s)) return true
  if (/\bnon\s+(?:il|la)\s+(?:massimale|premio|imponibile|fatturato)\b/i.test(s)) return true
  // "Non riutilizzare un valore identico a un altro campo a cui deve essere
  // diverso" (massimale annuo, franchigia, ecc.): vieta il riuso della stessa
  // cifra di un'altra grandezza. Stem senza \b finale: "riutilizzare" ha più
  // lettere, "diverso" pure.
  if (/\bnon\s+riutilizz/i.test(s) && /\b(?:divers|altro|campo)/i.test(s)) return true
  return false
}

/**
 * Ritorna la natura a cui appartiene un importo dato il testo/le categorie della
 * label circostante (dal registro fatti). Valori: 'premio' (premi/imponibile/
 * imposte/fatturato/preventivo), 'massimale' (massimali di polizza/dichiarazione),
 * 'basso' (franchigie/scoperti, che sono piccoli), altrimenti null.
 */
export function factNature(cat) {
  const s = String(cat || '').toLowerCase()
  if (/premi|imponib|impost|fatturat|preventiv|parametro|retrib|premio/.test(s)) return 'premio'
  if (/massimal/.test(s)) return 'massimale'
  if (/franchig|scopert/.test(s)) return 'basso'
  return null
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
//
// MAI un rinvio:
//   - le DATE (GG/MM/AAAA): una data breve e' letteralmente un dato, non una
//     parafrasi del campo (fascicolo B: "Data retroattività 14/10/2014" era
//     scartata dal guardrail perché il campo "Retroattività" matchava
//     /attivit/ come substring);
//   - i valori puramente numerici (un importo, un periodo): sono un dato.
// La guardia sulla lunghezza < 12 torna attiva SOLO per i testi liberi.
export function isRinvioAttivita(value) {
  const v = String(value || '').trim()
  if (!v) return true
  // Dato tipizzato: una data/importo non è un rinvio, ovunque stia.
  if (/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}\b/.test(v)) return false
  if (/^[+-]?\d[\d.,\s€%‰-]*$/.test(v)) return false
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
      // Evidenza di importo ROBUSTA alle varianti OCR: le cifre della parte
      // intera devono comparire come run CONTIGUA nel contesto, tollerando al
      // massimo una lettera di confusione OCR (O/o/I/l/1, tipica 0→O nei font
      // scannerizzati) tra due cifre consecutive. Il vecchio normCtx.includes()
      // esigeva la run esatta: una sola lettera-fantasma nel testo SPAZIALE
      // ("7.500O000") faceva scartare il valore vero come [senza-evidenza]
      // PRIMA del merge per recency — visto sul campo: il 7.500.000,00 della
      // dichiarazione 2026 perdeva contro il 5.000.000,00 dell'atto 2018.
      if (hasOcrDigitRun(normCtx, intDigits)) return true
      if (!evidenza) return false
      if (!hasOcrDigitRun(evidenza, intDigits)) return false
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

  // ── Massimali per NATURA (type-blind: label+description, MAI l'id, che ora
  //    è un UUID senza sezione) ───────────────────────────────────────────────
  // Gli id esprimevano la sezione (rct_/rcp_) e il ruolo (_sinistro/_annuo/…).
  // Con gli UUID la sezione non è più ricavabile: i campi vengono raggruppati
  // per RUOLO (natura) e accoppiati PER POSIZIONE (il tipico profilo ha una
  // sola sezione di massimali → accoppiamento 1:1 per indice).
  const massRole = new Map() // role → array di campi (in ordine di lista)
  for (const f of list) {
    const n = fieldNatura(f)
    if (n && n.startsWith('massimale_')) {
      const role = n.replace('massimale_', '') // sinistro|annuo|persona|danni|prestatore|mat|interr
      const arr = massRole.get(role) || []
      arr.push(f)
      massRole.set(role, arr)
    }
  }
  const massArray = (role) => massRole.get(role) || []
  const annuoList = massArray('annuo')
  const sinistroList = massArray('sinistro')
  const personaList = massArray('persona')
  const danniList = massArray('danni')
  const maxPairs = Math.max(annuoList.length, sinistroList.length, personaList.length, danniList.length)
  for (let i = 0; i < maxPairs; i++) {
    const annuo = annuoList[i]
    const sinistro = sinistroList[i]
    const amt = (f) => (f ? looseAmount(entryValore(best, f.id)) : null)
    const aVal = amt(annuo)
    const sVal = amt(sinistro)
    if (annuo && sinistro && aVal != null && sVal != null && aVal < sVal) {
      dropField(best, annuo.id, notes,
        `Coerenza massimali: annuo ${entryValore(best, annuo.id)} < sinistro ${entryValore(best, sinistro.id)} → annuo svuotato (impossibile)`)
    }
    // Sotto-limiti di "persona"/"danni" > "sinistro": NON è una violazione di
    // per sé (sul campo B/PROF.LE la situazione legittima è "sinistro
    // 1.000.000 < persona 6.000.000": l'annuo aggregato copre più sinistri, un
    // rapporto 5-6× è legittimo). Si svuota SOLO la violazione PALESE di
    // sottolimite: "annuo" valorizzato e sotto-limite > annuo (impossibile per
    // definizione). Gli spill IDENTICI li pulisce la guardia post-merge (Fix A).
    for (const role of ['persona', 'danni']) {
      const sub = role === 'persona' ? personaList[i] : danniList[i]
      const subVal = amt(sub)
      if (!sub || subVal == null) continue
      if (aVal != null && subVal > aVal) {
        dropField(best, sub.id, notes,
          `Coerenza massimali: ${role} ${entryValore(best, sub.id)} > annuo ${entryValore(best, annuo.id)} → ${role} svuotato (sottolimite impossibile)`)
        continue
      }
    }
  }

  // ── Premio totale ≈ imponibile + imposta (type-blind, per natura) ─────────
  // Il totale DICHIARATO nella quietanza è il dato REALE: imponibile e imposta
  // sono numeri dinamici e la somma può non quadrare per estratti sbagliati
  // (regressione: il premio RATA preso per l'imposta → lordo inventato).
  // Quindi MAI svuotare o riscrivere il totale: solo una nota diagnostica.
  // Con gli UUID la sezione non è distinguibile: si considera l'UNICA tripla
  // (totale/imponibile/imposta) attiva per natura — la nota è non-distruttiva.
  let tTotale = null, tImponibile = null, tImposta = null
  for (const f of list) {
    const n = fieldNatura(f)
    if (n === 'premio_totale' && !tTotale) tTotale = f
    else if (n === 'premio_imponibile' && !tImponibile) tImponibile = f
    else if (n === 'imposta' && !tImposta) tImposta = f
  }
  if (tTotale && tImponibile && tImposta) {
    if ((tTotale.id in best) && (tImponibile.id in best) && (tImposta.id in best)) {
      const tot = parsePureAmount(entryValore(best, tTotale.id)) ?? looseAmount(entryValore(best, tTotale.id))
      const imp = parsePureAmount(entryValore(best, tImponibile.id)) ?? looseAmount(entryValore(best, tImponibile.id))
      const tax = parsePureAmount(entryValore(best, tImposta.id)) ?? looseAmount(entryValore(best, tImposta.id))
      if (tot != null && imp != null && tax != null) {
        const sum = imp + tax
        const tol = Math.max(1, Math.abs(tot) * 0.02)
        if (Math.abs(tot - sum) > tol) {
          notes.push(`Coerenza premio: totale dichiarato ${entryValore(best, tTotale.id)} ≠ imponibile+imposta ${imp}+${tax} — si MANTIENE il totale dichiarato (mai calcolato/svuotato)`)
        }
      }
    }
  }

  return notes
}
