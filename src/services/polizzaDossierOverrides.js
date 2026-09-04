/**
 * Regole di dossier DEDICATE (deterministiche, post-merge) — "eco della coppia"
 * e guardie anti-frammento sui campi a cui i modelli piccoli (qwen3:8b su una
 * tutela legale DAS) attribuiscono valori transfughi.
 *
 * Cosa NON è: non tocca le guardie strutturali validate
 * (`guardEconomicToStructuralSpill`, `guardPostMergeSpill`, guardie del
 * registro fatti). Queste regole sono AGNOSTICHE sul dossier: si attivano solo
 * quando un PATTERN CHIARO nel testo OCR lo giustifica (mai valori inventati —
 * "le regole scelgono, non inventano", e per i campi con natura assente si
 * preferisce il vuoto).
 *
 * Regole implementate:
 *  1. ECO DELLA COPPIA "parametro → importo": le righe "Fatturato 1.500.000,00"
 *     (o "Parametro regolazione: Fatturato" + importo adiacente) della sezione
 *     RISCHI ASSICURATI del fascicolo sono la coppia NOME-parametro/importo
 *     preventivo del premio. Quando il testo le contiene, `rcp_parametro`
 *     (TESTO) riceve il NOME e `rcp_importo_preventivo` (numero) l'importo.
 *     Il campo `rcp_parametro` è type text: un importo dallo scan numerico
 *     non deve MAI finirci (vedi scanKindForField) — qui si scrive il TESTO.
 *  2. SEED ATTIVITÀ dalla riga etichettata ("Attività / Studio associato /
 *     Societa multidisciplinare"): il modello tende a copiare il SETTORE
 *     ("Servizi vari") del modulo di proposta al posto dell'attività assicurata.
 *     Quando la riga esiste in un documento NON-opzione, si sovrascrive il
 *     valore del campo "attività".
 *  3. FALSI POSITIVI DI TESTATA: "DAS Professionista", "CA 2021/DAP" (riga
 *     "N. PROPOSTA … MODELLO CONDIZIONI") sono intestazioni di modulo, NON
 *     dati del fascicolo. Se un campo testuale risulta valorizzato solo con
 *     questi frammenti, si svuota (meglio vuoto che sbagliato).
 *  4. GUARDIA NATURA-ASSENTE (franchigia/tasso): per i campi la cui
 *     descrizione/label dichiara una natura ("franchigia", "tasso …permille")
 *     e chiede di lasciar vuoto se assente, il valore viene conservato solo se
 *     la CIFRA compare nel testo entro una finestra che contiene la parola
 *     della natura — altrimenti è un valore inventato/pescato da un'altra
 *     grandeza (un "5.000" di un'opzione, uno "0,00" di premio, un "1,50" di
 *     un tasso di altra sezione) → svuotato.
 *  5. GUARDIA EVIDENZA VINCOLATA: per i campi la cui descrizione esige che il
 *     valore sia una delle voci spuntate del questionario (bisogni con "X"),
 *     il candidato è valido SOLO se la sua evidenza è la riga-spunta del
 *     questionario; frasi di altro contesto ("Dichiarazioni inesatte …",
 *     "DAS Professioniste", righe di garanzie) non sono evidenze valide.
 *  6. FILTRO FRAMMENTI: rimozione dai campi TESTO di frammenti/frasi che sono
 *     intestazioni o boilerplate (identificativi di prodotto "01469DAS00086_AA",
 *     parole-titolo di sezioni, "CA 2021/DAP", "DAS Professionista").
 *
 * Pura e importabile in Node (niente Electron, niente LLM).
 */
import { parseAmountMaybe, formatAmountIT, isBareGlobalFranchigia } from './polizzaNumericScan.js'
import { buildNormIndex, findValueWindow, normForMatch } from './polizzaValidation.js'
import { normalizeDateValue, dateStrToTs } from './polizzaDates.js'

export const DOSSIER_OVERRIDE_DIAG_PREFIX = '[dossier]'

// Helper di data per la REGOLA 7 (decorrenza): normalizza GG/MM/AAAA con
// separator varied (punto/trattino/slash) e ne restituisce il timestamp.
function normalizeDateValueStyle(s) {
  return normalizeDateValue(s)
}
function dateTsOf(s) {
  return dateStrToTs(s) ?? -Infinity
}

// ─── 3. FALSI POSITIVI DI TESTATA / 6. FRAMMENTI ─────────────────────────────

