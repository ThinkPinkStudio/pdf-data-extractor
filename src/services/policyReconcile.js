/**
 * RICONCILIAZIONE dei dossier di un batch per NUMERO DI POLIZZA — parte PURA.
 *
 * Il bulk propone un dossier per cartella. Nelle cartelle reali i pezzi di UNA
 * polizza stanno spesso in sottocartelle («BESA TUT. LEGALE PENALE AZIENDA» con
 * la polizza firmata e la regolazione, e «…/POLIZZA» con polizza e appendice:
 * due dossier, due righe, uno dei due «da verificare»). Nessuna regola sulla
 * STRUTTURA separa i pezzi dalle polizze diverse: «COI TECHNOLOGY SRL» ha 3
 * file sciolti e 18 sottocartelle, ognuna una polizza; «…/preventivi» sono
 * offerte d'altri; «COSTA 1A/TUT. LEGALE» è una seconda polizza. Decide la
 * PROVA: lo stesso numero di polizza stampato nei documenti. Mai il nome della
 * cartella o del file, mai il tipo di documento.
 *
 * Regole (type-blind):
 *  - dentro un dossier, i file si collegano se condividono un numero; se tutti
 *    i file numerati formano UN gruppo il dossier è UNA posizione (i file senza
 *    numero — set informativo, condizioni — la seguono); se i gruppi sono più
 *    d'uno il dossier è un CONTENITORE di polizze diverse e si spostano solo i
 *    file che portano il numero, mai gli altri;
 *  - due posizioni con un numero in comune sono la STESSA polizza e si uniscono
 *    nel dossier della posizione dal percorso più corto (la cartella madre);
 *  - un gruppo fatto solo di pezzi di contenitori non ha dove andare: resta
 *    com'è (meglio separato che mescolato);
 *  - una cartella SENZA alcun numero di polizza (solo set informativo,
 *    condizioni) che sotto di sé ha UNA sola polizza ne fa parte («COI … TUT.
 *    LEGALE PENALE» col solo set informativo, sopra «…/POLIZZA»); con due o più
 *    polizze sotto resta com'è; una polizza sotto di lei che si unisce a una
 *    cartella di FUORI (copia archiviata nel posto sbagliato) non conta;
 *  - mai come numero di polizza un codice fiscale di persona o un numero che
 *    il documento etichetta come partita IVA / codice fiscale;
 *  - il dossier unito prende il percorso più corto tra quelli uniti (la
 *    cartella madre), non quello di «…/POLIZZA».
 */

// Numero dopo un'etichetta di polizza: «Polizza n. 01469DAS00040», «N. polizza
// 212.044.0000902142», «Polizza N° 556129374», «numero di polizza: M16214347».
// Frammenti di sole cifre staccati da UNO spazio in coda al numero sono il
// kerning del text layer («01469DAS000 40» = «01469DAS00040»), come in
// joinSplitNumbers: si riattaccano solo se dopo non viene una lettera, una
// barra o un punto («n. 123456 del 2024», «123456 12/2024» restano fuori).
const LABELLED_NUM_RE = /(?:polizz[ae]?\s*(?:n(?:um(?:ero)?)?\s*[.:°º]?|nr\.?)|n(?:um(?:ero)?)?\s*[.:°º]?\s*(?:di\s+)?polizz[ae]?)\s*[:.]?\s*([A-Z0-9][A-Z0-9./\-]{4,24}(?: \d{1,4}(?![\dA-Za-z/.]))*)/gi

// Forma di un CODICE FISCALE di persona (omocodia compresa): sei lettere, anno,
// mese (lettera), giorno, comune, controllo. Stampato vicino a «polizza» nei
// moduli (BESA, RUZZA FABIO: «RZZFBA62T30F205P» letto come numero): è la
// persona, uguale in TUTTE le sue polizze, e le unirebbe tutte.
const PERSON_CF_RE = /^[A-Z]{6}[\dLMNPQRSTUV]{2}[ABCDEHLMPRST][\dLMNPQRSTUV]{2}[A-Z][\dLMNPQRSTUV]{3}[A-Z]$/

/**
 * Forma canonica di un numero: maiuscolo, senza separatori né zeri iniziali
 * («00556129374» = «556129374», «212.044.0000902142» = «2120440000902142»).
 * Un codice con meno di 5 cifre non è un numero di polizza («n. 1», «Mod. 2122»),
 * un codice fiscale di persona nemmeno.
 */
export function normalizePolicyNumber(raw) {
  const s = String(raw || '').toUpperCase().replace(/[\s./\-_]+/g, '').replace(/^0+/, '')
  if (PERSON_CF_RE.test(s)) return ''
  return (s.match(/\d/g) || []).length >= 5 ? s : ''
}

// Numero dopo un'etichetta FISCALE sulla stessa riga («PARTITA IVA: 13251900158»,
// «P.IVA/C.F. 01234567890», «Codice fiscale 80012345678»): è il contraente,
// non la polizza, anche quando la stessa cifra finisce vicino a «polizza».
const FISCAL_NUM_RE = /(?:\bpartita\s+iva|\bp\.?\s*i\.?\s*v\.?\s*a\b\.?|\bcod(?:ice)?\.?\s*fisc(?:ale)?\b\.?|\bc\.\s*f\.)\s*[:.]?\s*(?:\/\s*(?:c\.\s*f\.|cod(?:ice)?\.?\s*fisc(?:ale)?\.?)\s*[:.]?\s*)?([A-Z0-9]{11,16})\b/gi

