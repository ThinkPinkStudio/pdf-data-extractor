/**
 * Regole di dossier DEDICATE (deterministiche, post-merge) — correzioni di
 * robustezza TIPO-BLIND su valori che i modelli piccoli (qwen3:8b) tendono a
 * sbagliare. Nessun riferimento a compagnie, prodotti, numeri di polizza,
 * marchi o fascicoli specifici: le regole valgono per QUALUNQUE compagnia.
 *
 * Cosa NON è: non tocca le guardie strutturali validate
 * (`guardEconomicToStructuralSpill`, `guardPostMergeSpill`, guardie del
 * registro fatti). Queste regole sono AGNOSTICHE sul dossier: si attivano solo
 * quando un PATTERN CHIARO nel testo OCR lo giustifica (mai valori inventati —
 * "le regole scelgono, non inventano", e per i campi con natura assente si
 * preferisce il vuoto).
 *
 * Regole implementate:
 *  1. ECO DELLA COPPIA "parametro → importo": una riga della sezione di
 *     calcolo del premio fatta da un NOME di parametro (qualsiasi parola che
 *     NON sia un importo: "Fatturato", "Retribuzioni", "n. addetti", "Ricavi",
 *     "Volume di affari"…) + importo adiacente (stessa riga o riga dopo) è la
 *     coppia NOME-parametro/importo preventivo. Quando il testo le contiene,
 *     `rcp_parametro` (TESTO) riceve il NOME (MAI l'importo) e
 *     `rcp_importo_preventivo` (numero) l'importo.
 *  2. SEED ATTIVITÀ dalla riga etichettata "Attività assicurata": il modello
 *     tende a copiare il SETTORE del modulo di proposta al posto dell'attività
 *     assicurata. Quando la riga esiste, si sovrascrive il campo "attività"
 *     (l'arbitro semantico del merge decide comunque, come per ogni seed).
 *  3. GUARDIA NATURA-ASSENTE (franchigia/tasso): per i campi la cui
 *     descrizione/label dichiara una natura ("franchigia", "tasso …permille")
 *     e chiede di lasciar vuoto se assente, il valore viene conservato solo se
 *     la CIFRA compare nel testo entro una finestra che contiene la parola
 *     della natura — altrimenti è un valore inventato/pescato da un'altra
 *     grandezza → svuotato.
 *  4. FILTRO FRAMMENTI di intestazione: rimozione dai campi TESTO dei valori
 *     che sono AL 100% un identificativo di prodotto/sezione (codice
 *     alfanumerico lungo, suffisso di sezione "_AA", intestazioni di documento
 *     "N. PROPOSTA … MODELLO CONDIZIONI", titoli di sezione, boilerplate
 *     "Visita il sito…", "Art. 3.2") — non sono MAI un dato di polizza.
 *  5. DECORRENZA ORIGINARIA (anti "data pagamento"): ri-APPLICA, in forma
 *     TIPO-BLIND, l'allineamento del service alla MINIMA data etichettata
 *     "decorrenza/effetto/inizio copertura" di tutti i documenti, MA solo se
 *     il valore attuale NON sta già su una riga etichettata come decorrenza.
 *
 * Pura e importabile in Node (niente Electron, niente LLM).
 */
import { parseAmountMaybe, formatAmountIT, isBareGlobalFranchigia } from './polizzaNumericScan.js'
import { buildNormIndex, findValueWindow, normForMatch } from './polizzaValidation.js'
import { normalizeDateValue, dateStrToTs } from './polizzaDates.js'
import { fieldNatura } from './polizzaFieldKind.js'

export const DOSSIER_OVERRIDE_DIAG_PREFIX = '[dossier]'

// Helper di data per la REGOLA 5 (decorrenza): normalizza GG/MM/AAAA con
// separatori vari (punto/trattino/slash) e ne restituisce il timestamp.
function normalizeDateValueStyle(s) {
  return normalizeDateValue(s)
}
function dateTsOf(s) {
  return dateStrToTs(s) ?? -Infinity
}

// ─── 4. FRAMMENTI DI INTESTAZIONE / PRODOTTO (generici) ─────────────────────

// Identificativo di prodotto/sezione: SOLO codice alfanumerico MONOBLOCCO
// (≥14 char, ≥8 cifre) che NON è un numero di polizza valido. Un numero
// polizza reale è più corto (12-14 char SENZA suffisso di sezione) e non
// deve essere filtrato. Il segno di "codice-interfaccia/modulo" è la
// lunghezza + la cadenza di cifre/lettere.
const PRODUCT_ID_RE = /^[A-Z0-9][A-Z0-9_-]{13,}$/