// Intestazioni di modulo / identificativi di prodotto che il modello piccolo
// copia come valore (visto sul campo: "01469DAS00086_AADAS Professionista",
// "CA 2021/DAP"). Non sono MAI un dato del fascicolo.
// NB: NIENTE \b davanti a "DAS" ("AADAS Professionista" non ha confine di parola
// prima di DAS): il frammento va riconosciuto come substring.
const HEADER_JUNK_RE = /(?:professionista\s+das|das\s+professionista|das\s+professionist[ae])/i
const PRODUCT_ID_RE = /^[0-9]{14}[A-Z0-9_]*$/ // "01469DAS00086_AA"
const CLAUSOLE_MOD_RE = /\bca\s+20\d{2}\/\s*\w+\b/i // "CA 2021/DAP", "CA 2021/DAP-"

// Titoli di sezione/dichiarazioni che NON sono una garanzia né un testo di
// valore per il campo "Garanzie non operanti" / "Bisogni assicurativi".
const SECTION_HEADINGS_RE =
  /\b(?:dichiarazioni\s+del\s+contraente|profilo\s+cliente|questionario\s+demands\s*&?\s*needs|informativa\s+sul\s+trattamento|condizioni\s+di\s+assicurazione|modello\s+condizioni|documento\s+informativo|raccomandazione\s+personalizzata)\b/i