/** Numeri che nel testo stanno dopo un'etichetta fiscale (forma canonica). */
export function fiscalNumbers(text) {
  const out = new Set()
  for (const m of String(text || '').matchAll(FISCAL_NUM_RE)) {
    const s = m[1].toUpperCase().replace(/^0+/, '')
    if (s) out.add(s)
  }
  return out
}

/** Numeri di polizza citati con la loro etichetta nel testo (forma canonica, senza doppioni). */
export function extractPolicyNumbers(text) {
  const out = new Set()
  for (const m of String(text || '').matchAll(LABELLED_NUM_RE)) {
    const n = normalizePolicyNumber(m[1].replace(/ /g, '').replace(/[.\-/]+$/, ''))
    if (n) out.add(n)
  }
  return [...out]
}

// Celle di una riga della GRIGLIA spaziale (colonne separate da ≥2 spazi), con la loro colonna.
function gridCells(line) {
  const out = []
  const re = /\S+(?: \S+)*/g
  let m
  while ((m = re.exec(line))) out.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  return out
}

// Cella-etichetta del numero di polizza: nomina la polizza E un numero
// («RAMO / NUMERO POLIZZA», «Polizza Nr.», «N. polizza»). Il numero della
// polizza SOSTITUITA o PRECEDENTE è di un'altra polizza: non lega le due.
const LABEL_CELL_RE = /polizz/i
const LABEL_NUM_RE = /\b(?:n(?:r|um(?:ero)?)?\b\.?|n[°º]|numero)/i
const OTHER_POLICY_RE = /sostituit|precedent/i
// Contesto di un'altra polizza nelle righe SOPRA l'etichetta: «POLIZZE SOSTITUITE /
// La presente polizza annulla e sostituisce le seguenti: / Polizza numero …»
// (rinnovo Vittoria COLAUTTI: la 902058 sostituita dalla 902378).
const OTHER_POLICY_CTX_RE = /sostitui|annull|precedent/i
// Un valore a forma di data non è un numero di polizza (modulo ARAG: la data
// sotto «Polizza/e sostituita/e»).
const DATE_LIKE_RE = /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/

// Forma di confronto di un numero letto (anche dall'OCR): solo lettere e cifre,
// maiuscole, con i caratteri che l'OCR scambia ridotti a una forma sola.
const ocrNorm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  .replace(/[ILRT]/g, '1').replace(/[ODQ]/g, '0').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2')
// Al più UN carattere in più o in meno (mai una cifra al posto di un'altra: i
// numeri Vittoria e DAS dello stesso intermediario sono CONSECUTIVI, 902205 e
// 902206, 00075 e 00076, e uno scambio di cifra li confondeva).
function oneIndel(a, b) {
  if (a === b) return true
  const la = a.length, lb = b.length
  if (Math.abs(la - lb) !== 1) return false
  const [lo, sh] = la > lb ? [a, b] : [b, a]
  let i = 0
  while (i < sh.length && lo[i] === sh[i]) i++
  return lo.slice(i + 1) === sh.slice(i)
}

/**
 * NUMERI NOTI in tutto il documento. Un file che nelle prime pagine non mostra
 * un numero di polizza (copia firmata scansionata col numero a pag. 6, estratto
 * conto con «0146905087» in una cella senza etichetta, frontespizio letto
 * dall'OCR come «O1469D0AS00031_AA» o «2T20440000902030») si collega a una
 * polizza se in QUALSIASI pagina compare un numero già trovato nelle prime
 * pagine di un altro documento del batch: esatto (con le lettere che l'OCR
 * scambia per cifre ricondotte), oppure — dai 10 caratteri — con un solo
 * carattere letto in più o in meno. Solo numeri che
 * esistono davvero nel batch, mai un numero nuovo. Il chiamante lo usa solo se
 * il documento cita UNA sola polizza (sameNumber).
 * @param {string[]} pages tutte le pagine del documento
 * @param {string[]} known numeri trovati dagli altri documenti (forma canonica)
 * @returns {string[]} i numeri noti trovati
 */
export function knownNumbersInPages(pages, known) {
  const keys = [...new Set(known || [])].map((k) => ({ k, n: ocrNorm(k).replace(/^0+/, '') })).filter((x) => x.n.length >= 8)
  const hits = new Set()
  if (!keys.length) return []
  for (const page of pages || []) {
    for (const line of String(page || '').split('\n')) {
      // GETTONI INTERI della riga (lettere/cifre con «.», «/», «-» dentro), anche
      // due o tre di fila separati da UNO spazio («212 044 0000902205»): mai un
      // pezzo di gettone — «01469DAS00021» non deve diventare «…0002» e
      // combaciare con «…00082» di un'altra polizza.
      const toks = [...line.matchAll(/[A-Za-z0-9][A-Za-z0-9./-]*/g)].map((m) => ({ t: m[0], a: m.index, b: m.index + m[0].length }))
      const cands = []
      for (let i = 0; i < toks.length; i++) {
        let joined = toks[i].t
        cands.push(joined)
        for (let j = i + 1; j < Math.min(toks.length, i + 3); j++) {
          if (toks[j].a - toks[j - 1].b !== 1) break
          joined += toks[j].t
          cands.push(joined)
        }
      }
      for (const c of cands) {
        const x = ocrNorm(c).replace(/^0+/, '')
        if (x.length < 8) continue
        for (const { k, n } of keys) {
          if (hits.has(k)) continue
          if (x === n || (x.length > n.length && x.endsWith(n)) || (n.length >= 10 && oneIndel(x, n))) hits.add(k)
        }
      }
    }
  }
  return [...hits]
}

