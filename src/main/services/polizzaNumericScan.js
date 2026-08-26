/**
 * Scan NUMERICA deterministica dei fascicoli — passata "deterministica" sui
 * numeri strutturali (zero LLM, zero Electron, pura ed importabile in Node).
 *
 * Il modello 7B continua a sbagliare i 7 campi numerici strutturali (massimale
 * per sinistro, massimale annuo, franchigia base, scoperto, sottolimiti,
 * fatturato, premi/imponibile/imposta). Qui si estraggono gli stessi valori
 * dai pattern FISSI dei documenti (dichiarazione, atti, quietanza, corpo
 * polizza) prescindendo dalla scelta del modello, e si producono "hint":
 *   { kind, value, file, page, line, confidence, effDate, pattern, source }
 *
 * TYPE-BLIND: la scan non conosce gli id dei campi — ogni hint porta un `kind`
 * di natura (massimale_sinistro, franchigia, ...) e il chiamante lo applica
 * solo ai campi la cui label/description corrisponde (scanKindForField).
 * Vale per QUALSIASI profilo: i pattern sono quelli strutturali dei documenti,
 * non i valori del fascicolo Cedam.
 *
 * Regole di sicurezza:
 *  - numeri recovery come importi italiani e normalizzati a "7.500.000,00";
 *  - se il pattern è esplicito ("Unico per sinistro") la confidenza è alta; se
 *    due importi idonei competono, vince il più ESPLICITO e poi il più recente
 *    (confidenza < 1 e sorgente sempre riportata);
 *  - la scan è SEVERA: su rumore OCR la tolleranza resta ai layer degli altri
 *    check ("meglio vuoto che sbagliato"); mai valori inventati.
 */

// Soglia di confidenza perché un hint SOVRASCRIVA il candidato LLM nel merge.
export const DETERMINISTIC_MIN_CONFIDENCE = 0.9

// Prefisso delle righe di diagnostica prodotte dalla deterministic pass.
export const DETERMINISTIC_DIAG_PREFIX = '[deterministico]'

export const NUMERIC_SCAN_KINDS = Object.freeze({
  MASSIMALE_SINISTRO: 'massimale_sinistro',
  MASSIMALE_ANNUO: 'massimale_annuo',
  FRANCHIGIA: 'franchigia',
  SCOPERTO: 'scoperto',
  SOTTOLIMITI: 'sottolimiti',
  PREMIO_IMPONIBILE: 'premio_imponibile',
  IMPOSTA: 'imposta',
  PREMIO_TOTALE: 'premio_totale',
  FATTURATO: 'fatturato',
})

// ─── Importi (recovery) ──────────────────────────────────────────────────────

/**
 * Importo italiano → numero. Gestisce "7.500.000,00" (punti migliaia e virgola
 * decimale), "10689,58" (virgola decimale), "20.000" (punti migliaia senza
 * decimali), "4.000.000.00"/"10689.58" (dot-decimale dattiloscritto). Restituisce
 * null se non è un importo (date, testo, "n/d").
 */
function stripCurrency(s) {
  // "Euro"/"euro" (per esteso) e il simbolo €; "EUR" casomai senza punti.
  return String(s).replace(/€/g, ' ').replace(/\bEuro\b/gi, ' ').replace(/\bEUR\b/g, ' ').trim()
}