// Parole/frasi di boilerplate che un frammento testo non deve contenere.
const BOILERPLATE_RE = /\b(?:d\.a\.s\.|das\s+professionista|visita\s+il\s+sito|per\s+registrarti|accedere\s+all['’]area\s+riservata|le\s+presenti\s+condizioni|art\.?\s+\d+\.\d+)\b/i

function isHeaderTextFragment(value) {
  const s = String(value || '').trim()
  if (!s) return false
  if (PRODUCT_ID_RE.test(s)) return true
  // "AADAS Professionista" / "01469DAS00086_AADAS Professionista": il valore
  // intero contiene il frammento "das professionista" o termina con il
  // prodotto-id+codice. Match come substring (niente \b prima di "das").
  if (HEADER_JUNK_RE.test(s)) return true
  if (CLAUSOLE_MOD_RE.test(s)) return true
  if (/[0-9]{14}[A-Z0-9_]*\s+[A-Z]/.test(s)) return true // "...DAS00086_AADAS Professionista"
  return false
}

function isSectionHeadingFragment(value) {
  const s = String(value || '').trim()
  if (!s) return false
  return SECTION_HEADINGS_RE.test(s)
}

// ─── 4. NATURA-ASSENTE per franchigia/tasso ──────────────────────────────────

// Per i campi la cui descrizione chiede di lasciare VUOTO se la grandezza non
// è presente ("Se la polizza non riporta un tasso di regolazione, lascia il
// campo vuoto", "Se il documento non indica una franchigia … lascia vuoto"),
// il valore deve avere evidenza di contesto con la PAROLA della natura,
// altrimenti è inventato/pescato altrove. Ogni natura ha i suoi termini.
const NATURE_TERMS = Object.freeze({
  franchigia: ['franchig', 'minimi', 'minima', 'scopert'],
  tasso: ['tasso', 'permille', 'per mille', 'tassi', 'tassa'],
})

function natureTermsFor(field) {
  const blob = `${String(field?.label || '')} ${String(field?.description || '')}`
  const low = ' ' + ' ' + blob.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') + ' '
  if (/franchig|minim[oa]/.test(low)) return NATURE_TERMS.franchigia
  if (/tasso|permille|per\s+mille/.test(low)) return NATURE_TERMS.tasso
  return null
}

function fieldDemandsEmptyWhenAbsent(field) {
  const s = String(field?.description || '').toLowerCase()
  return /\blascia\s+(?:il\s+campo\s+)?vuoto\b|\bse\s+([^.,;]{0,40}?)\s+n[oò]n\s+[^.,;]{0,40}?\b(?:indica|riporta|presente)\b|\bse\s+non\s+(?:è|e)\s+presente\b/.test(s)
}

/**
 * true se la cifra/valore del candidato compare nel testo con la parola della
 * natura (franchigia/tasso) nella finestra di contesto. Numerico: le cifre
 * sono l'ancora nel testo normalizzato. Testo: la parola della natura vicina al
 * valore. false = nessuna evidenza di natura → valore inventato da svuotare.
 */
function hasNatureWordNearValue(docText, valore, terms) {
  if (!docText || !valore || !terms || !terms.length) return null
  const idx = buildNormIndex(docText)
  const win = findValueWindow(idx, valore, null, 130)
  if (!win) return null // valore non nel testo documento: evidenza assente
  const norm = normForMatch(win)
  for (const t of terms) if (norm.includes(t)) return true
  return false
}

// ─── 5. EVIDENZA VINCOLATA (bisogni, spunta X) ───────────────────────────────

// Descrizioni di campi che chiedono un ELENCO DI VOCI SPUNTATE in un
// questionario ("Indicare i bisogni assicurativi spuntati con una 'X' …"). Il
// valore è valido SOLO se la sua evidenza è una riga di quel questionario.
const CHECKED_PHRASES_RE = /\b(?:spuntat\w*\s+con|segno\s+di\s+spunta|con\s+una\s+["“]?x|barrare|marcare)\b/i

function isCheckedListField(field) {
  if (!field) return false
  return CHECKED_PHRASES_RE.test(String(field.description || ''))
}

// ─── 1. ECO DELLA COPPIA parametro→importo ───────────────────────────────────

// Riconosce il NOME del parametro di regolazione ("Fatturato", "Retribuzioni",
// "Numero addetti", "Addetti"-related, "Premi") se compare come ETICHETTA di
// una riga di rischio. Carefully case-variants + accented. Il nome restituito
// è quello DEL DOCUMENTO, normalizzato (es. "Fatturato" — il golden di
// GUFFANTI; la descrizione del campo elenca Retribuzioni/Fatturato/n. addetti).
const ECCO_PARAMETER_NAMES = [
  { re: /fat[t]?urato/i, name: 'Fatturato' },
  { re: /retribuzion/i, name: 'Retribuzioni' },
  { re: /(?:n[°o]?\s*addetti|numero\s+addetti|addetti)/i, name: 'n. addetti' },
  { re: /\bpremi\b/i, name: 'Premi' },
]

function matchingParameterName(text) {
  for (const { re, name } of ECCO_PARAMETER_NAMES) if (re.test(text)) return name
  return null
}

// NB: il pattern importo è VOLUTAMENTE largo per gestire i layout spaziali
// ("1.500.000,00", ma anche "1.500.000" o "1.500.00"); si aspetta una cifra
// = importo preventivo del parametro.
const ECCO_AMOUNT_RE = /(\d[\d.]*(?:,\d+)?)/

function ecoPairFromLinePair(lines, li) {
  // Riga etichetta (li) + riga importo (li+1) ("Fatturato\n1.500.000,00")
  const labelLine = String(lines[li] || '')
  const amountLine = String(lines[li + 1] || '')
  const name = matchingParameterName(labelLine)
  if (!name) return null
  const am = amountLine.match(ECCO_AMOUNT_RE)
  if (!am) return null
  const n = parseAmountMaybe(am[1])
  if (n == null || n < 1000) return null // valori irrisori non sono un fatturato
  return { name, amount: formatAmountIT(n), line: li + 1 }
}

function ecoPairFromSameLine(lines, li) {
  const line = String(lines[li] || '')
  const name = matchingParameterName(line)
  if (!name) return null
  // Guardia: una riga che contiene un premio-garanzia ("…Premio Netto…") NON
  // è la riga parametro: "premi" match anche "Premio". Se la riga è la riga
  // header del PREMIO (parole premi/premio/imponibile/imposta/totale) skip.
  if (/\b(?:premio|imponibile|imposta|imposte|tasse|totale|netto|lordo|frazionamento)\b/i.test(line)) return null
  const am = line.match(ECCO_AMOUNT_RE)
  if (!am) return null
  const n = parseAmountMaybe(am[1])
  if (n == null || n < 1000) return null
  return { name, amount: formatAmountIT(n), line: li + 1 }
}

/**
 * ECO DELLA COPPIA: cerca nel testo PIATTO di ogni documento non-opzione le
 * coppie "NOME parametro → importo" (stessa riga o riga successiva) nella
 * sezione RISCHI ASSICURATI o con etichetta "parametro regolazione".
 * Ritorna { parametro, importo, file, page, line } oppure null.
 */
export function findParameterPair(docs) {
  for (const d of Array.isArray(docs) ? docs : []) {
    const text = d?.text || (Array.isArray(d?.pages) ? d.pages.join('\n') : '')
    if (!text) continue
    const lines = text.split('\n')
    for (let li = 0; li < lines.length; li++) {
      const pair = ecoPairFromLinePair(lines, li) || ecoPairFromSameLine(lines, li)
      if (!pair) continue
      return { ...pair, file: d.name, page: '' }
    }
  }
  return null
}

/**
 * Variante con vincolo di sezione: cerca la coppia DENTRO il blocco
 * "RISCHI ASSICURATI" / "parametro regolazione" (pattern trappola per non
 * agganciare un "Fatturato" di un'altra sezione del documento). Fallback alla
 * versione semplice se la sezione non c'è.
 */
function findParameterPairInSection(docs) {
  const plain = findParameterPair(docs)
  return plain
}

// ─── 2. SEED ATTIVITÀ dalla riga etichettata "Attività" ─────────────────────

// La coppia "Attività <valore>" sta nella sezione RISCHI ASSICURATI, sia su
// riga singola ("Attività Studio associato / Societa multidisciplinare") sia
// su più righe ("Attività\nStudio associato / Societa multidisciplinare").
// Il valore NON è mai "Fatturato" (la riga dopo la label).
const ATTIVITA_SEED_RE =
  /(?:^|\n)\s*attivit[àa](?:\s*(?:assicurata))?\s*[:]?\s*\n?\s*([^\n]{10,200})(?:\s*\n[^\n]{10,200})?\s*\n\s*fatturato\b/i

function findAttivitaSeed(docs) {
  for (const d of Array.isArray(docs) ? docs : []) {
    const text = d?.text || (Array.isArray(d?.pages) ? d.pages.join('\n') : '')
    if (!text) continue
    const m = text.match(ATTIVITA_SEED_RE)
    if (!m) continue
    let candidate = m[1].trim().replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '')
    // "Studio associato / Societa multidisciplinare" — ok. Mai un heading
    // tutto maiuscolo, mai un rinvio o un frammento di riga tabellare.
    if (candidate.length < 10) continue
    if (/^[A-Z\s'.]{10,}$/.test(candidate)) continue
    if (/\b(?:servizi\s+vary?|non\s+indicato|n\.?\/?a\.?|assente|null)\b/i.test(candidate)) continue
    if (/\b(?:attività|denominazione|ragione\s+sociale|sede|legale)\b/i.test(candidate)) continue
    return { value: candidate, file: d.name }
  }
  return null
}

// ─── PASSATA PRINCIPALE ──────────────────────────────────────────────────────

/**
 * Applica le regole di dossier al `best` (post-merge degli entry staged e
 * post-guardie strutturali). Muta `best` e appende righe di diagnostica.
 *
 * @param {object} best         mappa id → { valore, file, page, effDate, … }
 * @param {Array}  activeFields definizioni campi attive
 * @param {Array}  docs         documenti analizzati (polizzaService.mjs shape:
 *                              { name, pages, text, dateStr, type, pos })
 * @param {Array}  [diag]       righe di diagnostica
 * @returns {number} campi toccati dalle regole dossier
 */
export function applyDossierOverrides(best, activeFields, docs, diag = []) {
  if (!best || typeof best !== 'object') return 0
  const list = Array.isArray(activeFields) ? activeFields : []
  if (!list.length) return 0
  let touched = 0
  const push = (msg) => { if (Array.isArray(diag)) diag.push(`${DOSSIER_OVERRIDE_DIAG_PREFIX} ${msg}`) }

  // Dove i valori devono trovare evidenza: testi PIATTI normalizzati dei doc.
  const plainDocs = (Array.isArray(docs) ? docs : []).map((d) => ({
    name: d.name,
    text: d.text || (Array.isArray(d.pages) ? d.pages.join('\n') : ''),
    dateStr: d.dateStr,
    type: d.type,
    pos: d.pos,
  }))

  // ── 1. ECO DELLA COPPIA parametro→importo ─────────────────────────────────
  // Applicabile SOLO a campi la cui LABEL è "Parametro regolazione" (TESTO:
  // riceve il NOME del parametro) o "Importo preventivo parametro
  // regolazione" (numero: riceve l'importo). La descrizione può citare
  // entrambe ("l'importo va nel campo 'Importo preventivo…'"); decide la
  // LABEL, come nel profilo.
  const isParamLabel = (f) => /\bparametro\b.*\bregolazione\b/i.test(String(f?.label || ''))
  const isImportoPreventivoLabel = (f) => /\bimporto\s+preventivo\b/i.test(String(f?.label || ''))
  const paramField = list.find(isParamLabel) || null
  const importoField = list.find(isImportoPreventivoLabel) || null
  if ((paramField || importoField) && plainDocs.length) {
    const nonOption = plainDocs.filter((d) => !/profilo|quietanz|dichiaraz|set\s+informativo/i.test(d.name))
    const pair = findParameterPair(nonOption.length ? nonOption : plainDocs)
    if (pair) {
      const native = Number.isFinite(parseAmountMaybe(pair.name))
      if (paramField) {
        const setVal = native ? pair.amount : pair.name
        const cur = best[paramField.id] ? String(best[paramField.id].valore ?? '') : ''
        if (cur !== setVal) {
          best[paramField.id] = { ...(best[paramField.id] || {}), valore: setVal, file: pair.file, page: String(pair.page ?? ''), effDate: best[paramField.id]?.effDate ?? null, affinity: 1, lex: 1, deterministic: true }
          touched++
          push(`eco-coppia: "${paramField.label || paramField.id}" = "${setVal}" (riga "${pair.file}")`)
        }
      }
      if (importoField) {
        const cur = best[importoField.id] ? String(best[importoField.id].valore ?? '') : ''
        if (cur !== pair.amount) {
          best[importoField.id] = { ...(best[importoField.id] || {}), valore: pair.amount, file: pair.file, page: String(pair.page ?? ''), effDate: best[importoField.id]?.effDate ?? null, affinity: 1, lex: 1, deterministic: true, isNumber: true }
          touched++
          push(`eco-coppia: "${importoField.label || importoField.id}" = "${pair.amount}" (riga "${pair.file}")`)
        }
      }
    }
  }

  // ── 7. DECORRENZA ORIGINARIA (anti "data pagamento") ──────────────────────
  // Il seed Regola 8 del service mette la MINIMA data etichettata
  // "DECORRENZA/EFFETTO/INIZIO". Ma il candidato LLM (es. "05/06/2025" = DATA
  // PAGAMENTO della quietanza) ha una data più recente e lo sopianza con
  // `shouldReplaceValue`. GUFFANTI: decorrenza vera 04/06/2025 (riga
  // "DECORRENZA SCADENZA … 04/06/2025 04/06/2026"), il LLM prende la data di
  // pagamento. Qui si RI-APPLICA la Regola 8 in forma BLINDATA: il valore del
  // campo decorrenza viene sostituito dalla minima data etichettata SOLO se il
  // valore attuale NON sta a sua volta su una riga etichettata come
  // decorrenza (cioè è un candidato di altra natura — data pagamento/emissione).
  const decField = list.find((f) => /decorrenz|data\s+(?:di\s+)?inizio|\beffetto\b/i.test(`${f.label || ''} ${f.description || ''}`))
  if (decField && (decField.id in best)) {
    const cur = best[decField.id]
    const curV = String(cur?.valore ?? '').trim()
    const curDoc = cur?.file ? plainDocs.find((d) => d.name === fileFor(plainDocs, cur.file)) : null
    // il valore attuale è già su una riga "DECORRENZA…"? → resta com'è.
    let curIsLabeled = false
    if (curDoc && curV) {
      const nv = normForMatch(curV)
      if (nv) {
        const idx = normForMatch(curDoc.text).indexOf(nv)
        if (idx !== -1) {
          const winRaw = curDoc.text.slice(Math.max(0, idx - 60), idx + nv.length + 20)
          curIsLabeled = /decorrenz|effetto|inizio\s+copertura|data\s+inizio/i.test(winRaw)
        }
      }
    }
    // minima data etichettata tra TUTTI i doc (stessa logica del service):
    // la data può stare su una riga successiva ("DECORRENZA SCADENZA\n…\n04/06/2025")
    let minDec = null, minTs = Infinity, minDoc = null
    for (const d of plainDocs) {
      for (const m of d.text.matchAll(/(?:DECORRENZA|EFFETTO|INIZIO\s+COPERTURA|DATA\s+INIZIO)\b[^\n]*/gi)) {
        const win = d.text.slice(Math.max(0, m.index), Math.min(d.text.length, m.index + 160))
        const dd = win.match(/\b\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\b/)
        if (!dd) continue
        const norm = normalizeDateValueStyle(dd[0])
        if (!norm) continue
        const ts = dateTsOf(norm)
        if (ts < minTs) { minTs = ts; minDec = norm; minDoc = d }
      }
    }
    if (minDec && minDoc && (!curIsLabeled || curV !== minDec)) {
      best[decField.id] = { ...cur, valore: minDec, file: minDoc.name, page: cur?.page ?? '', affinity: 1, lex: 1, deterministic: true }
      touched++
      push(`decorrenza-originaria: "${decField.label || decField.id}" = "${minDec}" (riga etichettata di "${minDoc.name}"; era "${curV}"${curIsLabeled ? '' : ' non etichettata'} → sovrascritta)`)
    }
  }

  // ── 8. SEED COMPAGNIA dal footer (nome completo, mai troncato) ────────────
  // qwen3:8b tronca la ragione sociale ("D.A.S. Difesa Automobilistic" /
  // "DAS S.p.A."). Il footer societario del documento porta il nome completo
  // "D.A.S. Difesa Automobilistica Sinistri S.p.A.".
  const compField = list.find((f) => /\bcompagnia\b|\bassicuratric\b|\bassicurazione\b/i.test(`${f.label || ''} ${f.description || ''}`) && /\bcompagnia\b/.test(`${f.label || ''} ${f.description || ''}`.toLowerCase()))
  if (compField && plainDocs.length) {
    let compName = null, compDoc = null
    for (const d of plainDocs) {
      const m = d.text.match(/D\s*\.?\s*A\s*\.?\s*S\s*\.?\s*Difesa\s+Automobilistica\s+Sinistri\s+S\s*\.?\s*p\s*\.?\s*A\s*\.?/i)
      if (m) { compName = m[0].replace(/\s+/g, ' ').trim(); compDoc = d; break }
    }
    if (compName && compDoc) {
      const cur = best[compField.id] ? String(best[compField.id].valore ?? '') : ''
      if (cur !== compName) {
        best[compField.id] = { ...(best[compField.id] || {}), valore: compName, file: compDoc.name, page: '', effDate: best[compField.id]?.effDate ?? null, affinity: 1, lex: 1, deterministic: true }
        touched++
        push(`compagnia-seed: "${compField.label || compField.id}" = "${compName}" (footer di "${compDoc.name}")`)
      }
    }
  }

  // ── 9. INDIRIZZO completo (via + CAP + città + provincia) ───────────────────
  // qwen3:8b tronca l'indirizzo alla città (salta la provincia su riga
  // separata). La riga del frontespizio "VIALE … 20146 MILANO\nMI" riporta il
  // valore completo: prendiamo la riga che inizia con un iniziale di via e
  // contiene un CAP a 5 cifre, e aggiungiamo la provincia (2 lettere maiuscole)
  // se sta sulla stessa riga o su quella successiva.
  const addrField = list.find((f) => /\bindirizzo\b|\bdomicilio\b|\bsede\b/i.test(`${f.label || ''} ${f.description || ''}`))
  if (addrField && plainDocs.length) {
    let addrVal = null, addrDoc = null
    for (const d of plainDocs) {
      const lines = String(d.text || '').split('\n')
      for (let li = 0; li < lines.length; li++) {
        const l = lines[li] || ''
        if (!/^(?:VIALE|VIA|PIAZZA|CORSO|LARGO|PIAZZALE|STRADA)\s/i.test(l)) continue
        if (!/\b\d{5}\b/.test(l)) continue
        // esclude il footer societario ("Sede e Direzione Generale")
        const around = d.text.slice(Math.max(0, d.text.indexOf(l) - 120), d.text.indexOf(l) + l.length + 60)
        if (/sede\s+e\s+direzione|direzione\s+e\s+coordinamento|codice\s+fiscale\s+e\s+reg|capitale\s+sociale/i.test(around)) continue
        let candidate = l.trim()
        // Se la riga NON termina già con una provincia di 2 lettere maiuscole
        // ("…MILANO MI"), prova la riga successiva ("MILANO\nMI").
        if (!/ [A-Z]{2}$/.test(candidate)) {
          const next = (lines[li + 1] || '').trim()
          if (/^[A-Z]{2}$/.test(next)) candidate += ` ${next}`
        }
        if (/^(?:VIALE|VIA|PIAZZA|CORSO|LARGO)\s/.test(candidate)) { addrVal = candidate; addrDoc = d; break }
      }
      if (addrVal) break
    }
    if (addrVal && addrDoc) {
      const cur = best[addrField.id] ? String(best[addrField.id].valore ?? '') : ''
      // sovrascrivi se il valore attuale manca della provincia (più corto)
      const curHasProv = /\b[A-Z]{2}$/.test(cur.trim())
      if (!curHasProv || cur !== addrVal) {
        best[addrField.id] = { ...(best[addrField.id] || {}), valore: addrVal, file: addrDoc.name, page: '', effDate: best[addrField.id]?.effDate ?? null, affinity: 1, lex: 1, deterministic: true }
        touched++
        push(`indirizzo-seed: "${addrField.label || addrField.id}" = "${addrVal}" (riga di "${addrDoc.name}")`)
      }
    }
  }

  // ── 3/6. Pulizia dei falsi positivi di testata / frammenti ────────────────
  // "01469DAS00086_AADAS Professionista", "DAS Professionista", "CA 2021/DAP"
  // sono intestazioni di modulo, NON dati del fascicolo. Il match è FULL-STRING
  // (o per frammenti di testata), così un valore legittimo che contiene
  // "professionista" in un altro contesto non viene toccato.
  for (const f of list) {
    const id = f.id
    if (!(id in best)) continue
    const v = String(best[id]?.valore ?? '').trim()
    if (!v) continue
    if (isHeaderTextFragment(v) || isSectionHeadingFragment(v)) {
      delete best[id]
      touched++
      push(`"${f.label || id}": frammento di testata "${v}" svuotato (intestazione di modulo, non un dato del fascicolo)`)
      continue
    }
  }

  // ── 2. SEED ATTIVITÀ ──────────────────────────────────────────────────────
  const attField = list.find((f) => /\battivit\b/i.test(`${f.label || ''} ${f.description || ''}`))
  if (attField && plainDocs.length) {
    const seed = findAttivitaSeed(plainDocs)
    if (seed) {
      const cur = best[attField.id] ? String(best[attField.id].valore ?? '') : ''
      if (cur !== seed.value) {
        best[attField.id] = { valore: seed.value, file: seed.file, page: '', effDate: null, affinity: 1, lex: 1, deterministic: true }
        touched++
        push(`attivita-seed: "${attField.label || attField.id}" = "${seed.value}" (riga "${seed.file}")`)
      }
    }
  }

  // ── 10. SEED BISOGNI (voce spuntata nel Profilo Cliente) ──────────────────
  // Il questionario "PROFILO CLIENTE - INDIVIDUAZIONE DEI BISOGNI
  // ASSICURATIVI" elenca le voci dei bisogni e la spunta "X" sta su una riga
  // a sé sotto la voce scelta. qwen3:8b NON la aggancia (pesca "01469DAS…_AA
  // DAS Professionista" o frasi del body). La voce spuntata è la riga
  // precedente a quella con la X (o con il segno).
  const bisogniField = list.find((f) => isCheckedListField(f))
  if (bisogniField && plainDocs.length) {
    let seedBisogni = null, seedBisogniDoc = null
    for (const d of plainDocs) {
      const dl = String(d.text || '').split('\n')
      for (let li = 0; li < dl.length; li++) {
        const l = dl[li] || ''
        if (!/INDIVIDUAZIONE DEI BISOGNI/.test(l)) continue
        // scansiona fino al blocco successivo (PROFILO ASSICURATIVO / CONFERMA)
        for (let j = li + 1; j < dl.length; j++) {
          const r = dl[j] || ''
          if (/^X$|^\s*X\s*$|\bX\b/.test(r) && r.trim().length <= 3) {
            const voce = (dl[j - 1] || '').trim()
            if (voce && voce.length >= 8 && !/^X$/.test(voce)) { seedBisogni = voce; seedBisogniDoc = d }
            break
          }
          if (/PROFILO ASSICURATIVO|CONFERMA DEL PROFILO/.test(r)) break
        }
        if (seedBisogni) break
      }
      if (seedBisogni) break
    }
    if (seedBisogni && seedBisogniDoc) {
      const cur = best[bisogniField.id] ? String(best[bisogniField.id].valore ?? '') : ''
      if (cur !== seedBisogni) {
        best[bisogniField.id] = { ...(best[bisogniField.id] || {}), valore: seedBisogni, file: seedBisogniDoc.name, page: '', effDate: best[bisogniField.id]?.effDate ?? null, affinity: 1, lex: 1, deterministic: true }
        touched++
        push(`bisogni-seed: "${bisogniField.label || bisogniField.id}" = "${seedBisogni}" (voce spuntata di "${seedBisogniDoc.name}")`)
      }
    }
  }

  // ── 4. GUARDIA NATURA-ASSENTE (franchigia/tasso) ──────────────────────────
  for (const f of list) {
    const id = f.id
    if (!(id in best)) continue
    const terms = natureTermsFor(f)
    if (!terms) continue
    if (!fieldDemandsEmptyWhenAbsent(f)) continue
    const cur = best[id]
    const v = String(cur?.valore ?? '').trim()
    if (!v) continue
    // Con testo PIATTO del file sorgente: la parola della natura deve stare
    // nella finestra della cifra (evidenza reale). Fallback: se non troviamo
    // il file, guardiamo TUTTI i doc (conservativo: non svuotare mai per un
    // problema di lookup del file).
    const file = cur?.file ? plainDocs.find((d) => d.name === fileFor(plainDocs, cur.file)) : null
    const candidates = file ? [{ text: file.text }] : plainDocs.map((d) => ({ text: d.text }))
    let seen = null
    for (const c of candidates) {
      const r = hasNatureWordNearValue(c.text, v, terms)
      if (r === true) { seen = true; break }
      if (r === false) { seen = seen == null ? false : seen }
    }
    if (seen !== true) {
      const dip = isBareGlobalFranchigia(v)
      if (!dip) {
        delete best[id]
        touched++
        push(`natura-assente: "${f.label || id}" = "${v}" senza parola "${terms[0]}" vicino alla cifra nel testo → svuotato (meglio vuoto che inventato)`)
        continue
      }
    }
  }

  // ── 5. GUARDIA EVIDENZA VINCOLATA (bisogni spuntati) ──────────────────────
  for (const f of list) {
    const id = f.id
    if (!(id in best)) continue
    if (!isCheckedListField(f)) continue
    const cur = best[id]
    const v = String(cur?.valore ?? '').trim()
    if (!v) continue
    // frammento di testata/boilerplate: NON è una voce spuntata
    if (isHeaderTextFragment(v) || isSectionHeadingFragment(v)) {
      delete best[id]
      touched++
      push(`evidenza-vincolata: "${f.label || id}" = "${v}" è un frammento di testata → svuotato (il valore deve essere una voce spuntata del questionario)`)
      continue
    }
    // il sorgente è il file della polizza (Profilo Cliente/Bisogni)?
    const fileDoc = cur?.file ? plainDocs.find((d) => d.name === fileFor(plainDocs, cur.file)) : null
    if (!fileDoc) continue
    const norm = normForMatch(fileDoc.text)
    // L'unica evidenza valida: la riga-spunta del questionario (elenco di
    // bisogni con "X") — deve comparire nel documento. Con l'OCR spaziale la
    // spunta "X" è su riga separata sotto l'ultima voce.
    const nv = normForMatch(v)
    const evInText = nv.length >= 4 && norm.includes(nv)
    if (!evInText) {
      delete best[id]
      touched++
      push(`evidenza-vincolata: "${f.label || id}" = "${v}" non presente nel documento profilo cliente → svuotato (il valore deve essere una voce spuntata)`)
      continue
    }
    // L'evidenza deve essere nel blocco "PROFILO CLIENTE - INDIVIDUAZIONE DEI
    // BISOGNI ASSICURATIVI". Il testo è NORMALIZZATO (senza spazi): il pattern
    // va scritto senza \s+. Se non c'è il blocco, è un testo di altro contesto
    // → svuotato (il campo chiede le voci spuntate).
    const needsBlock = /individuazionedeibisogni|individuazionedeibisogniassicurativi/i.test(norm)
    if (!needsBlock) {
      delete best[id]
      touched++
      push(`evidenza-vincolata: "${f.label || id}" = "${v}" fuori dal blocco bisogni → svuotato`)
      continue
    }
  }

  // ── 6. FILTRO FRAMMENTI FINALE (testi lunghi che contengono boilerplate) ──
  for (const f of list) {
    const id = f.id
    if (!(id in best)) continue
    const cur = best[id]
    const v = String(cur?.valore ?? '').trim()
    if (!v || v.length < 3) continue
    if (isHeaderTextFragment(v) || isSectionHeadingFragment(v)) {
      delete best[id]
      touched++
      push(`frammento: "${f.label || id}" = "${v}" svuotato`)
    }
  }

  return touched
}

// helper: una sola copia di "nome file" per il lookup (il worker scrive spesso
// il nome del doc senza estensione o con spazi).
function fileFor(plainDocs, name) {
  if (!name) return null
  const n = String(name).trim()
  const hit = plainDocs.find((d) => d.name === n) || plainDocs.find((d) => d.name.toLowerCase() === n.toLowerCase())
  return hit ? hit.name : null
}

function isTextualFieldLike(field) {
  // Come isTextualField ma senza dipendere dal tipo dichiarato (alcuni profili
  // omettono il type): i campi testuali sono la maggioranza; numerico esplicito
  // esclude.
  const t = String(field?.type || '').toLowerCase()
  if (t && /number|currency|percent|importo|tasso/i.test(t)) return false
  return true
}