/** Due numeri sono la stessa polizza letta in modi diversi (OCR, ramo davanti). */
export function sameNumber(a, b) {
  const x = ocrNorm(a).replace(/^0+/, ''), y = ocrNorm(b).replace(/^0+/, '')
  if (x === y) return true
  if (x.length >= 8 && y.length >= 8 && (x.endsWith(y) || y.endsWith(x))) return true
  return x.length >= 10 && y.length >= 10 && oneIndel(x, y)
}

/**
 * Numeri dei file SENZA numero nelle prime pagine, cercati in tutto il
 * documento tra quelli noti nel batch (knownNumbersInPages). Vale solo se il
 * documento cita una sola polizza del batch (anche in più grafie): un
 * documento che ne cita due (un PDF con più polizze, condizioni che rinviano a
 * un altro contratto) resta senza numero.
 * @param {{numbers: string[], pages: string[]}[]} files tutti i file del batch
 * @returns {string[][]} i numeri di ogni file (quelli di prima per i file che li avevano)
 */
export function numbersWithKnown(files) {
  // Codici FISCALI del batch: un numero etichettato P.IVA/C.F. in un qualunque
  // documento non è mai un numero di polizza, nemmeno dove compare senza
  // etichetta (la P.IVA della COI «06359220966» in calce ai suoi documenti
  // univa sette cartelle di polizze diverse).
  const fiscal = new Set()
  for (const f of files || []) for (const n of fiscalNumbers((f.pages || []).join('\n'))) fiscal.add(ocrNorm(n).replace(/^0+/, ''))
  const isFiscal = (n) => fiscal.has(ocrNorm(n).replace(/^0+/, ''))
  const primary = (files || []).map((f) => (f.numbers || []).filter((n) => !isFiscal(n)))
  const known = [...new Set(primary.flat())]
  const usable = known
  return (files || []).map((f, i) => {
    if (primary[i].length) return primary[i]
    const hits = knownNumbersInPages(f.pages || [], usable)
    if (!hits.length) return []
    return hits.every((h) => sameNumber(h, hits[0])) ? hits : []
  })
}

// Lo stesso numero DECORATO in modi diversi nello stesso documento: Unipol
// «30/161659629/5» (ramo, numero, controllo) e «1/85112/30/161659629»
// (agenzia, ramo, numero) → «301616596295» e «18511230161659629». Il nucleo
// comune copre il più corto tranne al più un carattere ed è la CODA di uno dei
// due. Numeri consecutivi (1469AC12900216 / …00006, 902058 / 902158) hanno in
// comune solo la TESTA: restano diversi. Solo per decidere se dividere un file
// (mai per unire dossier).
function decoratedSame(a, b) {
  const x = ocrNorm(a).replace(/^0+/, ''), y = ocrNorm(b).replace(/^0+/, '')
  const short = x.length <= y.length ? x : y
  if (short.length < 9) return false
  let best = 0, endX = 0, endY = 0
  const prev = new Array(y.length + 1).fill(0)
  for (let i = 1; i <= x.length; i++) {
    let diag = 0
    for (let j = 1; j <= y.length; j++) {
      const keep = prev[j]
      prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : 0
      if (prev[j] > best) { best = prev[j]; endX = i; endY = j }
      diag = keep
    }
  }
  return best >= short.length - 1 && (endX === x.length || endY === y.length)
}

/**
 * PDF con PIÙ POLIZZE, una dopo l'altra (RUZZA FABIO - FD611EL.pdf: cinque
 * polizze DAS, ognuna col suo frontespizio e le sue condizioni, alle pagine 1,
 * 14, 27, 40 e 53). Il contenuto decide: i numeri di polizza letti PAGINA PER
 * PAGINA formano tratti consecutivi e disgiunti — ogni tratto comincia alla
 * prima pagina col suo numero, nessuna pagina ne porta due di polizze diverse e
 * nessun numero torna dopo che è comparso il successivo (una polizza che cita
 * quella sostituita a metà documento non è divisa). Contano solo le pagine del
 * text layer: l'OCR legge lo stesso numero in grafie diverse da una pagina
 * all'altra (950M3062, 980M3062) e non deve dividere niente. Esclusi i
 * frammenti (inizio di un numero più lungo del batch: il codice agenzia
 * «185112» di «18511230161659629») e i codici fiscali del batch.
 * @param {{pages: string[], digital?: boolean[]}[]} files tutti i file del batch
 * @returns {({from:number, to:number, numbers:string[]}[] | null)[]} per file: i tratti (pagine 0-based, estremi inclusi) o null
 */