// Identificativo con suffisso di sezione ("…_AA", "…_AB", "…_PROD") o di
// assemblaggio pagina: il valore INTERO è il codice + suffisso, non un dato.
const PRODUCT_SECTION_SUFFIX_RE = /^[A-Z0-9][A-Z0-9_-]{6,}_[A-Z]{1,3}$/

// Codice dentro un valore più lungo: il frammento inizia con un blocco
// cifre ≥8 di indirizzo o codice, seguito da lettere/codice e poi del testo.
const PRODUCT_ID_EMBEDDED_RE = /^[0-9]{8,}[A-Z0-9_-]*\s+[A-ZÀ-Ý]/

// Codice prodotto largo CONCATENATO a testo descrittivo (identificativo di
// modulo + descrizione del prodotto): mai un dato di polizza.
const PRODUCT_ID_DESCRIPTION_RE = /[0-9]{5,}[A-Z0-9]{3,}_[A-Z]{1,3}[A-Z0-9_]*\s+[A-ZÀ-Ý][a-zà-ÿ]/

// Intestazioni di documento/modulo ("N. PROPOSTA … MODELLO CONDIZIONI"): la
// testata del modulo, non un dato del fascicolo.
const MODULE_HEADING_RE = /\bpropost\w*\s+n[°.\s]*\d+.*\bmodello\s+condizioni\b/i

// Titoli di sezione/dichiarazioni che NON sono una garanzia né un testo di
// valore per i campi a elenco.
const SECTION_HEADINGS_RE =
  /\b(?:dichiarazioni\s+del\s+contraente|profilo\s+cliente|questionario\s+demands\s*&?\s*needs|informativa\s+sul\s+trattamento|condizioni\s+di\s+assicurazione|modello\s+condizioni|documento\s+informativo|raccomandazione\s+personalizzata)\b/i