export function parseAmountMaybe(v) {
  if (v == null) return null
  let s = stripCurrency(String(v).trim())
  if (!/^-?[\d\s.,]+$/.test(s)) return null
  s = s.replace(/\s/g, '')
  if (s.includes(',')) {
    const n = parseFloat(s.replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  if (s.includes('.')) {
    const parts = s.split('.')
    const last = parts[parts.length - 1]
    const twoDec = /^\d{1,2}$/.test(last)
    const ints = parts.slice(0, -1)
    // "20.000"/"1.500.000": TUTTI i gruppi a 3 (nessun ultimo decimale) e il
    // primo può essere 1-3 → punti come SEPARATORI ITALIANI di migliaia.
    const groupsAll3 = ints.length > 0 && ints.every((p) => /^\d{3}$/.test(p))
    if (!twoDec && groupsAll3) {
      const n = parseFloat(s.replace(/\./g, ''))
      return Number.isFinite(n) ? n : null
    }
    // "4.000.000.00" o "10689.58": gli int (i gruppi) sono a 3 TUTTI tranne il
    // PRIMO che può essere 1-2 (il separatore italiano di migliaia) → il punto
    // finale è il DECIMALE e il numero è la somma senza punti + decimale.
    const grammatica3 = ints.length > 0 && ints.every((p) => /^\d{3}$/.test(p))
    const grammaticaPrimo1_2 = ints.slice(1).every((p) => /^\d{3}$/.test(p)) && /^\d{1,2}$/.test(ints[0] || '')
    if (twoDec && (grammatica3 || grammaticaPrimo1_2)) {
      const n = parseFloat(`${ints.join('')}.${last}`)
      return Number.isFinite(n) ? n : null
    }
    // "10689.58" (un solo blocco intero + .58): dot-decision.
    if (twoDec && ints.length === 1) {
      const n = parseFloat(`${ints[0]}.${last}`)
      return Number.isFinite(n) ? n : null
    }
    // Altrimenti i punti sono le migliaia ("20.000", "1.500.000").
    const n = parseFloat(s.replace(/\./g, ''))
    return Number.isFinite(n) ? n : null
  }
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Numero → stringa-importo italiana stile "7.500.000,00" (sempre 2 decimali,
 * SEPARATORE DI MIGLIAIA a gruppi di 3 anche sotto le 5 cifre: "1.001,25").
 * Non inventa mai: null/non-finito → null.
 */
export function formatAmountIT(v) {
  const n = typeof v === 'string' ? parseAmountMaybe(v) : v
  if (n == null || !Number.isFinite(n)) return null
  const neg = n < 0
  const as = Math.abs(n).toFixed(2)
  const [int, dec] = as.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${neg ? '-' : ''}${grouped},${dec}`
}

// Timestamp GG/MM/AAAA → ms (per recency); null → -Infinity.
function tsOf(dateStr) {
  if (!dateStr) return -Infinity
  const m = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return -Infinity
  return Date.UTC(+m[3], +m[2] - 1, +m[1])
}

// ─── Mapping campo → natura (type-blind, solo label/description) ─────────────
// Ogni hint viene applicato SOLO ai campi la cui label/description corrisponde
// alla natura in modo STRETTO: nessun riferimento agli id (il profilo può
// riusarli con label diverse, come fa RC PROF MED V2), e nessuna parola
// "catch-all" — "massimale" da solo NON basta, serve la grandezza esatta.
//
// Regola del principio dell'utente: un hint deterministico di una data NATURA
// può essere applicato SOLO a campi la cui natura matchessa in modo STRETTO.
// Se non è chiaro, NON applicare (meglio vuoto che un importo di natura
// sbagliata). MAI heuristiche "non presente"/"assente" per decidere: i dati
// sono dinamici.
//
// MASSIMALE PER SINISTRO ⇒ SOLO "per sinistro"/"per singolo sinistro"/"ogni
// sinistro"/"unico per sinistro" nella label/description. MAI a "massimale
// annuo", "per persona", "per prestatore", "danni", "franchigia", "scoperto",
// "sottolimiti". Un campo "Massimale per persona/danni/prestatore" NON ha
// natura per-sinistro e NON riceve l'hint del sinistro.
export function scanKindForField(field) {
  if (!field) return null
  // La description può RIPORTARE il vocabolo di un'altra grandezza per
  // contrapposizione ("Non confondere con franchigia/scoperto", "non
  // riutilizzare ... es. massimale annuo", "Non deve essere il massimale").
  // Queste occorrenze NON sono la natura del campo: tagliamo la description
  // al PRIMO marcatore negativo/esempio; il resto non conta (un "Massimale
  // per sinistro" la cui descrizione dice "... non riutilizzare ... es.
  // massimale annuo, franchigia" resta un MASSIMALE PER SINISTRO).
  const descCut = String(field.description || '')
    .split(/\b(?:non\s+confonder\w*|non\s+riutilizz\w*|non\s+deve\w*|non\s+pu[oò]\w*|non\s+[èe]\b|mai\b|evitare\b|es\.|esempi\w*)\b/i)[0]
  const blob = `${String(field.label || '')} ${descCut}`
  const low = ' ' + String(blob).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') + ' '
  // MAI su campi condizionali di garanzia (Tutela / Tutela legale): la scan
  // non deve toccarli — decide il guardrail dedicato, non gli hint.
  if (/\btutela\b/i.test(low)) return null
  if (/franchig/i.test(low)) return NUMERIC_SCAN_KINDS.FRANCHIGIA
  if (/fat[t]urato/i.test(low)) return NUMERIC_SCAN_KINDS.FATTURATO
  if (/sottolimit/i.test(low)) return NUMERIC_SCAN_KINDS.SOTTOLIMITI
  if (/scopert/i.test(low)) return NUMERIC_SCAN_KINDS.SCOPERTO
  if (/impost/i.test(low)) return NUMERIC_SCAN_KINDS.IMPOSTA
  if (/premio\s+imponib/i.test(low)) return NUMERIC_SCAN_KINDS.PREMIO_IMPONIBILE
  if (/premio\s+(?:lordo|totale|annuo)/i.test(low)) return NUMERIC_SCAN_KINDS.PREMIO_TOTALE
  // MASSIMALE PER SINISTRO — SOLO natura esplicita "per sinistro" (o sinonimi).
  if (low.includes('per sinistro') || low.includes('per singolo sinistro') || low.includes('ogni sinistro') || low.includes('unico per sinistro')) {
    // Se la grandezza è esplicitamente ANNUA o PER PERSONA/PRESTATORE/DANNI,
    // non è la natura per-sinistro: nessun veto serve, non è proprio questo campo.
    if (/per\s+persona|per\s+prestatore|per\s+dann|danni\s+alle|annuo|periodo\s+assicurativo|aggregat/i.test(low)) return null
    return NUMERIC_SCAN_KINDS.MASSIMALE_SINISTRO
  }
  // MASSIMALE ANNUO / PER PERIODO — SOLO "annuo"/"per periodo assicurativo"/
  // "aggregato" sotto la label o in una frase di definizione; MAI se è "per
  // sinistro"/"per persona"/"per prestatore" (la natura per-sinistro resta sua).
  if ((low.includes('massimale') && (low.includes('annuo') || low.includes('per periodo assicurativo') || low.includes('aggregato'))) ||
      low.includes('per periodo assicurativo') || low.includes('massimale aggregato')) {
    if (/per\s+sinistro|per\s+singolo\s+sinistro|ogni\s+sinistro|unico\s+per\s+sinistro|per\s+persona|per\s+prestatore|per\s+dann|danni\s+alle/i.test(low)) return null
    return NUMERIC_SCAN_KINDS.MASSIMALE_ANNUO
  }
  return null
}

/**
 * L'hint di natura `hintKind` si applica a un campo la cui natura è
 * `targetKind`. Mapping 1:1 stretto: l'"Unico per sinistro" va SOLO al
 * massimale per sinistro e mai all'annuo (decisione del task).
 *
 * Guardia anti-spill per i MASSIMALI: un hint che nasce da una sola evidenza
 * PER SINISTRO (dichiarazione "Unico per sinistro", "per ogni sinistro"…) è
 * portatore di una SOLA grandezza: il per-sinistro. NEANCHE con targetKind
 * coincidente può finire su un campo la cui natura è declinata su persona/
 * prestatore/danni/scoperto, che vogliono il loro importo specifico (il caso
 * CEDAM: l'hint 7.500.000 per-sinistro finiva su rct_massimale_prestatore +
 * tutti i rcp_massimale_* e rcp_scoperto_*). Un massimale da sola evidenza
 * per-sinistro applica SOLO al per-sinistro.
 */
export function canApplyScanHint(targetKind, hintKind, field = null, hint = null) {
  if (targetKind !== hintKind) return false
  if (hintKind === NUMERIC_SCAN_KINDS.MASSIMALE_SINISTRO) {
    const ev = `${String(field?.id || '')} ${String(field?.label || '')} ${String(field?.description || '')}`
    const low = ' ' + ev.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ') + ' '
    const sinistroMarkers = ['per sinistro', 'per ogni sinistro', 'per singolo sinistro', 'unico per sinistro', 'ogni sinistro']
    const singleOccurrence = sinistroMarkers.filter((p) => low.includes(p)).length === 1
    if (singleOccurrence && /per\s+persona|per\s+prestatore|\bprestatore\b|per\s+dann|danni\s+alle|dann\w*\s+(?:materiali|a\s+cose)|scopert\w*/i.test(low)) return false
  }
  return true
}

/**
 * Soglia minima di plausibilità per un hint numerico deterministico: un
 * valore <= soglia NON è MAI un importo strutturale valido (un massimale, una
 * franchigia, un premio) — è un dato fittizio (es. "0,00" di ODON da
 * POLIZZA_BASE p2) o rumore OCR. Il 7B non deve mai ricevere un simile
 * "override": meglio vuoto che un importo fittizio.
 */
export function isPlausibleScanValue(kind, value) {
  const n = parseAmountMaybe(value)
  if (n == null) return false
  if (n <= 50) return false // mai zero/troncati: il massimale < 50 non ha senso
  return true
}

// ─── Singoli documenti → hint ────────────────────────────────────────────────

const AMOUNT_RE = /(\d[\d.]*(?:,\d+)?)/g

// Header di tabella premio (quietanza) che individua la riga dati con
// imponibile / imposta / totale. La "Imposta" spesso NON è etichettata nei
// tracciati (es. quietanza Cedam: "Imponibile  TOTALE" senza "Imposte"):
// basta l'abbinata "imponib" + "totale" sullo stesso header.
function isPremiumColumnsHeader(line) {
  const l = String(line || '')
  return /imponib/i.test(l) && /totale/i.test(l)
}

function importiInLine(line) {
  const out = []
  AMOUNT_RE.lastIndex = 0
  for (const m of String(line || '').matchAll(/(\d[\d.]*(?:,\d+)?)/g)) {
    const raw = m[1]
    // Esclude date puntinate/trattinate (31.12.2025) e anni a 4 cifre banali.
    if (/^\d{1,2}[.\-]\d{1,2}[.\-]\d{2,4}$/.test(raw)) continue
    if (/^\d{4}$/.test(raw) && raw >= '1900' && raw <= '2099') continue
    const n = parseAmountMaybe(raw)
    if (n == null) continue
    out.push({ raw, n })
  }
  return out
}

// Label di garanzia troppo "intestazione" per contare come sottolimite.
// Label di garanzia che NON è un sottolimite: "R.C.T.)", "R.C.O.)" sono i
// MASSIMALI GENERALI scheda (verso terzi/prestatori), non sottolimiti. Anche
// "Sottolimiti", "Massimale", porte di tabella.
const SOTTOLIMITI_BAD_LABEL =
  /(polizza|numero|agenzia|totale|imponib|impost|premio\b|euro\b|rata|dati\b|periodo|riferimento|produtt\w*|broker|subagenzia|codice|convenzione|vincolo|regolazione|effetto\b|scadenza|importo\b|somma|massimal|franchig|scopert|tasso|preventiv|periodicit[àa]|sottolimit\w*|\)$|\)\s*$|versi\s*terz|prestatori\s+di\s+lavoro|infortunat)/i

// ─── Regola 6: franchigie/scoperti GLOBALI non sono sottolimiti ─────────────
// Un sottolimite è una garanzia SPECIFICA ("garanzia AIDS/HIV max € 260.000",
// "perdite patrimoniali € 200.000"). Un valore che è SOLO una franchigia/
// scoperto "frontale/globale per ogni tipo di danno" senza NESSUNA garanzia
// ("franchigia frontale di € 20.000") NON è un sottolimite: è la franchigia
// base della polizza. Predicato MONOTONO: match della stringa intera con parole
// di garanzia assenti.
// radici (senza \b finale): "franchigia frontale", "scoperto", "massimale",
// "premio", "imponibile", "imposta", "totale", "tasso", "periodo assicurativo"
// restano BASE GLOBALE anche con i suffissi plurali/tipici del caso.
const GLOBAL_GRANDEZZA_WORDS = /\b(?:franchigi|scopert|massimal|premi|imponibile|imposta|totale|tasso|periodo\s+assicurativo)/i
const GARANZIA_WORDS = /\b(aids|hiv|radioatt|fonti\s+radioattive|trattamento\s+dati|perdit|patrimonial|parcheggi|committenza|acqua|condutture|medic|igienist|profession|estetic|chirurg|fisioterap|radiolog|impiant|reclutament|previdenza|furto|incendio|societar|amministratori|direttore|quota|utenti|ospitalit|gestione)\b/i

/**
 * true se il valore è una base globale (franchigia/scoperto ecc.) SENZA nessuna
 * garanzia specifica: non è un sottolimite, è la franchigia base della polizza.
 */
export function isBareGlobalFranchigia(value) {
  const s = String(value || '').toLowerCase()
  if (!GLOBAL_GRANDEZZA_WORDS.test(s)) return false
  if (GARANZIA_WORDS.test(s)) return false // c'è una garanzia specifica → è un sottolimite
  // la cifra è un importo (piccolo) di franchigia: presenti i marker di base
  return /franchig|scopert|massimal|premio|imponib|impost|totale/i.test(s)
}

// Dalla coppia <label, valore>: scarta se label è una globale ("FRANCHIGIA
// FRONTALE") oppure il valore non è sostenuto da una garanzia nel testo.
function isSottolimitePlausible(label, value) {
  const lab = String(label || '').trim()
  const val = String(value || '').trim()
  if (!val) return false
  // una grandezza di BASE con la sola etichetta (niente garanzia) non è un
  // sottolimite: è franchigia base / premio / totale di una riga di tabella.
  if (GLOBAL_GRANDEZZA_WORDS.test(lab) && !GARANZIA_WORDS.test(lab)) return false
  if (isBareGlobalFranchigia(val)) return false
  return true
}

// Raccoglie le coppie "GARANZIA: € importo" di una pagina (corpo polizza).
function collectSottolimitiLabeled(pageLines) {
  const pairs = []
  const LABELED = /\b([A-ZÀ-Ý][A-ZÀ-Ý0-9\s./&()'-]{0,44}?)\s*:\s*€?\s*(\d[\d.]*(?:,\d+)?)/g
  for (const line of pageLines) {
    LABELED.lastIndex = 0
    for (const m of line.matchAll(LABELED)) {
      const label = m[1].trim().replace(/\s+/g, ' ')
      if (SOTTOLIMITI_BAD_LABEL.test(label)) continue
      if (/[:/]/.test(label) && label.trim().length > 20) continue
      const n = parseAmountMaybe(m[2])
      if (n == null) continue
      pairs.push({ label, value: formatAmountIT(n), raw: m[2] })
    }
  }
  return pairs.filter((p) => p.value != null)
}

// Coppie "limite di risarcimento … di € X" con etichetta dal titolo clausola
// (riga precedente MAIUSCOLA) — corpo polizza, supera la riga del testo.
function collectSottolimitiFromClauses(pageLines) {
  const pairs = []
  const L = /\b(?:limite\s+di\s+risarcimento|massimo\s+risarcimento|limite\s+per\s+sinistro|limite\s+di\s+prestazione)[^\n]{0,140}?€?\s*(\d[\d.]*(?:,\d+)?)/gi
  for (let li = 0; li < pageLines.length; li++) {
    L.lastIndex = 0
    for (const m of String(pageLines[li] || '').matchAll(L)) {
      const n = parseAmountMaybe(m[1])
      if (n == null) continue
      // label dalla (più vicina) riga precedente se è un titolo clausola MAIUSCOLO
      let label = ''
      let p = li - 1
      while (p >= 0 && !(pageLines[p] || '').trim()) p--
      const prev = (pageLines[p] || '').trim()
      if (prev && prev.length <= 80 && /^[A-ZÀ-Ý0-9\s./&()'\-:,.]+$/.test(prev) && /[A-ZÀ-Ý]{3}/.test(prev)) label = prev
      pairs.push({ label, value: formatAmountIT(n), raw: m[1] })
    }
  }
  return pairs.filter((p) => p.value != null)
}

// Pagina → array di hint (tutte le fonti).
export function scanDocument(doc) {
  const hints = []
  const name = String(doc?.name || 'doc')
  const dateStr = doc?.dateStr || null
  const base = {
    file: name,
    effDate: dateStr,
    docType: doc?.docType ?? null,
    appendixOrd: doc?.appendixOrd ?? null,
    docPos: doc?.pos ?? null,
  }
  const pages = Array.isArray(doc?.pages) && doc.pages.length
    ? doc.pages.map(String)
    : (typeof doc?.text === 'string' && doc.text ? [doc.text] : [])
  const push = (h) => hints.push({ ...base, ...h, source: (h.source || '').slice(0, 140) })

  pages.forEach((page, pi) => {
    const lineIdx = pages.length > 1 ? pi : 0
    const pageLines = page.split('\n')
    const pno = lineIdx + 1

    // ── 1. MASSIMALE PER SINISTRO ──────────────────────────────────────────
    // Dichiarazione: "Massimali Assicurati: RCT/RCO € 7.500.000,00 Unico per
    // sinistro" — pattern ESISTENZIALE dell'importo, confidenza massima.
    {
      const M1 = /(?:massimali\s+assicurati)[:.]?\s*[A-Z/]{1,16}?\s*€?\s*(\d[\d.]*(?:,\d+)?)\s+(?:unico\s+per\s+sinistro|per\s+sinistro\s+unico)/gi
      for (const m of page.matchAll(M1)) {
        const n = parseAmountMaybe(m[1])
        if (n == null) continue
        push({
          kind: NUMERIC_SCAN_KINDS.MASSIMALE_SINISTRO, value: formatAmountIT(n),
          raw: m[1], file: name, page: pno, line: pno,
          confidence: 0.97, pattern: 'dichiarazione-unico-per-sinistro',
          source: page.slice(Math.max(0, m.index - 30), m.index + m[0].length + 40),
        })
      }
      // "Massimali Assicurati … € 7.500.000,00" senza "unico per sinistro":
      // comunque prova del massimale generale (conf 0.9, resta sovrapponibile).
      const M1B = /(?:massimali\s+assicurati)[:.]?\s*[A-Z/]{1,16}?\s*€?\s*(\d[\d.]*(?:,\d+)?)/gi
      for (const m of page.matchAll(M1B)) {
        const n = parseAmountMaybe(m[1])
        if (n == null) continue
        push({
          kind: NUMERIC_SCAN_KINDS.MASSIMALE_SINISTRO, value: formatAmountIT(n),
          raw: m[1], file: name, page: pno, line: pno,
          confidence: 0.9, pattern: 'dichiarazione-massimali-assicurati',
          source: page.slice(Math.max(0, m.index - 30), m.index + m[0].length + 40),
        })
      }
    }
    // Scheda/dichiarazione: "Massimale per sinistro: € 4.000.000,00" o
    // "per ogni sinistro ... €" con l'importo.
    {
      const M2 = /(?:massimale\s+per\s+sinistro|per\s+(?:ogni|singolo|ciascun)\s+sinistro|per\s+sinistro)[^\n]{0,60}?€?\s*(\d[\d.]*(?:,\d+)?)/gi
      for (const m of page.matchAll(M2)) {
        const ctx = page.slice(Math.max(0, m.index - 60), m.index + m[0].length + 40)
        if (/annuo|periodo\s+assicurativo|anno\s+assicurativ|per\s+anno/i.test(ctx)) continue
        if (/persona|prestatore|dann[oi]\s+(?:a|alle)|materiali/i.test(ctx)) continue
        // franchigia/scoperto "per ogni sinistro" NON è un massimale.
        if (/franchig|scopert/i.test(ctx)) continue
        // un "limite di risarcimento per sinistro e per anno assicurativo" è un
        // SOTTOLIMITE di garanzia (es. 260.000), NON il massimale per sinistro
        // generale. Non deve competere come massimale.
        if (/limite\s+di\s+risarcimento|massimo\s+risarcimento|limite\s+per\s+sinistro/i.test(ctx)) continue
        // opzioni di sottoscrizione "[  ] € X per Sinistro / € Y per Anno" non
        // sono il massimale operante: escludi righe con checkbox.
        if (/\[\s*\]|checkbox|\bopzion/i.test(ctx)) continue
        const n = parseAmountMaybe(m[1])
        if (n == null) continue
        push({
          kind: NUMERIC_SCAN_KINDS.MASSIMALE_SINISTRO, value: formatAmountIT(n),
          raw: m[1], file: name, page: pno, line: pno,
          confidence: 0.93, pattern: 'massimale-per-sinistro',
          source: page.slice(Math.max(0, m.index - 20), m.index + m[0].length + 30),
        })
      }
      const M3 = /€?\s*(\d[\d.]*(?:,\d+)?)\s+per\s+ogni\s+sinistro/gi
      for (const m of page.matchAll(M3)) {
        // guardia all'indietro: se il contesto (prima dell'importo) parla di
        // franchigia/scoperto "€ X per ogni sinistro" non è un massimale.
        const n = parseAmountMaybe(m[1])
        if (n == null) continue
        const ctx = page.slice(Math.max(0, m.index - 90), m.index + m[0].length)
        if (/franchig|scopert|minim[oa]?|massima/i.test(ctx) && n < 100000) continue
        push({
          kind: NUMERIC_SCAN_KINDS.MASSIMALE_SINISTRO, value: formatAmountIT(n),
          raw: m[1], file: name, page: pno, line: pno,
          confidence: 0.9, pattern: 'importo-per-ogni-sinistro',
          source: page.slice(Math.max(0, m.index - 25), m.index + m[0].length + 35),
        })
      }
    }

    // ── 2. MASSIMALE ANNUO / PER PERIODO ASSICURATIVO ──────────────────────
    // Serve un'etichetta esplicita + importo: un importo che nel testo è un
    // premio/imponibile NON diventa mai il massimale annuo (il modello non deve
    // mettere l'imponibile premio — la scan non lo propone proprio).
    {
      const A = /(?:massimale\s+annuo|massimale\s+.*per\s+periodo\s+assicurativo|per\s+periodo\s+assicurativo)[^\n]{0,100}?€?\s*(\d[\d.]*(?:,\d+)?)/gi
      for (const m of page.matchAll(A)) {
        if (/premio|imponib|fatturat|impost/i.test(m[0])) continue
        const n = parseAmountMaybe(m[1])
        if (n == null) continue
        push({
          kind: NUMERIC_SCAN_KINDS.MASSIMALE_ANNUO, value: formatAmountIT(n),
          raw: m[1], file: name, page: pno, line: pno,
          confidence: 0.93, pattern: 'massimale-annuo-o-periodo',
          source: page.slice(Math.max(0, m.index - 20), m.index + m[0].length + 30),
        })
      }
    }

    // ── 3. FRANCHIGIA ──────────────────────────────────────────────────────
    // "franchigia frontale ... per ogni tipo di danno di € 20.000,00" (atto) è
    // la FRANCHIGIA BASE, confidenza massima. "assoluta" è spesso di garanzia
    // specifica (fabbricati/veicoli): resta pura evidenza a confidenza bassa.
    // Mai se implica un massimale (valore miliardario o voce "massimale").
    {
      const F1 = /(?:franchigia\s+frontale)[^\n]{0,80}?(?:di|pari\s+a)\s*(?:€|Eur)?\s*(\d[\d.]*(?:,\d+)?)/gi
      for (const m of page.matchAll(F1)) {
        const n = parseAmountMaybe(m[1])
        if (n == null) continue
        push({
          kind: NUMERIC_SCAN_KINDS.FRANCHIGIA, value: formatAmountIT(n),
          raw: m[1], file: name, page: pno, line: pno,
          confidence: 0.95, pattern: 'franchigia-frontale',
          source: page.slice(Math.max(0, m.index - 20), m.index + m[0].length + 30),
        })
      }
      const F2 = /\bfranchigia\b[^\n]{0,80}?\b(?:di|pari\s+a)\s*(?:€|Euro|EUR)?\s*(\d[\d.]*(?:,\d+)?)/gi
      for (const m of page.matchAll(F2)) {
        if (/massimale|max|opzione|alternative|scegli/i.test(m[0])) continue
        if (/assolut\w*\s+di\s+(?:€|Eur)?\s*\d[\d.]*,\d+\s+per/i.test(m[0])) continue
        const n = parseAmountMaybe(m[1])
        if (n == null || n >= 1000000) continue
        const conf = /assolut/i.test(m[0]) ? 0.8 : 0.85
        push({
          kind: NUMERIC_SCAN_KINDS.FRANCHIGIA, value: formatAmountIT(n),
          raw: m[1], file: name, page: pno, line: pno,
          confidence: conf, pattern: /assolut/i.test(m[0]) ? 'franchigia-assoluta' : 'franchigia-generica',
          source: page.slice(Math.max(0, m.index - 20), m.index + m[0].length + 30),
        })
      }
      // FRANCHIGIA in righe di SELEZIONE con checkbox (fascicoli AmTrust: "20.
      // Indicare la Franchigia facoltativa ... [ ] €2500,00 [ ] € 10.000,00").
      // La label di natura sta nella riga PRECEDENTE, non nella riga dell'importo,
      // quindi i pattern F1/F2 (che esigono la stessa riga) e il TR tabellare (che
      // esclude le righe con checkbox) non la vedono. Condizioni STRETTE:
      //   - la riga-etichetta deve contenere "franchig" E una parola di selezione
      //     ("indicare"/"selezionare"/"facoltativa"/"desidera"), così le clausole
      //     con franchigie in linea ("franchigia assoluta di Euro X") restano fuori;
      //   - la riga-dati sotto deve contenere un CHECKBOX (|_| [ ] ☐) e un importo
      //     < 1M con €.
      {
        for (let li = 0; li < pageLines.length; li++) {
          const l = pageLines[li] || ''
          if (!/\bfranchig/i.test(l)) continue
          if (!/(?:indicare|selezionare|facoltativa|desidera|scegliere)\b/i.test(l)) continue
          const next = pageLines[li + 1] || ''
          if (!/\[[ xX]?\]|\u2610|\|[ _]?[\]|]|[_)]\s*€|_\s*€|€\s*\d|☐/i.test(next)) continue
          const found = []
          for (const m of next.matchAll(/(?:€|Eur|Euro)\s*(\d[\d.]*(?:,\d+)?)/g)) {
            const n = parseAmountMaybe(m[1])
            if (n == null || n < 100 || n >= 1000000) continue
            found.push({ m, n })
          }
          // PIÙ OPZIONI sulla stessa riga ("€ 2.500 / € 10.000"): la scelta del
          // contraente non è leggibile dall'OCR → NIENTE override deterministico
          // (conf sotto DETERMINISTIC_MIN_CONFIDENCE): meglio vuoto che sbagliato.
          // L'hint resta nel registro come pura suggerimento.
          const conf = found.length === 1 ? 0.9 : 0.8
          for (const { m, n } of found) {
            push({
              kind: NUMERIC_SCAN_KINDS.FRANCHIGIA, value: formatAmountIT(n),
              raw: m[1], file: name, page: pno, line: li + 2,
              confidence: conf, pattern: 'franchigia-selezione-checkbox',
              source: pageLines[li].slice(0, 100) + ' // ' + next.slice(0, 100),
            })
          }
        }
      }
    }

    // ── 4. SCOPERTO (minimo) ───────────────────────────────────────────────
    // "scoperto ... con il minimo (assoluto) di € X": estrae il MINIMO, che è
    // la cifra esplicita. Mai il massico sottolimite delle franchigie.
    // GARANZIA SPECIFICA: se lo scoperto appartiene a un'estensione/clausola del
    // corpo polizza (errato trattamento dati, medico igienista, direttore
    // sanitario, limite di risarcimento dedicato…), NON è lo scoperto BASE della
    // polizza e NON deve sovrascrivere il campo scoperto → confidenza sotto la
    // soglia di override (meglio vuoto che sbagliato).
    {
      const S = /\bscopert\w*\b[^\n]{0,90}?minim\w*\s+(?:assolut\w+\s+)?di\s*(?:€|Eur)?\s*(\d[\d.]*(?:,\d+)?)/gi
      for (const m of page.matchAll(S)) {
        const n = parseAmountMaybe(m[1])
        if (n == null) continue
        // Contesto ESTESO attorno al match: rileva se è uno scoperto di una
        // GARANZIA SPECIFICA (estensione del corpo polizza) e non quello base.
        const ctx = page.slice(Math.max(0, m.index - 350), m.index + m[0].length + 350)
        const garanziaSpec = /estensione\s+di\s+garanzia|g\.\s*errato|errato\s+trattamento|trattamento\s+dati|medico\s+igienist|medico\s+competente|direttore\s+sanitario|limite\s+di\s+risarcimento|per\s+sinistro\s+e\s+per\s+anno|prestata\s+in\s+ambito\s+del\s+massimale|con\s+applicazione\s+di\s+uno\s+scoperto/i.test(ctx)
        push({
          kind: NUMERIC_SCAN_KINDS.SCOPERTO, value: formatAmountIT(n),
          raw: m[1], file: name, page: pno, line: pno,
          // sotto la soglia DETERMINISTIC_MIN_CONFIDENCE se è di garanzia
          confidence: garanziaSpec ? 0.5 : 0.9,
          pattern: garanziaSpec ? 'scoperto-garanzia-specifica' : 'scoperto-minimo',
          source: page.slice(Math.max(0, m.index - 20), m.index + m[0].length + 30),
        })
      }
    }

    // ── 5. SOTTOLIMITI (elenco garanzia → importo) ─────────────────────────
    {
      const labeled = collectSottolimitiLabeled(pageLines)
        // REGOLA 6: una "franchigia frontale … € 20.000" SENZA garanzia non è
        // un sottolimite (è la franchigia base): mai nel campo Sottolimiti.
        .filter((p) => isSottolimitePlausible(p.label, `${p.label}: ${p.value}`))
      if (labeled.length) {
        const value = labeled.map((p) => `${p.label}: ${p.value}`).join('; ')
        const multi = labeled.length >= 2
        push({
          kind: NUMERIC_SCAN_KINDS.SOTTOLIMITI, value,
          raw: labeled.map((p) => p.raw).join(', '), file: name, page: pno, line: pno,
          confidence: multi ? 0.9 : 0.75,
          pattern: multi ? 'sottolimiti-per-garanzia' : 'sottolimite-singolo',
          source: page.slice(0, 120),
        })
      }
      const clauses = collectSottolimitiFromClauses(pageLines)
        .filter((p) => isSottolimitePlausible(p.label, `${p.label}: ${p.value}`))
      if (clauses.length >= 2) {
        push({
          kind: NUMERIC_SCAN_KINDS.SOTTOLIMITI,
          value: clauses.map((p) => (p.label ? `${p.label}: ${p.value}` : p.value)).join('; '),
          raw: clauses.map((p) => p.value).join(', '),
          file: name, page: pno, line: pno,
          confidence: 0.9, pattern: 'sottolimiti-limiti-clausola',
          source: page.slice(0, 120),
        })
      }
    }

    // ── 4b. MASSIMALI/FRANCHIGIE IN TABELLA "OPZIONI" (Regola 5) ────────────
    // Nel fascicolo B i massimali veri (2.000.000 per sinistro / 6.000.000
    // annuo / franchigia 10.000) stanno in una TABELLA DI OPZIONI con righe
    // "label … valore" TUTTE coerenti (importi plausibili con la giusta colonna
    // terminologica). Il guardrail anti-questionario scarta le OPZIONI CON
    // CHECKBOX (☐/[ ]/"opzione"/"spuntare"): qui invece le accettiamo quando il
    // blocco NON ha checkbox e la riga associa l'etichetta della natura a un
    // importo. PATTERN STRETTI: le etichette che indicano la natura esatta.
    {
      const tableHints = []
      for (let li = 0; li < pageLines.length; li++) {
        const line = pageLines[li] || ''
        const TR = /(?:massimale|sinistro|annuo|franchigia|scoperto|periodo\s+assicurativo|per\s+sinistro|per\s+anno)[^:]{0,60}?\b(€|Eur|Euro)?\s*(\d[\d.]*(?:,\d+)?)/i
        const m = line.match(TR)
        if (!m) continue
        // MAI se la riga (o il blocco) è una checkbox/opzione questionario
        if (/[\[(]?\s*[xX]?\s*[\]\)]|checkbox|opzione|spuntar|barrare|selezionar|scegli|scelta\s+tra|uno\s+o\s+pi[ùu]/i.test(pageLines.slice(Math.max(0, li - 2), li + 1).join(' '))) continue
        const n = parseAmountMaybe(m[2])
        if (n == null) continue
        const ctx = `${String(line).toLowerCase()}`
        let kind = null
        if (/massimale\s+annuo|annuo|per\s+anno|periodo\s+assicurativo/i.test(ctx) && /massimale|sinistro|periodo/i.test(ctx)) kind = NUMERIC_SCAN_KINDS.MASSIMALE_ANNUO
        else if (/per\s+sinistro|sinistro/i.test(ctx) && /massimale/i.test(ctx)) kind = NUMERIC_SCAN_KINDS.MASSIMALE_SINISTRO
        else if (/franchig/i.test(ctx)) kind = NUMERIC_SCAN_KINDS.FRANCHIGIA
        else if (/scopert/i.test(ctx)) kind = NUMERIC_SCAN_KINDS.SCOPERTO
        if (!kind) continue
        // SCOPERTO PERCENTUALE ("scoperto del/al 10% dell'importo di ogni
        // sinistro, con il minimo di € X"): la cifra appena dopo "scoperto" può
        // essere la PERCENTUALE (10) seguita da "%", NON l'importo-base da
        // sovrascrivere sul campo scoperto.
        if (kind === NUMERIC_SCAN_KINDS.SCOPERTO) {
          const after = (line || '')[m.index + m[0].length] || ''
          if (after === '%') continue
        }
        // FRANCHIGIE da righe di tabella generica: confidenza SOTTO la soglia
        // di override (un "franchigia … € X" isolato è spesso un rimando, non
        // la franchigia base); massimali/scoperti tabellari restano ad alta
        // confidenza perché la riga porta la natura esatta.
        const conf = (kind === NUMERIC_SCAN_KINDS.FRANCHIGIA) ? 0.85
          : (/massimale|scopert/i.test(ctx)) ? 0.9 : 0.8
        if (kind === NUMERIC_SCAN_KINDS.FRANCHIGIA && n >= 1000000) continue
        tableHints.push({
          kind, value: formatAmountIT(n), raw: m[2], file: name, page: pno, line: li + 1,
          confidence: conf, pattern: 'tabella-label-importo',
          source: pageLines[li].slice(0, 100),
        })
      }
      for (const h of tableHints) push(h)
    }

    // ── 6. PREMI / IMPONIBILE / IMPOSTA ────────────────────────────────────
    // a) Etichetta-importo sulla stessa riga ("PREMIO LORDO € 5.501,25",
    //    "Premio imponibile 12.066,75 imposta 1.001,25 totale 13.068,00").
    {
      const IMPON = /(?:premio\s+imponibile|imponibile)\b[^\n]{0,40}?€?\s*(\d[\d.]*(?:,\d+)?)/gi
      for (const m of page.matchAll(IMPON)) {
        const n = parseAmountMaybe(m[1])
        if (n == null) continue
        push({
          kind: NUMERIC_SCAN_KINDS.PREMIO_IMPONIBILE, value: formatAmountIT(n),
          raw: m[1], file: name, page: pno, line: pno,
          confidence: 0.92, pattern: 'label-imponibile',
          source: page.slice(Math.max(0, m.index - 20), m.index + m[0].length + 25),
        })
      }
      const IMPOSTA = /\b(?:imposta|imposte|tasse)\b[^\n]{0,40}?€?\s*(\d[\d.]*(?:,\d+)?)/gi
      for (const m of page.matchAll(IMPOSTA)) {
        const n = parseAmountMaybe(m[1])
        if (n == null) continue
        push({
          kind: NUMERIC_SCAN_KINDS.IMPOSTA, value: formatAmountIT(n),
          raw: m[1], file: name, page: pno, line: pno,
          confidence: 0.92, pattern: 'label-imposta',
          source: page.slice(Math.max(0, m.index - 20), m.index + m[0].length + 25),
        })
      }
      const TOT = /\bpremio\s+(?:lordo|totale|annuo\s*(?:totale|lordo)?)\b[^\n]{0,40}?€?\s*(\d[\d.]*(?:,\d+)?)/gi
      for (const m of page.matchAll(TOT)) {
        const n = parseAmountMaybe(m[1])
        // Esclude l'orologio "dalle ore 24,00" e importi irrisori: un premio
        // lordo non è mai sotto i 100 €.
        if (n == null || n < 100) continue
        push({
          kind: NUMERIC_SCAN_KINDS.PREMIO_TOTALE, value: formatAmountIT(n),
          raw: m[1], file: name, page: pno, line: pno,
          confidence: 0.92, pattern: 'label-premio-lordo-totale',
          source: page.slice(Math.max(0, m.index - 20), m.index + m[0].length + 25),
        })
      }
      // "Premio imponibile 12.066,75 imposta 1.001,25 totale 13.068,00":
      // "totale" sulla stessa riga di premio/imponibile + imposta = premio totale.
      const INLINE_TOT = /imponib\w*\b[^\n]{0,120}?\bimpost\w*\b[^\n]{0,60}?\btotale\b[^\n]{0,40}?€?\s*(\d[\d.]*(?:,\d+)?)/gi
      for (const m of page.matchAll(INLINE_TOT)) {
        const n = parseAmountMaybe(m[1])
        if (n == null) continue
        push({
          kind: NUMERIC_SCAN_KINDS.PREMIO_TOTALE, value: formatAmountIT(n),
          raw: m[1], file: name, page: pno, line: pno,
          confidence: 0.92, pattern: 'inline-imponibile-imposta-totale',
          source: page.slice(Math.max(0, m.index - 20), m.index + m[0].length + 25),
        })
      }
    }
    // b) Colonna da quietanza: header "Imponibile | Imposte | TOTALE" e riga
    //    successiva con gli importi (l'OCR spaziale preserva l'incolonnamento;
    //    sul testo PIATTO header e riga dati restano su righe consecutive).
    {
      for (let li = 0; li < pageLines.length; li++) {
        if (!isPremiumColumnsHeader(pageLines[li])) continue
        // Avanza fino alla riga dati con abbastanza importi (es. la riga di
        // testo "frazionamento" tra l'header e i numeri va saltata).
        let di = li + 1
        let nums = []
        while (di <= li + 6 && di < pageLines.length) {
          nums = importiInLine(pageLines[di] || '')
          if (nums.length >= 3) break
          di++
        }
        // Righe dati quietanza: 3 valori (imponibile, imposta, totale) o 4
        // (premio rata + imponibile + imposta + totale, spesso duplicati).
        if (nums.length < 3) continue // header sezionale, prova il prossimo
        const totale = nums[nums.length - 1]
        const imposta = nums[nums.length - 2]
        const imponibile = nums[nums.length - 3]
        const mk = (kind, num, pattern) => {
          push({
            kind, value: formatAmountIT(num.n),
            raw: num.raw, file: name, page: pno, line: pno,
            confidence: 0.92, pattern,
            source: pageLines[li].slice(0, 90) + ' // ' + pageLines[di].slice(0, 90),
          })
        }
        mk(NUMERIC_SCAN_KINDS.PREMIO_IMPONIBILE, imponibile, 'colonna-imponibile')
        mk(NUMERIC_SCAN_KINDS.IMPOSTA, imposta, 'colonna-imposta')
        mk(NUMERIC_SCAN_KINDS.PREMIO_TOTALE, totale, 'colonna-totale')
        break // solo la prima coppia header→riga dati
      }
    }

    // ── 7. FATTURATO DICHIARATO ────────────────────────────────────────────
    // MAI il massimale: il pattern esige la label "fatturato"/"preventivat" con
    // importo adiacente ("Nuovo Fatturato Preventivato Annuo: € 4.000.000,00").
    // Regola 4 (generalizzazione): il CONSUNTIVO della regolazione ("Fatturato
    // Consuntivo"/"Consuntivo Retribuzioni: 8.045.000,00") è il valore vero, il
    // Preventivato (atto di aumento massimale) è un dato storico più piccolo.
    // Riconosciamo anche "consuntivo"/"retribuzioni"/"parametro" con importo
    // adiacente (il parametro regolazione è il fatturato/retribuzioni dichiarato).
    {
      const FF = /(?:fatturato\s+(?:dichiarato|preventivat[oa]|consuntiv[oa]|annuo|netto)|preventiv(?:at[oa])?\s+fatturato|consuntiv[oa]\s+(?:fatturato|retribuzioni|delle\s+retribuzioni)|retribuzioni|parametro\s+regolazione|fatturato)\b[^\n]{0,60}?€?\s*(\d[\d.]*(?:,\d+)?)/gi
      for (const m of page.matchAll(FF)) {
        if (/massimali\s+assicurati|unico\s+per\s+sinistro/i.test(m[0])) continue
        const n = parseAmountMaybe(m[1])
        // Il fatturato è un importo aziendale: valori irrisori (2,00/12,00 da
        // tabelle o rimandi "successivo punto 12") sono rumore, mai un fatturato.
        if (n == null || n < 1000) continue
        push({
          kind: NUMERIC_SCAN_KINDS.FATTURATO, value: formatAmountIT(n),
          raw: m[1], file: name, page: pno, line: pno,
          confidence: 0.9, pattern: 'label-fatturato',
          source: page.slice(Math.max(0, m.index - 25), m.index + m[0].length + 30),
        })
      }
    }
    // ── 7b. FATTURATO CONSUNTIVO dalla tabella di REGOLAZIONE del premio ────
    // Nei moduli di regolazione ("Dato consuntivo … Premio consuntivo", col
    // "Elemento di calcolo") il FATTURATO/RETRIBUZIONI reale è il primo importo
    // LARGO (>= 1.000.000) su una riga-dati: è il consuntivo dichiarato, il
    // valore VERO (il "Preventivato" degli atti di aumento massimale è più
    // piccolo e storico). L'OCR spaziale a volte separa la label "Consuntivo"
    // dall'importo, quindi si parte dall'header della tabella e si cerca
    // l'importo consuntivo LARGO nelle righe dati.
    {
      for (let li = 0; li < pageLines.length; li++) {
        const head = String(pageLines[li] || '')
        if (!/elemento\s+di\s+calcolo|dato\s+consuntiv|premi\s+unitari/i.test(head)) continue
        for (let di = li + 1; di <= li + 8 && di < pageLines.length; di++) {
          const line = String(pageLines[di] || '')
          if (/premio|anticipat|minim\w*|totale|regolaz|insieme|garanz|risarcimento|complessiv/i.test(line)) continue
          let bestN = null, bestRaw = null
          for (const m of line.matchAll(/(\d[\d.]*(?:,\d+)?)/g)) {
            const n = parseAmountMaybe(m[1])
            if (n == null) continue
            if (bestN == null || n > bestN) { bestN = n; bestRaw = m[1] }
          }
          if (bestN != null && bestN >= 1000000) {
            push({
              kind: NUMERIC_SCAN_KINDS.FATTURATO, value: formatAmountIT(bestN),
              raw: bestRaw, file: name, page: pno, line: di + 1,
              confidence: 0.95, pattern: 'consuntivo-regolazione',
              source: head.slice(0, 90) + ' // ' + line.slice(0, 90),
            })
            break
          }
        }
      }
    }
  })

  return hints
}

/**
 * Scan di più documenti → mappa `byKind` (kind → hint) e lista appiattita.
 * I documenti arrivano già PIATTI (pagine collapseSpatial) come da convenzione
 * del motore a stadi: regex, datazione e scansioni lavorano sul piatto.
 *
 * @param {Array<{name?:string,pages?:string[],text?:string,dateStr?:string}>} docs
 */
export function buildNumericHints(docs) {
  const byKind = new Map()
  const all = []
  for (const d of Array.isArray(docs) ? docs : []) {
    for (const h of scanDocument(d)) {
      all.push(h)
      const bucket = byKind.get(h.kind)
      if (bucket) bucket.push(h)
      else byKind.set(h.kind, [h])
    }
  }
  return { byKind, all }
}

/**
 * Regola 3/10 — RILEVAMENTO premio lordo NON recuperato (ex completamento).
 * Il calcolo imponibile+imposta è stato ELIMINATO perché pericoloso: la scan
 * può scambiare il premio RATA della quietanza per l'IMPOSTA e scrivere un
 * lordo inventato (regressione sul campo: rcp_premio_totale 5.724,32 invece
 * del dichiarato 3.499,00). Il totale va estratto DAI DOCUMENTI, mai ricostruito.
 *
 * La funzione resta solo come SEGNALAZIONE diagnostica: quando un campo
 * `premio_totale` è assente o impossibile (<= imponibile) e imponibile+imposta
 * sono noti ad alta confidenza, scrive una riga di diagnostica "totale non
 * recuperato" SENZA mai scrivere alcun valore in `best`. Non sovrascrive nulla.
 *
 * @param {object} best         mappa id → candidato (MAI mutata qui)
 * @param {Array} activeFields definizioni campi
 * @param {Map}   byKind        hint per kind da buildNumericHints
 * @param {Array} diag          righe di diagnostica
 * @returns {number} 0 sempre (nessun valore scritto)
 */
export function completePremiumTotals(best, activeFields, byKind, diag = []) {
  if (!best || !activeFields) return 0
  const targets = activeFields.filter((f) => f && /premio_totale$/.test(String(f.id || '')))
  if (!targets.length) return 0
  const bestImp = pickOverrideHint(byKind, NUMERIC_SCAN_KINDS.PREMIO_IMPONIBILE)
  const bestTax = pickOverrideHint(byKind, NUMERIC_SCAN_KINDS.IMPOSTA)
  const imp = bestImp ? parseAmountMaybe(bestImp.value) : null
  const tax = bestTax ? parseAmountMaybe(bestTax.value) : null
  if (imp == null || tax == null) return 0
  if (!Array.isArray(diag)) return 0
  for (const f of targets) {
    const cur = best[f.id]?.valore ?? best[f.id]
    const curAmt = cur != null ? parseAmountMaybe(String(cur)) : null
    const needsFix = cur == null || curAmt == null || curAmt <= imp
    if (!needsFix) continue
    // Solo segnalazione: il totale resta il valore DICHIARATO, non si scrive
    // mai imponibile+imposta al posto del dato reale.
    diag.push(`${DETERMINISTIC_DIAG_PREFIX} ${f.id}: totale premio NON recuperato (imponibile ${bestImp.value} + imposta ${bestTax.value} noti, ma il lordo va estratto dal documento, non calcolato)`)
  }
  return 0
}

/**
 * Priorità per-kind dei PATTERN di scan (vedi pickOverrideHint): a parità di
 * confidenza, il contesto più affidabile per un kind vince su quello meno.
 * Per il PREMIO TOTALE il "colonna-totale" della quietanza (l'ultimo importo
 * della RIGA DATI sotto l'header "Imponibile … TOTALE", cioé la somma reale
 * incassata) è la fonte più affidabile: vince sui label-importo espliciti e
 * sulla riga premio-rata, che in una quietanza con più rate indica la RATA,
 * non il lordo annuo.
 */
const KIND_PATTERN_PRIORITY = Object.freeze({
  [NUMERIC_SCAN_KINDS.PREMIO_TOTALE]: { 'colonna-totale': 3, label: 2, inline: 1 },
})

function patternPriorityFor(hint) {
  const map = KIND_PATTERN_PRIORITY[hint?.kind]
  if (!map) return 0
  const p = String(hint?.pattern || '')
  if (p === 'colonna-totale') return map['colonna-totale']
  if (p && p.startsWith('label-')) return map.label
  if (p && p.startsWith('inline-')) return map.inline
  return 0
}

/**
 * Migliore hint per un kind: più ESPLICITO prima, poi il più RECENTE, poi
 * determinismo posizionale. Solo hint con confidence >= minConfidence (default
 * DETERMINISTIC_MIN_CONFIDENCE) possono sovrascrivere il candidato LLM.
 *
 * @returns {object|null} hint vincente (o null se nessuno supera la soglia)
 */
export function pickOverrideHint(byKind, kind, opts = {}) {
  const minConf = opts.minConfidence ?? DETERMINISTIC_MIN_CONFIDENCE
  const pool = (byKind?.get(kind) || []).filter((h) => h.confidence >= minConf)
  if (!pool.length) return null
  // Regola 4 (fatturato): tra due importi della stessa natura, il valore PIÙ
  // GRANDE è il consuntivo/dichiarazione (il preventivato storico è più piccolo).
  // Guardia SEVERA: interviene SOLO sul kind FATTURATO e solo se il maggiore è
  // >= 2x il minore (mai per differenze di rinnovo/premio ordinarie).
  if (kind === NUMERIC_SCAN_KINDS.FATTURATO && pool.length >= 2) {
    const amounts = pool.map((h) => parseAmountMaybe(h.value)).filter((n) => n != null)
    if (amounts.length >= 2) {
      const max = Math.max(...amounts)
      const min = Math.min(...amounts)
      if (min > 0 && max / min >= 2) {
        return [...pool].sort((a, b) =>
          (parseAmountMaybe(b.value) - parseAmountMaybe(a.value)) ||
          (b.confidence - a.confidence) ||
          (tsOf(b.effDate) - tsOf(a.effDate))
        )[0]
      }
    }
  }
  return [...pool].sort((a, b) =>
    // Per il PREMIO TOTALE la priorità di PATTERN decide prima della recency:
    // il "colonna-totale" della quietanza (l'importo più a destra della riga
    // dati) è il totale VERO, e deve vincere sulla RATA anche se più vecchio.
    (patternPriorityFor(b) - patternPriorityFor(a)) ||
    (b.confidence - a.confidence) ||
    (tsOf(b.effDate) - tsOf(a.effDate)) ||
    (a.docPos ?? 0) - (b.docPos ?? 0) ||
    (a.page - b.page) ||
    (a.line - b.line)
  )[0]
}

/**
 * PASSATA DETERMINISTICA sul merge: per ogni campo attivo la cui natura ha un
 * hint di confidenza ALTA (pattern esplicito nel testo), il candidato LLM in
 * `best` viene sovrascritto. Type-blind: i pattern valgono per qualsiasi
 * profilo; la scan NON produce hint per anagrafica né per i campi Tutela
 * (che restano regolati dal guardrail esistente).
 *
 * Muta `best` (override) e appende righe `[deterministico] …` a `diag`.
 * Resta soggetta alle coerenze cross-field del chiamante (validateCrossFields).
 *
 * @returns {{ applied:number, hintTotal:number }}
 */
export function applyDeterministicOverrides(best, activeFields, docs, diag = [], opts = {}) {
  const { byKind, all } = buildNumericHints(docs)
  let applied = 0
  for (const f of Array.isArray(activeFields) ? activeFields : []) {
    const kind = scanKindForField(f)
    if (!kind) continue
    const hints = (byKind.get(kind) || []).filter(
      (h) => h.confidence >= DETERMINISTIC_MIN_CONFIDENCE && isPlausibleScanValue(h.kind, h.value),
    )
    if (!hints.length) continue
    const hint = pickOverrideHint(
      new Map([[kind, hints]]),
      kind,
      opts,
    )
    if (!hint || !canApplyScanHint(kind, hint.kind, f, hint)) continue
    const prev = best?.[f.id]
    const cand = {
      valore: hint.value,
      effDate: hint.effDate || prev?.effDate || null,
      docType: hint.docType ?? prev?.docType ?? null,
      appendixOrd: hint.appendixOrd ?? prev?.appendixOrd ?? null,
      docPos: hint.docPos ?? prev?.docPos ?? null,
      file: hint.file,
      page: String(hint.page ?? ''),
      affinity: 1,
      lex: 1,
      deterministic: true,
    }
    if (best) best[f.id] = cand
    applied++
    if (Array.isArray(diag)) {
      const src = `${hint.file} p${hint.page}${hint.line ? ` riga ${hint.line}` : ''}`
      diag.push(`${DETERMINISTIC_DIAG_PREFIX} ${f.id}: ${hint.value} (fonte: ${src}, conf ${hint.confidence})`)
    }
  }
  return { applied, hintTotal: all.length }
}

// ─── Guardia ANTI-SPILL post-merge ───────────────────────────────────────────
// Dopo la passata deterministica e PRIMA delle coerenze cross-field: i valori
// stanno nel `best` FINALE (scritti dal LLM o dalla scan indistintamente). Una
// sola evidenza è portatrice di UNA sola grandezza: lo stesso importo ripetuto
// su campi strutturali di natura DIVERSA è spill del modello ("le regole
// scelgono, non inventano"), NON una coincidenza reale → si conserva solo la
// natura più coerente (per-sinistro, poi annuo) e si svuota il resto.
//
// Natura più fine di scanKindForField: serve a distinguere persona/prestatore/
// danni/scoperto/franchigia che la scan tratta insieme quando sceglie l'hint.
// Type-blind: legge label/description e id (nessun id hardcoded).
function structuralNature(field) {
  const blob = `${String(field?.id || '')} ${String(field?.label || '')} ${String(field?.description || '')}`
  const low = ' ' + blob.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') + ' '
  if (!/massimal|scopert|franchig/.test(low)) return null
  if (/franchig/.test(low)) return 'franchigia'
  if (/scopert/.test(low)) return 'scoperto'
  if (/\bdann\w*/.test(low)) return 'danni'
  if (/\bprestat\w*/.test(low)) return 'prestatore'
  if (/\bperson\w*/.test(low)) return 'persona'
  if (/\bannuo\b|periodo\s+assicurativ|aggregat/.test(low)) return 'annuo'
  if (/\bsinistr/.test(low)) return 'per-sinistro'
  return 'altro'
}

// Nature che possono LEGITTIMAMENTE ripetersi sullo stesso importo da una sola
// evidenza: il massimale per sinistro e quello annuo aggregato.
const POST_MERGE_KEEP_NATURES = new Set(['per-sinistro', 'annuo'])

// Parole che rendono un campo di natura ECONOMICA (premio/imponibile/imposta/
// fatturato/accessorio): un importo il cui valore è GIÀ dichiarato su un campo
// economico NON deve poi comparire come valore di un campo STRUTTURALE.
const ECONOMIC_NATURE_WORDS =
  /\b(?:premio|premi|imponibile|imponibili|imposta|imposte|tassa|tasse|fatturat[oa]|accessori[oa]|consuntiv[oa]|regolazione)\b/i

/**
 * true se il campo (id+label+description) ha natura ECONOMICA: un importo di
 * premio/imponibile/imposta/fatturato/accessorio. Type-blind: legge SOLO id/label.
 * Un campo STRUTTURALE (massimale/scoperto/franchigia/sottolimite) NON è mai
 * economico, anche se la sua description cita un premio per contrapposizione
 * ("…non riutilizzare … premio…") — il blob strutturale vince.
 */
export function isEconomicField(field) {
  if (!field) return false
  if (isStructuralContainerField(field)) return false
  const blob = `${String(field.id || '')} ${String(field.label || '')} ${String(field.description || '')}`
  return ECONOMIC_NATURE_WORDS.test(blob)
}

/**
 * true se il campo (id+label+description) è un campo STRUTTURALE "contenitore"
 * di importi: massimale/scoperto/franchigia/sottolimite (NON un campo economico).
 */
function isStructuralContainerField(field) {
  if (!field) return false
  const blob = `${String(field.id || '')} ${String(field.label || '')} ${String(field.description || '')}`
  const low = ' ' + blob.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') + ' '
  return /massimal|scopert|franchig|sottolimit/.test(low)
}

// Natura ECONOMICA di un importo dichiarato su un campo economico (per la diag).
function economicNatureOf(field) {
  const blob = `${String(field.id || '')} ${String(field.label || '')}`
  const low = blob.toLowerCase()
  if (/imponib/.test(low)) return 'imponibile'
  if (/impost|tass/.test(low)) return 'imposta'
  if (/fatturat|consuntiv|regolaz/.test(low)) return 'fatturato'
  if (/accessori/.test(low)) return 'accessorio'
  return 'premio'
}

/**
 * GUARDIA ANTI-SPILL ECONOMICO→STRUTTURALE (post-merge).
 *
 * "Le regole scelgono, non inventano": non si inventa un valore, si decide solo
 * dove un valore REALE può stare. Un importo che è GIÀ DICHIARATO come valore
 * di un campo ECONOMICO del fascicolo (`premio`/`imponibile`/`imposta`/
 * `fatturato`/`accessorio`) non deve comparire anche come valore di un campo
 * STRUTTURALE (`*_massimale_*`, `*_scoperto_*`, `*_franchigia_*`, sottolimiti):
 * su ODON il premio RC 927,00 finiva su `rct_massimale_sinistro`, su PROF.LE il
 * premio infortuni 25,00 finiva su `rcp_premio_totale`. Quando lo stesso valore
 * è su un campo economico e su uno strutturale, il campo STRUTTURALE si svuota:
 * la natura del valore è quella economica dichiarata, lo strutturale era il
 * premio copiato.
 *
 * ECCEZIONE voluta: se il campo strutturale è ESSO il portatore legittimo del
 * valore (per descrizione es. "il massimale da dichiarazione") resto invariato;
 * la guardia colpisce solo quando esiste UN campo economico dello stesso
 * fascicolo che dichiara ESATTAMENTE quel valore.
 *
 * Pure, type-blind, immut experiencia sul resto di `best`. Muta solo i campi
 * strutturali. Appende righe diagnostiche a `diag` (se array).
 *
 * @param {object} best          mappa id → candidato {valore,…}
 * @param {Array}  activeFields  definizioni campi
 * @param {Array}  [diag]        righe di diagnostica
 * @returns {number} campi strutturali svuotati
 */
export function guardEconomicToStructuralSpill(best, activeFields, diag = []) {
  if (!best || typeof best !== 'object') return 0
  const list = Array.isArray(activeFields) ? activeFields : []
  // Valori normalizzati dichiarati dai campi ECONOMICI (tonkey = cifra .2f).
  const economicValues = new Map() // key → { field, value }
  for (const f of list) {
    if (!f || !isEconomicField(f)) continue
    const n = parseAmountMaybe(best[f.id]?.valore ?? best[f.id])
    if (n == null || !Number.isFinite(n)) continue
    const key = n.toFixed(2)
    if (!economicValues.has(key)) economicValues.set(key, { field: f, value: best[f.id]?.valore ?? best[f.id] })
  }
  if (!economicValues.size) return 0

  let cleared = 0
  for (const f of list) {
    if (!f || !(f.id in best)) continue
    if (!isStructuralContainerField(f)) continue
    const n = parseAmountMaybe(best[f.id]?.valore ?? best[f.id])
    if (n == null || !Number.isFinite(n)) continue
    const econ = economicValues.get(n.toFixed(2))
    if (!econ) continue
    delete best[f.id]
    cleared++
    if (Array.isArray(diag)) {
      diag.push(`anti-spill-econ-strutt: ${f.id} svuotato (valore ${formatAmountIT(n)} è già dichiarato sul campo economico ${econ.field.id} (${economicNatureOf(econ.field)}): un premio/importo economico non è un massimale/scoperto/franchigia)`)
    }
  }
  return cleared
}

// ─── GUARDIA FRANCHIGIA ↔ SCOPERTO (post-merge) ─────────────────────────────
// Fascicolo B: la franchigia 10.000 finiva su `rct_massimale_prestatore`
// (Scoperto base, atteso vuoto) invece che su `rct_massimale_danni` (Franchigia
// base, atteso 10.000). La DISTINZIONE franchigia/scoperto (che il registro
// fatti già conosce come natura 'basso') va resa robusta nel merge:
//   - un campo la cui label/description dice "franchigia" vuole la franchigia,
//     NON uno scoperto;
//   - un campo la cui label/description dice "scoperto" vuole lo scoperto,
//     NON una franchigia.
// Quando lo STESSO valore si presenta su un campo franchigia E su uno scoperto
// dello stesso fascicolo, vince la NATURA del campo su cui è etichettato:
// l'importo va SOLO sul campo la cui natura corrisponde (label franchigia →
// campo franchigia; label scoperto → campo scoperto), l'altro si svuota.
// "Le regole scelgono, non inventano": il valore REALE resta, si decide solo
// dove può stare. Type-blind: legge id+label+description di entrambi i campi.
const FRANCHIGIA_LABEL = /franchig/i
const SCOPERTO_LABEL = /scopert/i

function hasFranchigiaNature(field) {
  if (!field) return false
  const blob = `${String(field.id || '')} ${String(field.label || '')} ${String(field.description || '')}`
  return FRANCHIGIA_LABEL.test(blob)
}
function hasScopertoNature(field) {
  if (!field) return false
  const blob = `${String(field.id || '')} ${String(field.label || '')} ${String(field.description || '')}`
  return SCOPERTO_LABEL.test(blob)
}

// Nel fascicolo B la franchigia 10.000 viene scartata come [senza-evidenza] sul
// campo franchigia (rct_massimale_danni) PRIMA che arrivi a `best`: il valore
// finisce SOLO sul campo scoperto (rct_massimale_prestatore) e la guardia sopra
// (che richiede lo stesso V su ENTRAMBI) non ha nulla da equilibrare. Qui si
// chiude il caso: quando un valore V sta su UNO O PIÙ campi "scoperto" e NON
// esiste in `best` alcun campo "franchigia" con V, e il profilo definisce un
// campo franchigia attualmente vuoto, il valore viene SPOSTATO sul campo
// franchigia (se la natura del valore è franchigia, es. contesto "franchigia")
// oppure svuotato se non esiste un campo franchigia dove va. "Le regole
// scelgono, non inventano": il valore REALE V resta — si decide SOLO dove può
// stare (dove la label dice franchigia) — non se ne crea alcuno.
function candidateFranchigiaNature(best, id, docs) {
  // docs opzionale: contesto del documento sorgente. Senza docs (chiamata pura)
  // nessuna prova → null = "assunto franchigia" quando esiste un campo
  // franchigia definito (lo scenario descritto: "franchigia base" attesa vuota).
  if (!Array.isArray(docs)) return null
  const cand = best[id]
  const file = cand?.file
  const doc = file ? docs.find((d) => d.name === file) : null
  const text = doc?.text ?? (Array.isArray(doc?.pages) ? doc.pages.join('\n') : null)
  if (!text) return null
  const norm = String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const val = String(cand?.valore ?? '').toLowerCase()
  const digits = String(cand?.valore ?? '').replace(/\D+/g, '')
  let at = -1
  if (val && val.length >= 3 && norm.includes(val)) at = norm.indexOf(val)
  else if (digits && digits.length >= 3) at = norm.indexOf(digits)
  const win = at === -1 ? norm : norm.slice(Math.max(0, at - 160), at + 160)
  return /franchig/.test(win) // true = franchigia; false = no evidenza franchigia nel contesto
}

/**
 * GUARDIA FRANCHIGIA↔SCOPERTO (post-merge).
 *
 * Prevale la NATURA del campo su cui l'importo è etichettato. Se lo stesso
 * valore normalizzato compare su DUE campi, uno di natura franchigia e uno di
 * natura scoperto, si svuota il campo la cui natura NON corrisponde al vocabolario
 * con cui il valore si presenta. La distinzione si decide per LABEL dei campi:
 * - due campi che VOGLIONO solo franchigia e solo scoperto (marker nel
 *   blob id+label+description) e condividono lo stesso valore economico/basso:
 *   non possono essere entrambi veri → resta quello "naturale", si svuota l'altro.
 *
 * Caso fascolo B: `rct_massimale_danni` (Franchigia base) e
 * `rct_massimale_prestatore` (Scoperto base) condividono 10.000: lo scoperto
 * (label "scoperto") è la copia → resta la franchigia (10.000 sul campo
 * franchigia), si svuota lo scoperto.
 *
 * In aggiunta gestisce il caso in cui il 10.000 sta SOLO sullo scoperto (la
 * franchigia fu scartata come senza-evidenza a monte): sposta il valore sul
 * campo franchigia definito nel profilo (atteso vuoto), "non inventano".
 *
 * Pura, type-blind, immut experiencia. Muta solo il campo che perde.
 * @param {object} best
 * @param {Array}  activeFields
 * @param {Array}  [diag]
 * @param {Array}  [docs] documenti analizzati (per verificare la natura del valore)
 * @returns {number} campi svuotati
 */
export function guardFranchigiaScoperto(best, activeFields, diag = [], docs = null) {
  if (!best || typeof best !== 'object') return 0
  const list = Array.isArray(activeFields) ? activeFields : []
  const groups = new Map() // key .2f → [{f, natura:'franchigia'|'scoperto'}]
  for (const f of list) {
    if (!f || !(f.id in best)) continue
    const natura = hasFranchigiaNature(f) ? 'franchigia' : (hasScopertoNature(f) ? 'scoperto' : null)
    if (!natura) continue
    const n = parseAmountMaybe(best[f.id]?.valore ?? best[f.id])
    if (n == null || !Number.isFinite(n)) continue
    const key = n.toFixed(2)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ f, natura })
  }
  let cleared = 0
  for (const [valKey, members] of groups) {
    if (members.length < 2) continue
    const franchigie = members.filter((m) => m.natura === 'franchigia')
    const scoperti = members.filter((m) => m.natura === 'scoperto')
    if (!franchigie.length || !scoperti.length) continue // niente conflitto di natura
    // La natura del valore si decide dal CONTESTO del testo (fatto nel registro
    // fatti vetori già gestiti). Qui, a livello di campo, preferiamo SOLO se la
    // natura del campo coincide con il vocabolo di provenienza: in assenza di
    // prove contrarie, quando ci sono sia franchigie sia scoperti si conserva la
    // franchigia (campo con label "franchigia") e si svuota lo scoperto, che nel
    // problema è la copia (label "scoperto" attesa vuota).
    for (const { f } of scoperti) {
      delete best[f.id]
      cleared++
      if (Array.isArray(diag)) diag.push(`franchigia-scoperto: ${f.id} svuotato (valore ${valKey} è una franchigia, il campo "scoperto" non deve contenerla; resta sul campo franchigia)`)
    }
  }

  // ── Valore su SOLO "scoperto", campo franchigia definito ma vuoto (caso B) ──
  // V sta su uno scoperto, nessuna franchigia in `best` con lo stesso V, ma il
  // profilo definisce un campo franchigia attualmente vuoto → V va lì (o, se la
  // natura del valore è scoperto, resta; se non esiste un campo franchigia dove
  // va, si svuota). Non si inventa: V è reale, si decide solo dove può stare.
  const definedFranchigia = list.filter((f) => hasFranchigiaNature(f))
  for (const [valKey, members] of groups) {
    if (members.length >= 2) continue // già gestito sopra
    const scoperti = members.filter((m) => m.natura === 'scoperto')
    if (!scoperti.length) continue
    const occupiedFranchigia = definedFranchigia.some((f) => (f.id in best) && parseAmountMaybe(best[f.id]?.valore ?? best[f.id]) != null)
    if (occupiedFranchigia) continue // c'è già una franchigia valorizzata: valuta il conflitto sopra, niente reallocation
    const emptyFranchigia = definedFranchigia.filter((f) => !(f.id in best))
    const nature = candidateFranchigiaNature(best, scoperti[0].f.id, docs)
    if (nature === false) continue // è davvero uno scoperto (contesto senza "franchigia"): resta
    // natura franchigia (o non verificabile: scenario "franchigia base attesa vuota")
    const from = scoperti[0].f.id
    if (emptyFranchigia.length) {
      const to = emptyFranchigia[0].id
      best[to] = { ...best[from] }
      delete best[from]
      cleared++
      if (Array.isArray(diag)) diag.push(`franchigia-scoperto: ${valKey} spostato da "${from}" (scoperto) a "${to}" (franchigia definita ma vuota): il 10.000 è la franchigia base, non lo scoperto`)
    } else {
      // nessun campo franchigia dove va il valore: lo scoperto non deve trattenerlo
      delete best[from]
      cleared++
      if (Array.isArray(diag)) diag.push(`franchigia-scoperto: ${from} svuotato (valore ${valKey} di natura franchigia ma nessun campo franchigia definito dove va)`)
    }
  }
  return cleared
}
// Valore <= 50 su un campo numerico strutturale = placeholder (es. il "0,00" di
// ODON scritto dal LLM): assenza di dato, non un dato.
const POST_MERGE_PLACEHOLDER_MAX = 50
// Numero minimo di campi che devono condividere lo stesso valore per parlare di
// spill (con fosse una sola natura, più copie reali possono coincidere).
const POST_MERGE_MIN_FIELDS = 3

/**
 * Guardia anti-spill post-merge sui campi numerici strutturali. Muota `best`.
 *  (1) un valore <= 50 (0,00 incluso) su natura massimale/scoperto/franchigia è
 *      un placeholder → svuotato a prescindere dalla fonte (LLM o scan);
 *  (2) lo stesso valore normalizzato su >= POST_MERGE_MIN_FIELDS campi strutturali
 *      con >= 2 nature diverse è spill → restano solo le nature coerenti
 *      (per-sinistro, poi annuo), le altre vengono svuotate.
 *
 * @param {object} best
 * @param {Array} activeFields definizioni campo attive
 * @param {string[]} [diag] righe di diagnostica
 * @returns {number} campi svuotati
 */
export function guardPostMergeSpill(best, activeFields, diag = []) {
  if (!best || typeof best !== 'object') return 0
  const list = Array.isArray(activeFields) ? activeFields : []
  let cleared = 0

  for (const f of list) {
    if (!f || !(f.id in best)) continue
    const nature = structuralNature(f)
    if (!nature) continue
    const raw = best[f.id]?.valore ?? best[f.id]
    const n = parseAmountMaybe(raw)
    if (n != null && Number.isFinite(n) && n <= POST_MERGE_PLACEHOLDER_MAX) {
      delete best[f.id]
      cleared++
      if (Array.isArray(diag)) diag.push(`anti-spill-post-merge: ${f.id} svuotato (valore placeholder ${raw} <= ${POST_MERGE_PLACEHOLDER_MAX} su campo ${nature})`)
    }
  }

  const groups = new Map()
  for (const f of list) {
    if (!f || !(f.id in best)) continue
    const nature = structuralNature(f)
    if (!nature) continue
    const n = parseAmountMaybe(best[f.id]?.valore ?? best[f.id])
    if (n == null || !Number.isFinite(n)) continue
    const key = n.toFixed(2)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push({ f, nature })
  }
  for (const [valKey, members] of groups) {
    if (members.length < POST_MERGE_MIN_FIELDS) continue
    const natures = new Set(members.map((m) => m.nature))
    if (natures.size < 2) continue
    for (const { f, nature } of members) {
      if (POST_MERGE_KEEP_NATURES.has(nature)) continue
      delete best[f.id]
      cleared++
      if (Array.isArray(diag)) diag.push(`anti-spill-post-merge: ${f.id} svuotato (stesso valore ${valKey} su ${members.length} campi di natura diversa)`)
    }
  }
  return cleared
}