export function compositeSegments(files) {
  const list = files || []
  const perPage = list.map((f) => (f.pages || []).map((p, i) => (f.digital && f.digital[i] === false ? [] : extractPolicyNumbersFromPages([p]))))
  const all = [...new Set(perPage.flat(2))]
  const fragment = new Set(all.filter((n) => all.some((o) => o.length >= n.length + 4 && o.startsWith(n))))
  const fiscal = new Set()
  for (const f of list) for (const n of fiscalNumbers((f.pages || []).join('\n'))) fiscal.add(ocrNorm(n).replace(/^0+/, ''))
  const usable = (n) => !fragment.has(n) && !fiscal.has(ocrNorm(n).replace(/^0+/, ''))
  const same = (x, y) => sameNumber(x, y) || decoratedSame(x, y)
  return perPage.map((pp) => {
    const segs = []
    for (let i = 0; i < pp.length; i++) {
      const ns = pp[i].filter(usable)
      if (!ns.length) continue
      const cur = segs[segs.length - 1]
      const inCur = (x) => !!cur && cur.numbers.some((m) => same(x, m))
      if (cur && ns.every(inCur)) { for (const x of ns) if (!cur.numbers.includes(x)) cur.numbers.push(x); continue }
      if (cur && ns.some(inCur)) return null // una pagina con due polizze: non sono tratti
      if (segs.some((s) => ns.some((x) => s.numbers.some((m) => same(x, m))))) return null // un numero che torna
      if (!ns.every((x) => same(x, ns[0]))) return null // due numeri nuovi nella stessa pagina
      segs.push({ first: i, numbers: [...ns] })
    }
    if (segs.length < 2) return null
    return segs.map((s, k) => ({ from: k ? s.first : 0, to: k + 1 < segs.length ? segs[k + 1].first - 1 : pp.length - 1, numbers: s.numbers }))
  })
}

/**
 * Numeri di polizza di un documento dalla GRIGLIA spaziale (pagine del text
 * layer o dell'OCR): nella cella dell'etichetta («Polizza n. 01469DAS00040»)
 * oppure SOTTO l'etichetta, nella stessa colonna, nelle righe seguenti (i
 * moduli: «RAMO / NUMERO POLIZZA» e sotto «30/210502137»). Forma canonica.
 * @param {string[]} pages
 */
export function extractPolicyNumbersFromPages(pages) {
  const out = new Set()
  const fiscal = fiscalNumbers((pages || []).join('\n'))
  for (const page of pages || []) {
    const lines = String(page || '').split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const cell of gridCells(lines[i])) {
        if (!LABEL_CELL_RE.test(cell.text) || OTHER_POLICY_RE.test(cell.text)) continue
        const inline = extractPolicyNumbers(cell.text)
        if (inline.length) { inline.forEach((n) => out.add(n)); continue }
        // Etichetta spezzata dall'OCR in due celle («NUMERO   POLIZZA   1/63317/48/
        // 165043362» della Unipol scansionata di COSTA 1A): la parola del numero
        // sta nella cella PRIMA. Col numero nella cella SUBITO A DESTRA sulla
        // stessa riga lo si prende lì; senza, la cartella sembrava «senza numeri»
        // e veniva unita alla polizza DAS della sottocartella.
        const cells = gridCells(lines[i])
        const ci = cells.findIndex((c) => c.start === cell.start)
        const labelCtx = `${ci > 0 ? cells[ci - 1].text : ''} ${cell.text}`
        if (!LABEL_NUM_RE.test(labelCtx)) continue
        // Etichetta di un'ALTRA polizza (sostituita, annullata, precedente) nella
        // cella prima o nelle due righe sopra: né a destra né sotto si legge nulla.
        if (OTHER_POLICY_CTX_RE.test(`${labelCtx} ${lines[i - 1] || ''} ${lines[i - 2] || ''}`)) continue
        const right = cells[ci + 1]
        // Stessa cattura del numero in cella: riattacca i gruppi spezzati dal
        // kerning («212 . 044 . 0000902058»), mai una data.
        const rightNum = !right || DATE_LIKE_RE.test(right.text.split(/\s+/)[0]) ? ''
          : /^[A-Z0-9](?:[A-Z0-9./\-]| (?=[A-Z0-9./\-]))*$/i.test(right.text) && (normalizePolicyNumber(right.text).match(/[A-Z]/g) || []).length <= 3
            ? normalizePolicyNumber(right.text) // ≤ 3 lettere: «01469DAS00040», mai «1I85112T48I163616294I4»
            : normalizePolicyNumber(right.text.split(/\s+/)[0])
        if (rightNum) { out.add(rightNum); continue }
        // Colonna della parola «polizza» nella cella: un'intestazione di modulo
        // sta spesso in UNA cella («COD. AG. COD. SUBAG. RAMO NR. POLIZZA
        // PRODOTTO») e sotto ci sono i valori di tutte le colonne: il numero è
        // quello più vicino alla parola, non il primo (sarebbe il codice agenzia).
        const at = cell.start + cell.text.search(LABEL_CELL_RE)
        for (let k = i + 1; k <= Math.min(i + 3, lines.length - 1); k++) {
          const under = gridCells(lines[k]).filter((c) => c.start < cell.end && c.end > cell.start)
          if (!under.length) continue
          const nums = under.filter((c) => !DATE_LIKE_RE.test(c.text.split(/\s+/)[0])).map((c) => ({ c, n: normalizePolicyNumber(c.text.split(/\s+/)[0]) })).filter((x) => x.n)
          if (nums.length) {
            const dist = (c) => (at < c.start ? c.start - at : at > c.end ? at - c.end : 0)
            nums.sort((a, b) => dist(a.c) - dist(b.c))
            out.add(nums[0].n)
          }
          break // la riga sotto l'etichetta ha i suoi valori: il numero c'è o non c'è
        }
      }
    }
  }
  return [...out].filter((n) => !fiscal.has(n))
}