// Parole/frasi di boilerplate che un frammento testo non deve contenere.
const BOILERPLATE_RE = /\b(?:visita\s+il\s+sito|per\s+registrarti|accedere\s+all['’]area\s+riservata|le\s+presenti\s+condizioni|art\.?\s+\d+\.\d+)\b/i

function isHeaderTextFragment(value) {
  const s = String(value || '').trim()
  if (!s) return false
  if (PRODUCT_ID_RE.test(s)) return true
  if (PRODUCT_SECTION_SUFFIX_RE.test(s)) return true
  if (PRODUCT_ID_EMBEDDED_RE.test(s)) return true
  if (PRODUCT_ID_DESCRIPTION_RE.test(s)) return true
  if (MODULE_HEADING_RE.test(s)) return true
  return false
}

function isSectionHeadingFragment(value) {
  const s = String(value || '').trim()
  if (!s) return false
  return SECTION_HEADINGS_RE.test(s) || BOILERPLATE_RE.test(s)
}

// ─── 3. NATURA-ASSENTE per franchigia/tasso ─────────────────────────────────

// Per i campi la cui descrizione chiede di lasciare VUOTO se la grandezza non
// è presente, il valore deve avere evidenza di contesto con la PAROLA della
// natura, altrimenti è inventato/pescato altrove. Ogni natura ha i suoi
// termini — nessun riferimento a compagnie.
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

// ─── 1. ECO DELLA COPPIA parametro→importo (generica) ───────────────────────

// Riconosce un NOME di parametro di regolazione: una parola CAPITALE che NON è
// un numero, in una riga che non sia una riga di premio/importo. Determinata
// da parola-capitale + assenza di cifre, NON da un elenco di nomi: vale per
// "Fatturato", "Retribuzioni", "n. addetti", "Ricavi", "Volume di affari", …
const PARAMETER_NAME_TAIL_RE = /[^\s]+\s+[^\s]+$/

// Guardia: una riga con parole di premio/totale non è una riga parametro.
const PREMIUM_LINE_RE = /\b(?:premio|imponibile|imposta|imposte|tasse|totale|netto|lordo|frazionamento|consuntivo|anticipato)\b/i

// Riferimenti che rendono una riga una FRASE di rinvio, non un nome-parametro
// ("COLLEGATO ALLA POLIZZA N. …", "Codice prodotto…").
const REFERENCING_LINE_RE = /\b(?:collegat\w*\s+all[ao]|codice\s+prodotto|numero\s+polizza|n[°]?\s*polizza|proposta|modello|prodotto\b)\b/i

// Parole di intestazione/footer che non sono MAI un parametro di regolazione.
// Include le abbreviazioni comuni dei dati societari ("Cap. Soc."  = capitale
// sociale, "Reg. Imprese" = registro imprese, ecc.) — il footer aziendale non
// è mai un parametro.
const NOT_PARAMETER_WORDS = /\b(?:sede|direzione|capitale|cap\.?\s*soc|registro|reg\.?\s*imprese|telefono|email|fax|codice\s+fiscale|partita\s+iva|interamente\s+versato|albo\s+imprese|societ[aà]\s+(?:appartenente|soggetta)|iscritt\w*\s+all\b)\b/i

// Pattern importo VOLUTAMENTE largo: si aspetta una cifra = importo del parametro.
const ECCO_AMOUNT_RE = /(\d[\d.]*(?:,\d+)?)/

// Una parola CAPITALE: normalizzata (≥3 lettere con la prima maiuscola) o sigla
// breve ("RC", "RCP", "DIP"…). Mai una cifra, mai una parola tutta minuscola.
function isCapitalHeadWord(word) {
  return /^[A-Z][a-zà-ÿ]{2,}/.test(word) || /^[A-Z]{2,4}\b/.test(word)
}

// Nome-parametro da una riga che contiene l'importo: la prima parola CAPITALE
// (anche se il collasso spaziale l'ha fusa con la riga dopo). MAI numero puro,
// riga di premio, frase di rinvio o footer.
function parameterNameFromLine(line) {
  const s = String(line || '').trim()
  if (!s || PREMIUM_LINE_RE.test(s) || NOT_PARAMETER_WORDS.test(s)) return null
  const am = s.match(ECCO_AMOUNT_RE)
  if (!am) return null
  const n = parseAmountMaybe(am[1])
  if (n == null || n < 1000) return null // valori irrisori non sono un parametro
  const before = s.slice(0, am.index).trim()
  const words = before.split(/\s+/).filter(Boolean)
  const nameWord = words.find((w) => isCapitalHeadWord(w))
  if (!nameWord || nameWord.toLowerCase() === 'euro') return null
  if (REFERENCING_LINE_RE.test(before)) return null
  const wi = before.indexOf(nameWord)
  const name = before.slice(wi).trim().split(/\s+/).slice(0, 3).join(' ')
  if (/\d/.test(name)) return null
  return { name, amount: formatAmountIT(n) }
}

// Riga-SOLO-etichetta ("Fatturato", "Fatturato ROW"…): nessuna cifra, solo
// parole-etichetta; NON una frase con minuscole (o un numero).
function parameterLabelFromLine(line) {
  const s = String(line || '').trim()
  if (!s || PREMIUM_LINE_RE.test(s) || REFERENCING_LINE_RE.test(s) || NOT_PARAMETER_WORDS.test(s)) return null
  if (/\d/.test(s)) return null
  const words = s.split(/\s+/).filter(Boolean)
  if (!words.length || words.length > 4) return null
  if (!isCapitalHeadWord(words[0])) return null
  for (const w of words.slice(1)) if (!/^[A-Z]/.test(w) && !/^[A-Z]{2,4}$/.test(w)) return null
  return s
}

export function findParameterPair(docs) {
  // Raccolgo TUTTI i candidati e scelgo il più plausibile: il footer aziendale
  // ("Cap. Soc. € 2.750.000,00" ecc.) può comparire prima della vera riga del
  // parametro ("Fatturato 1.500.000,00") — prendere il primo match è fragile.
  const candidates = []
  for (const d of Array.isArray(docs) ? docs : []) {
    const text = d?.text || (Array.isArray(d?.pages) ? d.pages.join('\n') : '')
    if (!text) continue
    const lines = text.split('\n')
    for (let li = 0; li < lines.length; li++) {
      const line = String(lines[li] || '').trim()
      if (!line || PREMIUM_LINE_RE.test(line)) continue
      // STESSA riga: parola-capitale + importo ("Fatturato 1.500.000,00")
      const same = parameterNameFromLine(line)
      if (same) { candidates.push({ ...same, file: d.name, page: '', line: li }); continue }
      const nextLine = String(lines[li + 1] || '').trim()
      if (!nextLine || PREMIUM_LINE_RE.test(nextLine)) continue
      // La riga sotto porta GIÀ una coppia propria ("Fatturato 1.500.000,00"):
      // non creare la coppia spuria label-sopra ("RCP" → "Fatturato 1.5…") —
      // al giro successivo `same` la risolve correttamente.
      if (parameterNameFromLine(nextLine)) continue
      // RIGA SOLO-ETICHETTA + importo sulla riga successiva
      // ("Fatturato\n1.500.000,00" — il layout spaziale divide nome e numero)
      const labelOnly = parameterLabelFromLine(line)
      if (labelOnly) {
        const am = nextLine.match(ECCO_AMOUNT_RE)
        if (am) {
          const n = parseAmountMaybe(am[1])
          if (n != null && n >= 1000) {
            candidates.push({ name: labelOnly, amount: formatAmountIT(n), file: d.name, page: '', line: li })
          }
        }
      }
    }
  }
  if (!candidates.length) return null
  // Plausibilità: preferisco un candidato vicino alla sezione "parametro di
  // regolazione"/"RISCHI"/"regolazione" (contesto del parametro); a parità il
  // primo trovato. Il nome non deve contenere parole di footer (già escluse da
  // parameterNameFromLine/LabelFromLine via NOT_PARAMETER_WORDS).
  const CONTEXT_RE = /parametr|regolaz|rischi\s+assicurat/i
  const withCtx = candidates.filter((c) => {
    const doc = Array.isArray(docs) ? docs.find((x) => x.name === c.file) : null
    const t = doc?.text || ''
    const idx = t.indexOf(c.name)
    const around = t.slice(Math.max(0, idx - 200), idx + c.name.length + 300).toLowerCase()
    return CONTEXT_RE.test(around)
  })
  return withCtx[0] || candidates[0]
}

// ─── 2. SEED ATTIVITÀ dalla riga etichettata "Attività" ─────────────────────

// La coppia "Attività <valore>" sta nella scheda di polizza, sia su riga
// singola sia su più righe. Il valore NON è mai la riga "Fatturato".
const ATTIVITA_SEED_RE =
  /(?:^|\n)\s*attivit[àa](?:\s*(?:assicurata))?\s*[:]?\s*\n?\s*([^\n]{10,200})(?:\s*\n[^\n]{10,200})?\s*\n\s*fatturato\b/i

function findAttivitaSeed(docs) {
  for (const d of Array.isArray(docs) ? docs : []) {
    const text = d?.text || (Array.isArray(d?.pages) ? d.pages.join('\n') : '')
    if (!text) continue
    const m = text.match(ATTIVITA_SEED_RE)
    if (!m) continue
    let candidate = m[1].trim().replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '')
    if (candidate.length < 10) continue
    if (/^[A-Z\s'.]{10,}$/.test(candidate)) continue // heading tutto maiuscolo
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
  // Applicabile SOLO a campi la cui LABEL esprime la natura: "Parametro
  // regolazione" (TESTO: riceve il NOME del parametro) o "Importo preventivo
  // parametro regolazione" (numero: riceve l'importo). La LABEL è la fonte di
  // verità (la descrizione del campo parametro può citare "importo preventivo"
  // per dire "l'importo va lì" e non è un importo — fieldNatura su label+desc
  // sarebbe ambiguo per questo profilo).
  const paramField = list.find((f) => {
    const lbl = String(f?.label || '')
    return /parametro\b/i.test(lbl) && !/importo\b/i.test(lbl)
  }) || null
  const importoField = list.find((f) => {
    const lbl = String(f?.label || '')
    return /importo\s+preventiv/i.test(lbl)
  }) || null
  if ((paramField || importoField) && plainDocs.length) {
    const nonOption = plainDocs.filter((d) => !/profilo|quietanz|dichiaraz|set\s+informativo/i.test(d.name))
    const pair = findParameterPair(nonOption.length ? nonOption : plainDocs)
    if (pair) {
      const native = Number.isFinite(parseAmountMaybe(pair.name))
      if (paramField) {
        // Il campo TESTO riceve MAI un importo: riceve il NOME (parola) e basta.
        const setVal = native ? '' : pair.name.trim()
        const cur = best[paramField.id] ? String(best[paramField.id].valore ?? '') : ''
        if (setVal && cur !== setVal) {
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

  // ── 5. DECORRENZA ORIGINARIA (anti "data pagamento") ──────────────────────
  // Il seed Regola 8 del service mette la MINIMA data etichettata
  // "DECORRENZA/EFFETTO/INIZIO". Ma il candidato LLM (es. la data di PAGAMENTO
  // della quietanza) ha una data più recente e lo sopianza con
  // `shouldReplaceValue`. Qui si RI-APPLICA la Regola 8 in forma TIPO-BLIND: il
  // valore del campo decorrenza viene sostituito dalla minima data etichettata
  // SOLO se il valore attuale NON sta a sua volta su una riga etichettata come
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

  // ── 4. Pulizia dei frammenti di testata / intestazione (generica) ─────────
  // Identificativi di prodotto/sezione e intestazioni di documento NON sono
  // dati del fascicolo. Il match è FULL-STRING (o per frammenti di testata),
  // così un valore legittimo che contiene le stesse parole in un altro
  // contesto non viene toccato.
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
  const attField = list.find((f) => /\battivit\b/i.test(`${f.label || ''} ${f.description || ''}`) && fieldNatura(f) === 'attivita')
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

  // ── 3. GUARDIA NATURA-ASSENTE (franchigia/tasso) ──────────────────────────
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