// DOCUMENTO PRE-CONTRATTUALE (03/10/2026, richiesta dell'utente: «capire se
// siamo di fronte a una proposta, bozza, quotazione, preventivo da non
// estrarre, senza rompere il resto»). Decide il DOCUMENTO stesso, con due
// fatti insieme: (1) si DICHIARA preventivo / quotazione / offerta / proposta
// nella testa della sua prima pagina con testo — con un numero («PREVENTIVO
// Numero 4171» Vittoria, «Preventivo n. 211755582» Allianz, «Proposta N. 0G /
// TPO16505846» ITAS, «…COLLEGATO ALLA PROPOSTA N. 25062766» DAS), con le frasi
// dei preventivi («Il tuo preventivo», «Il preventivo ha validità 60 giorni»
// Unipol, «BOZZA DA APPROVARE») o con la parola da sola in una delle prime
// celle («QUOTAZIONE ASSICURATO…»); (2) NON porta un numero di POLIZZA nelle
// prime 5 pagine (stessa lettura della riconciliazione). Il secondo fatto
// tiene fuori i contratti che nominano una proposta: «PROPOSTA DI RINNOVO N.1
// POLIZZA N. IPD0017417» (AIG), «la Proposta di Assicurazione n. … relativa
// alla polizza n. …» (Vita), «Polizza N. 0G / M16181009» (contratto ITAS).
// «NUMERO DI BOZZA» (casella del modulo Italiana sulla polizza vera) non è
// una dichiarazione. Nessun nome file, nessun tipo di documento a priori.
const PRE_CONTRACT_NUMBERED_RE = /\b(preventivo|quotazione|offerta|proposta)(?:\s+(?:di|del|della)\s+[a-zà-ù]+)?\s*(?:n\.|nr\.?|n°|nº|numero)(?=\s*[:.]?\s*[A-Z0-9])/i
const PRE_CONTRACT_PHRASE_RE = /\bil tuo preventivo\b|\bil preventivo ha validit|\bbozza da approvare\b/i
const PRE_CONTRACT_CELL_RE = /^(preventivo|quotazione|offerta)$/i

/**
 * La dichiarazione di documento pre-contrattuale («Preventivo n. …»,
 * «QUOTAZIONE»…) se il documento lo è (vedi sopra), altrimenti null.
 * @param {string[]} pages  pagine del documento (griglia spaziale o testo piatto)
 */
export function preContractLabel(pages) {
  const list = pages || []
  const first = list.findIndex((p) => String(p || '').trim())
  if (first < 0) return null
  const page = String(list[first])
  const flat = page.replace(/\s+/g, ' ').trim()
  const head = flat.slice(0, 400)
  let label = null
  const m = PRE_CONTRACT_NUMBERED_RE.exec(head) || PRE_CONTRACT_PHRASE_RE.exec(head)
  if (m) label = m[0]
  if (!label) {
    // la parola da sola in una delle prime celle della pagina (titolo di un modulo)
    const cells = page.split('\n').filter((l) => l.trim()).slice(0, 4).flatMap((l) => gridCells(l).map((c) => c.text)).slice(0, 6)
    const c = cells.find((t) => PRE_CONTRACT_CELL_RE.test(t.trim()))
    if (c) label = c.trim()
  }
  if (!label) return null
  if (extractPolicyNumbersFromPages(list.slice(0, 5)).length) return null
  return label.replace(/\s+/g, ' ').trim()
}

function unionFind() {
  const parent = new Map()
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); let r = x; while (parent.get(r) !== r) r = parent.get(r); parent.set(x, r); return r }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra) }
  return { find, union }
}

/**
 * Piano di unione.
 * @param {{id:string, path:string, files:{idx:number, numbers:string[]}[]}[]} dossiers  in ordine di caricamento
 * @returns {{target:string, name:string, numbers:string[], moves:{from:string, all:boolean, idxs:number[]}[]}[]}
 */
export function planReconcile(dossiers) {
  // 0. Un numero che FINISCE con un altro di almeno 8 caratteri è lo stesso col
  // ramo o l'agenzia davanti («30/210502137» e «RAMO 30 · NR. POLIZZA 210502137»).
  // Un numero che è l'INIZIO di un altro numero del batch più lungo di almeno 4
  // caratteri è un frammento, non una polizza: l'OCR di una copia firmata
  // spezza «212.044.0000902030» e ne resta la testa «212044» (codice agenzia
  // Vittoria, uguale in tutte le sue polizze), che univa COLAUTTI, RAMAZZINI e
  // LIPPI (CONDOMINI, 26/09/2026). Le appendici «…00040» / «…000401» (una cifra
  // in più) restano numeri distinti.
  const heads = [...new Set((dossiers || []).flatMap((d) => (d?.files || []).flatMap((f) => f.numbers || [])))]
  const fragment = new Set(heads.filter((n) => heads.some((o) => o.length >= n.length + 4 && o.startsWith(n))))
  const raw = (dossiers || []).filter((d) => d && d.id)
    .map((d) => ({ ...d, files: (d.files || []).map((f) => ({ ...f, numbers: (f.numbers || []).filter((n) => !fragment.has(n)) })) }))
  const all = [...new Set(raw.flatMap((d) => (d.files || []).flatMap((f) => f.numbers || [])))].sort((a, b) => b.length - a.length)
  const canon = new Map()
  for (const num of all) {
    const longer = num.length >= 8 ? all.find((o) => o.length > num.length && o.endsWith(num) && canon.get(o) === o) : null
    canon.set(num, longer || num)
  }
  // Stesso numero letto due volte DIVERSO dall'OCR: caratteri che l'OCR scambia
  // (I/L/R↔1, O/D/Q↔0, S↔5, B↔8, Z↔2) nella stessa posizione. «1PD0017417» e
  // «IPD0017417» (BOLCHINI RC 2025, 03/10/2026) erano due polizze: la cartella
  // diventava un contenitore e i suoi file finivano divisi in due dossier;
  // ZELO: «2R2.044…» per «212.044…». Solo numeri di almeno 8 caratteri: due
  // polizze diverse non differiscono per un I al posto di un 1.
  const ocrKey = (n) => n.replace(/[ILR]/g, '1').replace(/[ODQ]/g, '0').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2')
  {
    const freq = new Map()
    for (const d of raw) for (const f of d.files || []) for (const n of f.numbers || []) { const c = canon.get(n) || n; freq.set(c, (freq.get(c) || 0) + 1) }
    const byKey = new Map()
    for (const c of new Set(canon.values())) {
      if (c.length < 8) continue
      const k = ocrKey(c)
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(c)
    }
    for (const group of byKey.values()) {
      if (group.length < 2) continue
      // rappresentante: il più frequente (a parità, il primo in ordine alfabetico)
      const rep = [...group].sort((a, b2) => (freq.get(b2) || 0) - (freq.get(a) || 0) || a.localeCompare(b2))[0]
      for (const [n, c] of canon) if (group.includes(c)) canon.set(n, rep)
    }
  }
  const list = raw.map((d) => ({ ...d, files: (d.files || []).map((f) => ({ ...f, numbers: [...new Set((f.numbers || []).map((n) => canon.get(n) || n))] })) }))
  // 1. Componenti di file per dossier (file collegati da un numero in comune).
  const nodes = [] // { key, dossier, idxs, numbers:Set, whole }
  for (const d of list) {
    const uf = unionFind()
    const byNum = new Map()
    const numbered = (d.files || []).filter((f) => (f.numbers || []).length)
    for (const f of numbered) {
      for (const n of f.numbers) {
        if (byNum.has(n)) uf.union(`f${byNum.get(n)}`, `f${f.idx}`)
        else byNum.set(n, f.idx)
        uf.find(`f${f.idx}`)
      }
    }
    const comps = new Map()
    for (const f of numbered) {
      const r = uf.find(`f${f.idx}`)
      if (!comps.has(r)) comps.set(r, { idxs: [], numbers: new Set() })
      const c = comps.get(r)
      c.idxs.push(f.idx)
      for (const n of f.numbers) c.numbers.add(n)
    }
    const whole = comps.size === 1
    let k = 0
    for (const c of comps.values()) {
      nodes.push({
        key: `${d.id}#${k++}`, dossier: d, whole,
        idxs: whole ? (d.files || []).map((f) => f.idx) : c.idxs,
        numbers: c.numbers,
      })
    }
  }
  // 2. Posizioni che condividono un numero = stessa polizza.
  const uf = unionFind()
  const firstByNum = new Map()
  for (const n of nodes) {
    uf.find(n.key)
    for (const num of n.numbers) {
      if (firstByNum.has(num)) uf.union(firstByNum.get(num), n.key)
      else firstByNum.set(num, n.key)
    }
  }
  const groups = new Map()
  for (const n of nodes) {
    const r = uf.find(n.key)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(n)
  }
  // 3. Un'unione per gruppo; destinazione = la posizione dal percorso più corto.
  const order = new Map(list.map((d, i) => [d.id, i]))
  const depth = (p) => String(p || '').split('/').filter(Boolean).length
  const pathOf = new Map(list.map((d) => [d.id, d.path || '']))
  const byTarget = new Map() // target → { target, numbers:Set, moves:Map }
  const fresh = [] // polizze fatte solo di pezzi di contenitori diversi
  for (const g of groups.values()) {
    const wholes = g.filter((n) => n.whole)
    if (!wholes.length) {
      // Solo PEZZI di contenitori. Da UN contenitore la polizza resta dov'è,
      // con le altre. Da PIÙ contenitori (RUZZA: le pagine 27-39 del PDF con
      // cinque polizze DAS e l'appendice ET103PP della stessa 01469AC12900058,
      // in due cartelle che hanno anche altre polizze) diventa un dossier NUOVO
      // con i soli documenti di quella polizza.
      const from = [...new Set(g.map((n) => n.dossier.id))]
      if (from.length < 2) continue
      const moves = new Map()
      for (const n of g) {
        const m = moves.get(n.dossier.id) || { from: n.dossier.id, all: false, idxs: [] }
        m.idxs.push(...n.idxs)
        moves.set(n.dossier.id, m)
      }
      fresh.push({ numbers: new Set(g.flatMap((n) => [...n.numbers])), moves, paths: from.map((id) => pathOf.get(id)) })
      continue
    }
    wholes.sort((a, b) => depth(a.dossier.path) - depth(b.dossier.path) || order.get(a.dossier.id) - order.get(b.dossier.id))
    const target = wholes[0].dossier.id
    const entry = { target, numbers: new Set(g.flatMap((n) => [...n.numbers])), moves: new Map() }
    for (const n of g) {
      if (n.dossier.id === target) continue
      const m = entry.moves.get(n.dossier.id) || { from: n.dossier.id, all: false, idxs: [] }
      if (n.whole) { m.all = true; m.idxs = (n.dossier.files || []).map((f) => f.idx) }
      else if (!m.all) m.idxs.push(...n.idxs)
      entry.moves.set(n.dossier.id, m)
    }
    byTarget.set(target, entry)
  }
  // Nessuna regola sulle CARTELLE (04/10/2026, decisione dell'utente: «il
  // documento conta, e solo il suo contenuto»): una cartella senza numeri non
  // si unisce alla polizza che ha sotto (il questionario ITAS scritto a mano di
  // «PRODUZIONE PREMENUGO» finiva nella polizza della sottocartella; COSTA 1A,
  // la Unipol scansionata nella DAS). I file senza numero restano dove sono,
  // a meno che il loro testo citi una polizza del batch (numbersWithKnown).
  const plan = []
  for (const e of byTarget.values()) {
    if (!e.moves.size) continue
    const merged = [e.target, ...[...e.moves.values()].filter((m) => m.all).map((m) => m.from)]
    const name = merged.map((id) => pathOf.get(id)).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0]
    plan.push({
      target: e.target, name, numbers: [...e.numbers].sort(),
      moves: [...e.moves.values()].map((m) => ({ ...m, idxs: [...new Set(m.idxs)].sort((a, b) => a - b) })),
    })
  }
  for (const e of fresh) {
    // Nome: la cartella comune ai pezzi e il numero della polizza.
    const parts = e.paths.map((p) => String(p || '').split('/').filter(Boolean))
    const common = []
    for (let i = 0; parts.every((x) => i < x.length - 1 && x[i] === parts[0][i]); i++) common.push(parts[0][i])
    const numbers = [...e.numbers].sort()
    const rep = [...numbers].sort((a, b) => b.length - a.length || a.localeCompare(b))[0]
    plan.push({
      target: null, create: true, name: [...common, `Polizza ${rep}`].join('/'), numbers,
      moves: [...e.moves.values()].map((m) => ({ ...m, idxs: [...new Set(m.idxs)].sort((a, b) => a - b) })),
    })
  }
  return plan
}

// Indici delle PARTI di un PDF con più polizze: solo nel piano, mai nel DB.
const partIdx = (idx, j) => 1000000 + idx * 1000 + j
/** «1-13, 40-52» */
export const pageRanges = (segs) => segs.map((s) => (s.from === s.to ? `${s.from + 1}` : `${s.from + 1}-${s.to + 1}`)).join(', ')

/**
 * RICONCILIAZIONE DAL TESTO dei documenti, la stessa per il worker web, gli
 * script e i test: si legge TUTTO il documento. (1) I PDF con più polizze
 * diventano parti, una per polizza (compositeSegments); (2) numeri etichettati
 * nelle prime 5 pagine di ogni file o parte; (3) per chi non ne ha, i numeri del
 * batch citati in tutto il suo testo (numbersWithKnown); (4) piano di unione
 * (planReconcile: solo numeri in comune, mai le cartelle). Le parti di un PDF che
 * finiscono tutte nello stesso posto restano il PDF intero; altrimenti il PDF si
 * divide (splits) e ogni gruppo di pagine va dove va la sua polizza.
 * @param {{id:string, path:string, files:{idx:number, name?:string, pages:string[], digital?:boolean[]}[]}[]} dossiers in ordine di caricamento
 * @param {{ noSplit?: Set<string> }} [opts] PDF da NON dividere (`${dossier}#${idx}`: non si lasciano dividere) — restano dove sono
 * @returns {{
 *   plan: {target:string|null, create?:boolean, name:string, numbers:string[], moves:{from:string, all:boolean, idxs:number[]}[]}[],
 *   splits: {dossier:string, idx:number, name:string, groups:{merge:number|null, segs:{from:number, to:number, numbers:string[]}[]}[]}[],
 *   read: {id:string, numbers:string[], notes:string[]}[],
 * }}
 */
export function reconcileFromPages(dossiers, opts = {}) {
  const NP = 5
  const noSplit = opts.noSplit || new Set()
  const list = (dossiers || []).filter((d) => d && d.id)
  const flat = list.flatMap((d) => (d.files || []).map((f) => ({ d, f })))
  const segsOf = compositeSegments(flat.map(({ f }) => ({ pages: f.pages || [], digital: f.digital })))
    .map((segs, k) => (segs && noSplit.has(`${flat[k].d.id}#${flat[k].f.idx}`) ? 'whole' : segs))
  const units = []
  flat.forEach(({ d, f }, k) => {
    const segs = segsOf[k]
    // Un PDF con più polizze che non si lascia dividere non porta con sé nessuna delle sue polizze.
    if (segs === 'whole') { units.push({ d, f, idx: f.idx, pages: [] }); return }
    if (!segs) { units.push({ d, f, idx: f.idx, pages: f.pages || [] }); return }
    segs.forEach((seg, j) => units.push({ d, f, seg, idx: partIdx(f.idx, j), pages: (f.pages || []).slice(seg.from, seg.to + 1) }))
  })
  for (const u of units) u.numbers = extractPolicyNumbersFromPages(u.pages.slice(0, NP))
  const withKnown = numbersWithKnown(units.map((u) => ({ numbers: u.numbers, pages: u.pages })))
  units.forEach((u, k) => { u.known = !u.numbers.length && withKnown[k].length > 0; u.numbers = withKnown[k] })
  const plan = planReconcile(list.map((d) => ({ id: d.id, path: d.path, files: units.filter((u) => u.d === d).map((u) => ({ idx: u.idx, numbers: u.numbers })) })))
  const destOf = (dossier, idx) => {
    const k = plan.findIndex((m) => m.moves.some((mv) => mv.from === dossier && (mv.all || mv.idxs.includes(idx))))
    return k < 0 ? null : k
  }
  const splits = []
  flat.forEach(({ d, f }, k) => {
    const segs = segsOf[k]
    if (!segs || segs === 'whole') return
    const virt = segs.map((_, j) => partIdx(f.idx, j))
    const dests = virt.map((v) => destOf(d.id, v))
    const together = dests.every((x) => x === dests[0])
    for (const m of plan) {
      for (const mv of m.moves) {
        if (mv.from !== d.id) continue
        const had = mv.idxs.some((x) => virt.includes(x))
        mv.idxs = mv.idxs.filter((x) => !virt.includes(x))
        if (had && together && !mv.idxs.includes(f.idx)) mv.idxs.push(f.idx)
        mv.idxs.sort((a, b) => a - b)
      }
    }
    if (together) return
    const groups = new Map()
    segs.forEach((s, j) => { if (!groups.has(dests[j])) groups.set(dests[j], []); groups.get(dests[j]).push(s) })
    splits.push({ dossier: d.id, idx: f.idx, name: f.name || '', groups: [...groups].map(([merge, gs]) => ({ merge, segs: gs })) })
  })
  // Unioni rimaste senza niente da spostare (le parti erano tutto): fuori dal piano.
  const keep = plan.map((m, k) => m.moves.some((mv) => mv.all || mv.idxs.length) || splits.some((sp) => sp.groups.some((g) => g.merge === k)))
  const remap = new Map()
  plan.forEach((_, k) => { if (keep[k]) remap.set(k, remap.size) })
  for (const sp of splits) for (const g of sp.groups) if (g.merge != null) g.merge = remap.get(g.merge)
  const read = list.map((d) => {
    const mine = units.filter((u) => u.d === d)
    const notes = []
    for (const u of mine) if (u.known) notes.push(`${u.numbers.join(', ')} citato nel testo di "${u.f.name || u.f.idx}"${u.seg ? ` (pag. ${pageRanges([u.seg])})` : ''}`)
    flat.forEach(({ d: dd, f }, k) => {
      if (dd !== d || !segsOf[k]) return
      notes.push(segsOf[k] === 'whole'
        ? `"${f.name || f.idx}" contiene più polizze ma non si lascia dividere: resta dov'è`
        : `"${f.name || f.idx}" contiene più polizze: ${segsOf[k].map((s) => `pag. ${pageRanges([s])} n. ${s.numbers.join('/')}`).join('; ')}`)
    })
    return { id: d.id, numbers: [...new Set(mine.flatMap((u) => u.numbers))], notes }
  })
  return { plan: plan.filter((_, k) => keep[k]), splits, read }
}

/**
 * SEPARA un dossier nelle cartelle da cui i suoi file sono stati caricati
 * (l'INVERSO della riconciliazione): ogni file ha il suo percorso d'origine
 * (`rel_path`, «RADICE/CARTELLA/…/file.pdf»), che l'unione non tocca. Resta nel
 * dossier il gruppo della cartella del suo PRIMO file (indice più basso: la
 * riconciliazione accoda i file uniti dopo quelli della destinazione, quindi è
 * un file suo di prima dell'unione — il NOME invece è il percorso più corto
 * tra quelli uniti e può essere di un altro dossier: COSTA 1A); senza percorsi,
 * la cartella col nome del dossier o la più numerosa. Gli altri gruppi
 * diventano dossier a parte. I file senza percorso
 * d'origine restano dove sono. Serve a disfare un'unione sbagliata (CONDOMINI
 * 26/09/2026: COLAUTTI + RAMAZZINI per il frammento «212044»; COSTA 1A: la
 * Unipol scansionata unita alla DAS).
 * @param {string} dossierName
 * @param {{idx:number, rel_path?:string|null}[]} files
 * @returns {{ home:string, keep:number[], groups:{ folder:string, idxs:number[] }[] }} groups vuoto = niente da separare
 */
export function planSplitByOrigin(dossierName, files) {
  const folderOf = (p) => { const s = String(p || '').replace(/\\/g, '/'); const i = s.lastIndexOf('/'); return i > 0 ? s.slice(0, i) : '' }
  const byFolder = new Map()
  const noPath = []
  for (const f of files || []) {
    const folder = folderOf(f.rel_path)
    if (!folder) { noPath.push(f.idx); continue }
    if (!byFolder.has(folder)) byFolder.set(folder, [])
    byFolder.get(folder).push(f.idx)
  }
  if (byFolder.size < 2) return { home: [...byFolder.keys()][0] || '', keep: (files || []).map((f) => f.idx), groups: [] }
  const own = String(dossierName || '').replace(/\\/g, '/').replace(/\/+$/, '')
  const folders = [...byFolder.keys()]
  const first = [...(files || [])].filter((f) => folderOf(f.rel_path)).sort((a, b) => a.idx - b.idx)[0]
  const home = first ? folderOf(first.rel_path)
    : folders.includes(own) ? own : folders.sort((a, b) => byFolder.get(b).length - byFolder.get(a).length || a.localeCompare(b))[0]
  return {
    home,
    keep: [...byFolder.get(home), ...noPath].sort((a, b) => a - b),
    groups: folders.filter((f) => f !== home).sort().map((folder) => ({ folder, idxs: byFolder.get(folder).sort((a, b) => a - b) })),
  }
}
