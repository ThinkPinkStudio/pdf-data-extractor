/**
 * OPERATIVITÀ della copertura — parte PURA e testabile.
 *
 * Il pre-controllo di pertinenza chiedeva "ci sono le parole del profilo?":
 * la tutela legale stampata nelle condizioni generali, o come opzione NON
 * barrata di un modulo, bastava per estrarre (LUCCHESE: 1 posizione giusta su
 * 4; PIZZAMIGLIO: 3 su 9). Qui la domanda è un'altra: la copertura descritta
 * in «Come riconoscerla» (`recognition`, testo libero del profilo scritto
 * dall'utente) è OPERANTE nei documenti, cioè acquistata davvero — prodotto o
 * sezione assicurata, casella selezionata, premio proprio, voce nel riepilogo
 * delle garanzie prestate? Lo decide IL MODELLO sulle pagine più affini e deve
 * CITARE la frase che lo prova; il codice verifica solo che la frase esista
 * nella pagina. Nessuna lista di parole, nessuna soglia: la definizione del
 * tipo è nel profilo e l'utente la cambia quando vuole.
 *
 * Questo modulo non chiama Ollama né embeddings (sta in polizzaPrecheckService):
 * selezione delle pagine, prompt, schema, lettura della risposta, verifica
 * della prova e decisione sono funzioni deterministiche.
 */

import { normForMatch, valueTokens, distinctiveHeadTokens } from './polizzaValidation.js'
import { usefulLength } from './ocrLayout.js'

export const OPERATIVITA_ESITI = ['operante', 'non operante', 'non determinabile']
/** Il CONTRATTO (frontespizio/scheda di polizza, appendice con le garanzie) è tra le pagine lette? */
export const OPERATIVITA_CONTRATTO = ['presente', 'assente', 'non determinabile']
/** Caratteri NORMALIZZATI minimi perché una citazione valga come prova. */
export const OPERATIVITA_MIN_EVIDENCE = 12
/** Caratteri utili massimi di una singola pagina nel prompt (si tiene l'inizio: i frontespizi sono in testa). */
export const OPERATIVITA_MAX_PAGE_CHARS = 3500
/** Pagine massime embeddate per fascicolo (e per documento): il controllo costa secondi, non minuti. */
export const OPERATIVITA_MAX_PAGES = 150
export const OPERATIVITA_MAX_PAGES_PER_DOC = 30
/** Chiamate massime per fascicolo: i batch scorrono le pagine per affinità finché una prova di operatività non arriva. */
export const OPERATIVITA_MAX_BATCHES = 6
/**
 * Chiamate massime della domanda sul CONTRATTO (presenza della polizza). Ci si
 * ferma al primo «presente» (di solito la prima chiamata: i frontespizi sono
 * in testa ai documenti); il tetto conta solo per i fascicoli dove la polizza
 * non si vede, e «assente» (Non valido) vuole OGNI pagina mostrata: pagine
 * rimaste oltre il tetto = «non verificata» (Da verificare), mai Non valido.
 * Il doppio dell'operatività: a contesto 8192 un batch porta ~3 pagine.
 */
export const CONTRATTO_MAX_BATCHES = 12

/**
 * Parole DISTINTIVE della TESTA di «Come riconoscerla» di un profilo (il testo
 * prima del primo ":"), per frequenza inversa sulle teste degli altri profili
 * in gara (stesso meccanismo di distinctiveHeadTokens sulle descrizioni: mai
 * liste). Per «Polizza o sezione di TUTELA LEGALE effettivamente ACQUISTATA dal
 * contraente: …» contro RC/RCT/medica escono "tutela", "legale" (più le parole
 * citate tra virgolette). Servono a due cose: portare PRIMA al modello le
 * pagine che NOMINANO la copertura (BOIARDO: la scheda con "SEZIONE TUTELA
 * LEGALE … Imponibile annuo € 249,06" a pag. 3 della polizza non entrava in 6
 * batch, sommersa dalle condizioni generali più affini per embedding) e a
 * scartare come prova di operatività una frase GENERICA che non la nomina
 * (CAMPESTRE: «Ogni garanzia opera secondo i termini… delle apposite sezioni»).
 * Vuoto se non c'è nulla di distintivo (profilo solo, nessuna citazione):
 * allora i controlli lessicali non si applicano.
 * @param {{id:string,recognition?:string}[]} profiles  profili in gara (compreso quello del job)
 * @param {string} profileId
 * @returns {string[]} token normalizzati (≥4 caratteri)
 */
export function recognitionDistinctiveTokens(profiles, profileId) {
  const list = (profiles || []).filter((p) => p && p.id && String(p.recognition || '').trim())
  if (!list.some((p) => p.id === profileId)) return []
  const tokenize = (head) => String(head || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean)
  // Solo la TESTA per frequenza inversa: il canale delle "etichette citate tra
  // virgolette" di distinctiveHeadTokens è tarato sulle descrizioni dei campi
  // (etichette corte) e su un testo lungo con apostrofi ("l'assistenza") e
  // citazioni oltre 40 caratteri deriva ("oppure", "assistenza"): qui le
  // virgolette vengono tolte prima. Nessuna lista di stopword: la lista del
  // boilerplate (FREQ_STOPWORDS) contiene "legale" (da "sede legale") e
  // avrebbe cancellato proprio la parola che distingue la tutela legale.
  const strip = (t) => String(t || '').replace(/['‘’"«»]/g, ' ')
  const map = distinctiveHeadTokens(list.map((p) => ({ id: p.id, description: strip(p.recognition) })), tokenize)
  let toks = (map.get(profileId) || []).map((t) => normForMatch(t)).filter((t) => t.length >= 4)
  if (!toks.length) {
    // Nessuna parola "rara" (profili GEMELLI con la stessa testa, es. due RC
    // professionale; oppure profilo solo): ripiego sulle parole della testa che
    // NON stanno in tutte le teste, le meno diffuse. Filtro largo, meglio di
    // nessun filtro.
    const heads = new Map(list.map((p) => [p.id, [...new Set(tokenize(strip(p.recognition).split(':')[0]).map((t) => normForMatch(t)).filter((t) => t.length >= 4))]]))
    const df = new Map()
    for (const toksOf of heads.values()) for (const t of toksOf) df.set(t, (df.get(t) || 0) + 1)
    const mine = heads.get(profileId) || []
    const notEverywhere = mine.filter((t) => (df.get(t) || 0) < list.length)
    const minDf = notEverywhere.length ? Math.min(...notEverywhere.map((t) => df.get(t))) : null
    toks = minDf == null ? mine : notEverywhere.filter((t) => df.get(t) === minDf)
  }
  return [...new Set(toks)]
}

/**
 * «Come riconoscerla» ammette che la copertura sia una SEZIONE di una polizza
 * più ampia? Lo dice la TESTA della definizione scritta dall'utente («Polizza
 * o sezione di TUTELA LEGALE…» sì; «Polizza di RESPONSABILITÀ CIVILE
 * PROFESSIONALE…» no). Solo allora la prova di «operante» deve stare in una
 * pagina con una riga strutturale (copertura + importo/spunta): per una
 * sezione è ciò che separa l'acquisto dalle condizioni generali e dagli elenchi
 * di opzioni. Quando la copertura È il prodotto, la prova che la nomina basta
 * («Tipo di contratto: Responsabilità Civile Professionale», «APPENDICE N. 4
 * ALLA POLIZZA RC PROFESSIONALE»): il controllo strutturale le scartava e
 * mandava in «Da verificare» polizze RC vere (GUFFANTI, SPALLINO, Pilato —
 * produzione 25/09/2026).
 */
export function recognitionAllowsSection(recognition) {
  const head = String(recognition || '').split(':')[0]
  return /\bsezion[ei]\b/i.test(head)
}

/**
 * La riga ha un IMPORTO DIVERSO DA ZERO («31.000,00», «€ 240»; non «0,00»):
 * premio o somma assicurata propri della copertura.
 */
export function lineHasNonZeroAmount(line) {
  return amountMatches(line, /(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)(?!\s*%)|€\s*\d[\d.]*/g).some((a) => /[1-9]/.test(a))
}

// Numero di ARTICOLO («art. 6,13», «artt. 5,1,1», «articolo n. 12,30»): non è
// un importo. La clausola di approvazione specifica (art. 1341 c.c.) della
// polizza ITAS di MORANDI 11 (COND-052) — «SEZIONE TUTELA LEGALE: art, 5,1,1 …
// art, 6,13» — diventava una riga «copertura + importo» e il suo batch, fatto
// solo di quella, dava un «operante» su una tutela legale NON acquistata.
// Solo il numero SUBITO dopo «art.»: in un elenco «artt. 6,13, 6,14» il secondo
// resta (un premio vero dopo un trattino non si deve perdere).
const ARTICLE_BEFORE_RE = /\b(?:artt?|articol[oi])\s*[.,:]?\s*(?:n\s*[.°º]\s*)?$/i
// Il testo prima dell'importo si guarda con gli spazi COMPRESSI: nelle griglie
// OCR tra «art.» e «6,13» possono esserci centinaia di spazi.
function amountMatchesAt(text, re) {
  const s = String(text || '')
  const out = []
  for (const m of s.matchAll(re)) {
    const before = s.slice(Math.max(0, m.index - 200), m.index).replace(/\s+/g, ' ')
    if (!ARTICLE_BEFORE_RE.test(before)) out.push({ text: m[0], index: m.index })
  }
  return out
}
function amountMatches(text, re) { return amountMatchesAt(text, re).map((m) => m.text) }

/**
 * Importo che fa di una riga una riga STRUTTURALE (premio della copertura):
 * coi decimali («240,00», «1.047,47»), non nullo, non una percentuale («Tutela
 * Legale 8,46%»). «€ 15.000» senza decimali in una frase del DIP («opera con il
 * massimale di € 15.000, raddoppiabile…», Allianz, BESA-156) non lo è: quella
 * frase apriva il batch 1 da sola e il modello la prendeva per la scheda.
 * Vale SOLO per l'ordine dei batch e per la pagina della prova (struct): la
 * riga della copertura con un importo che contraddice un «non operante»
 * (proofIsCoverageRow, «ESCLUSA 31.000») resta con lineHasNonZeroAmount.
 */
const STRUCTURAL_AMOUNT_RE = /(?<![\d.,])(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?![\d,])(?!\s*%)/g
export function lineHasStructuralAmount(line) {
  return amountMatches(line, STRUCTURAL_AMOUNT_RE).some((a) => /[1-9]/.test(a))
}

/**
 * La pagina PORTA IMPORTI (premi, somme assicurate: "249,06", "€ 30.000,00")?
 * Serve SOLO all'ordine di lettura: tra le pagine che nominano la copertura,
 * quelle con importi (scheda di polizza, quietanza, riepilogo garanzie) si
 * leggono PRIMA delle pagine di sola prosa (condizioni generali, DIP). Su
 * BOIARDO la scheda «SEZIONE TUTELA LEGALE · Imponibile annuo € 249,06» era
 * 47ª su 54 pagine che nominano la tutela legale: le 46 pagine di condizioni
 * generali, tutte prosa sulla tutela legale, avevano affinità più alta e in 6
 * batch la scheda non arrivava mai al modello. Decide sempre il modello.
 */
export function pageHasAmount(text) {
  return amountMatches(text, /(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)|€\s*\d/g).length > 0
}

/**
 * NOME della copertura: le sequenze di parole distintive CONSECUTIVE nella
 * testa di «Come riconoscerla» («Polizza o sezione di TUTELA LEGALE
 * effettivamente acquistata» → [["tutela","legale"]]). Una parola distintiva
 * da sola ("sezione", "contraente") sta ovunque nelle polizze; la frase no.
 * Le sequenze si interrompono a punteggiatura e congiunzioni ("MEDICA /
 * SANITARIA" → due nomi alternativi, non la frase "medica sanitaria"). Se
 * esiste almeno una sequenza di ≥2 parole valgono solo quelle; altrimenti le
 * parole singole.
 * @returns {string[][]} nomi alternativi (parole normalizzate, in ordine); [] se non determinabile
 */
export function recognitionCoverName(profiles, profileId) {
  const distinct = new Set(recognitionDistinctiveTokens(profiles, profileId))
  if (!distinct.size) return []
  const me = (profiles || []).find((p) => p && p.id === profileId)
  const head = String(me?.recognition || '').replace(/['‘’"«»]/g, ' ').split(':')[0]
  const runs = []
  let cur = []
  const flush = () => { if (cur.length) runs.push(cur); cur = [] }
  for (const seg of head.split(/[\/,;()\-–—]+/)) {
    for (const raw of seg.split(/\s+/)) {
      const w = normForMatch(raw)
      if (!w) continue
      if (distinct.has(w)) cur.push(w)
      else flush()
    }
    flush()
  }
  const seen = new Set()
  const uniq = runs.filter((r) => { const k = r.join(' '); if (seen.has(k)) return false; seen.add(k); return true })
  const multi = uniq.filter((r) => r.length >= 2)
  return multi.length ? multi : uniq
}

/** true se il testo (normalizzato) contiene uno dei NOMI della copertura (parole consecutive). */
export function namesCoverage(text, names) {
  if (!Array.isArray(names) || !names.length) return null // non giudicabile
  const n = normForMatch(text)
  return names.some((nm) => Array.isArray(nm) && nm.length && n.includes(nm.join('')))
}

// Parola senza le VOCALI FINALI: la sola flessione italiana («medica» =
// «medico» = «medici», «sanitaria» = «sanitario» = «sanitarie», «professionale»
// = «professionali»), nessun troncamento. objectRadix (6 caratteri, pensata per
// headerLex) faceva combaciare parole DIVERSE: «profes» = professione,
// professionista, professore; «medic» = medicina (review del 26/09/2026).
const inflectionWords = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[\u2019'`\u00b4]/g, ' ').split(/[^a-z0-9]+/).filter(Boolean).map((w) => w.replace(/[aeiou]+$/, '') || w)

/**
 * Il testo NOMINA la copertura in QUALSIASI FORMA FLESSA della parola: prima la
 * sottostringa esatta di namesCoverage (regge il kerning, «M edical», «T
 * utela»), poi le parole intere senza le vocali finali, consecutive come nel
 * nome. Il nome di «RC PROF MED V2» è «medica» / «sanitaria» (femminile, dalla
 * testa della definizione) e i frontespizi scrivono «PROFESSIONISTA SANITARIO»,
 * «… Professionale del Medico», «Professioni Sanitarie».
 * Da usare SOLO sul FRONTESPIZIO (prima pagina con testo di un documento:
 * pageNamesCoverage): nel corpo dei documenti «medico», «sanitarie» stanno
 * ovunque (certificato medico, spese sanitarie, «ambito medico-sanitario» dei
 * set informativi di tutela legale) e su tutte le pagine 62 dossier locali su
 * 205 smettevano di essere «mai nominati» per la RC medica (misura del
 * 26/09/2026; sul solo frontespizio: 14, di cui 5 polizze RC mediche vere
 * prima scartate senza modello).
 * @returns {boolean|null} null = nome non determinabile (non giudicabile)
 */
export function namesCoverageAnyForm(text, names) {
  const exact = namesCoverage(text, names)
  if (exact !== false) return exact
  const seq = inflectionWords(text)
  return names.some((nm) => {
    if (!Array.isArray(nm) || !nm.length) return false
    const r = nm.map((w) => w.replace(/[aeiou]+$/, '') || w)
    for (let i = 0; i + r.length <= seq.length; i++) if (r.every((x, k) => seq[i + k] === x)) return true
    return false
  })
}

/**
 * La PAGINA nomina la copertura: per forma esatta (namesCoverage) ovunque, in
 * qualsiasi forma flessa (namesCoverageAnyForm) solo se è il FRONTESPIZIO del
 * suo documento (`first`: prima pagina con testo, come in buildPageCandidates).
 * UNA regola per tutti i controlli di nome: ordine dei batch (pagine †),
 * pagine nominate non lette, «mai nominata» e prova «generica».
 * @param {{text?:string, flat?:string, first?:boolean}} page
 * @returns {boolean|null} null = nome non determinabile
 */
export function pageNamesCoverage(page, names) {
  const text = page?.flat || page?.text || ''
  const exact = namesCoverage(text, names)
  if (exact !== false) return exact
  if (verticalCoverColumns(page?.text || '', names).length) return true
  return page?.first ? namesCoverageAnyForm(text, names) === true : false
}

// Celle di una riga della griglia: testi separati da ≥2 spazi, con la colonna.
const gridCellsOf = (line) => [...String(line || '').matchAll(/\S+(?: \S+)*/g)]
  .map((m) => ({ start: m.index, end: m.index + m[0].length, norm: normForMatch(m[0]) }))

/**
 * Nome della copertura in un'INTESTAZIONE DI COLONNA spezzata su righe
 * consecutive: «TUTELA» su una riga e «LEGALE» nella STESSA colonna della riga
 * sotto (celle sovrapposte). È la scheda dei prodotti DAS condominio:
 *   «TUTELA   PERDITE      ASSISTENZA   IMPOSTE   PREMIO
 *    LEGALE   PECUNIARIE                          LORDO
 *    Difesa Condominio - ed.2019   298,55   63,44   361,99»
 * Letta riga per riga la pagina non nominava mai la tutela legale e la riga del
 * premio sembrava una prova «generica» (11 DAS condominio «Da verificare»,
 * produzione 26/09/2026). Solo nomi di ≥2 parole, ogni parola una cella intera.
 * @returns {{start:number,end:number,line:number}[]} colonne (caratteri) e ultima riga dell'intestazione
 */
export function verticalCoverColumns(text, names) {
  if (!Array.isArray(names) || !names.length) return []
  const lines = String(text || '').split('\n')
  const cells = lines.map(gridCellsOf)
  const out = []
  for (const nm of names) {
    if (!Array.isArray(nm) || nm.length < 2) continue
    for (let i = 0; i + nm.length <= lines.length; i++) {
      for (const a of cells[i]) {
        if (a.norm !== nm[0]) continue
        let span = { start: a.start, end: a.end, line: i, first: i }
        let ok = true
        for (let k = 1; k < nm.length && ok; k++) {
          const b = cells[i + k].find((c) => c.norm === nm[k] && c.start < span.end && c.end > span.start)
          if (!b) ok = false
          else span = { start: Math.min(span.start, b.start), end: Math.max(span.end, b.end), line: i + k, first: i }
        }
        if (ok) out.push(span)
      }
    }
  }
  return out
}

/**
 * Righe della TABELLA sotto un'intestazione di colonna che nomina la copertura
 * (verticalCoverColumns, horizontalCoverColumns) il cui PREMIO sta in quella
 * colonna: «Difesa Condominio - ed.2019   298,55» sotto «TUTELA / LEGALE»; non
 * «63,44» sotto «IMPOSTE». Come in una tabella vera: l'importo (coi decimali,
 * non nullo, non percentuale) è una CELLA A SÉ (non «€ 210,00 relative a
 * controversie…» della prosa di un DIP) e l'intestazione più VICINA sopra di
 * lui — la prima riga senza importi con una cella sovrapposta — è proprio
 * quella della copertura (non «Premio alla firma … Responsabilità Civile …»
 * fra «Tutela Legale della Circolazione» e la riga dei premi di un'auto
 * Helvetia, BESA-086). La tabella finisce alla prima riga con testo senza
 * importi dopo le righe dei premi; prima di loro, le righe senza cifre sono il
 * seguito dell'intestazione («PECUNIARIE», «LORDO»).
 * @returns {Set<number>} indici delle righe
 */
export function coverColumnRows(text, names) {
  return new Set(coverColumnPairs(text, names).map((p) => p.row - 1))
}

/**
 * Le celle di coverColumnRows come COPPIE etichetta→valore: per ogni riga della
 * tabella il cui premio sta nella colonna della copertura, l'intestazione
 * (com'è scritta nella griglia), l'importo e l'etichetta della riga. Scheda DAS
 * OneClick di RUZZA FABIO: «TUTELA LEGALE» → 24,00 (riga «Circolazione
 * Stradale Standard - AB»); nella griglia l'intestazione è una cella unica con
 * le altre colonne e la coppia non si vede.
 * `head`: riga (1-based) dell'intestazione della colonna, cioè la TABELLA della
 * coppia (una pagina può averne più d'una: trascrizione e tabelle ricostruite).
 * @returns {{row:number, label:string, value:string, riga:string, head:number}[]} row 1-based
 */
export function coverColumnPairs(text, names) {
  const out = []
  const cols = [...verticalCoverColumns(text, names), ...horizontalCoverColumns(text, names)]
  if (!cols.length) return out
  const lines = String(text || '').split('\n')
  const noise = (l) => !/[\p{L}\p{N}]/u.test(l)
  const amountsOf = (l) => amountMatchesAt(l, STRUCTURAL_AMOUNT_RE)
  const cells = lines.map(gridCellsOf)
  // intestazione più vicina sopra la riga j per l'intervallo [a, b)
  const headerAbove = (j, a, b) => {
    for (let k = j - 1; k >= 0; k--) {
      if (noise(lines[k]) || amountsOf(lines[k]).length) continue
      if (cells[k].some((c) => c.start < b && c.end > a)) return k
    }
    return -1
  }
  const seen = new Set()
  for (const col of cols) {
    const label = lines.slice(col.first, col.line + 1).map((l) => l.slice(col.start, col.end).trim()).filter(Boolean).join(' ')
    let started = false
    for (let j = col.line + 1; j < lines.length; j++) {
      if (noise(lines[j])) continue
      const amounts = amountsOf(lines[j])
      if (!amounts.length) {
        if (!started && !/\d/.test(lines[j])) continue
        break
      }
      started = true
      const hit = amounts.find((m) => {
        const a = m.index, b = m.index + m.text.length
        if (!/[1-9]/.test(m.text) || a >= col.end || b <= col.start) return false
        const cell = cells[j].find((c) => c.start <= a && c.end >= b)
        if (!cell || /\p{L}/u.test(lines[j].slice(cell.start, cell.end).replace(m.text, '').replace(/€|EUR|euro/gi, ''))) return false
        const k = headerAbove(j, a, b)
        return k >= col.first && k <= col.line
      })
      if (!hit || seen.has(j)) continue
      seen.add(j)
      const first = cells[j][0]
      const riga = first && first.start < hit.index ? lines[j].slice(first.start, first.end).trim() : ''
      out.push({ row: j + 1, label, value: hit.text.trim(), riga, head: col.line + 1 })
    }
  }
  return out.sort((a, b) => a.row - b.row)
}

/**
 * Intestazione di colonna su UNA riga: una riga SENZA importi che contiene il
 * nome della copertura; la colonna è l'intervallo di caratteri delle parole del
 * nome in quella riga (non l'intera cella: «TUTELA LEGALE PERDITE ASSISTENZA
 * IMPOSTE PREMIO LORDO» può essere una cella sola). Scheda DAS OneClick di
 * RUZZA FABIO: «Circolazione Stradale Standard - AB   24,00   0,00 …» con 24,00
 * sotto «TUTELA LEGALE».
 */
function horizontalCoverColumns(text, names) {
  const out = []
  const lines = String(text || '').split('\n')
  lines.forEach((line, i) => {
    if (!namesCoverage(line, names) || amountMatchesAt(line, STRUCTURAL_AMOUNT_RE).length) return
    // stessa lunghezza della riga: si piegano solo maiuscole e accenti composti
    const low = [...line].map((c) => c.toLowerCase().normalize('NFD')[0]).join('')
    for (const nm of names) {
      if (!Array.isArray(nm) || !nm.length) continue
      // parole INTERE: «professionale» non sta dentro «extraprofessionale»
      const re = new RegExp('(?<![\\p{L}\\p{N}])' + nm.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]+') + '(?![\\p{L}\\p{N}])', 'gu')
      for (const m of low.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length, line: i, first: i })
    }
  })
  return out
}

/**
 * TESTA della pagina: le prime righe fino a ~120 caratteri (stessa finestra di
 * isQuestionnairePageTitle), sul testo GREZZO (griglia o piatto, mai con le
 * coppie etichetta→valore di withPairs davanti). È dove sta il TITOLO del
 * documento («COPIA DA TRATTENERE / … POLIZZA RAMO TUTELA GIUDIZIARIA»).
 */
export function pageHead(text, maxChars = 120) {
  const out = []
  let used = 0
  for (const line of String(text || '').split('\n')) {
    const flat = line.replace(/\s+/g, ' ').trim()
    if (!flat) continue
    if (used >= maxChars) break
    out.push(line)
    used += flat.length + 1
  }
  return out.join('\n')
}

/** Casella barrata / spunta su una riga della griglia. */
export function lineHasCheck(line) {
  return /(?:^|\s)(?:\[x\]|\[X\]|☒|☑|✓|✔|X)(?:\s|$)/.test(String(line || ''))
}

/** CASELLA barrata ([x], ☒, ☑, X isolata) in un punto qualsiasi della riga; la ✓ / ✔ no. */
export function lineHasBoxCheck(line) {
  return /(?:^|\s)(?:\[x\]|\[X\]|☒|☑|X)(?:\s|$)/.test(String(line || ''))
}

/**
 * La casella barrata è DELLA COPERTURA: subito prima del suo nome (solo spazi
 * in mezzo: «X Tutela legale del condominio», «[x]   Tutela Legale»), oppure
 * ultimo segno della riga dopo il nome («Tutela Legale   X»). Una X in mezzo
 * alla riga è la casella di un'ALTRA voce: «X Ritiro Patente   Tutela Legale
 * X Assistenza» (questionario auto di BESA-083: le X sono di Ritiro Patente e
 * Assistenza), «…DI TUTELA LEGALE SUL MEDESIMO RISCHIO?   X NO   SI» (la
 * risposta a una domanda). Prima bastava una X qualsiasi sulla riga.
 */
function boxNextToCoverName(line, names) {
  const l = String(line || '')
  const heads = names.filter((nm) => Array.isArray(nm) && nm.length).map((nm) => nm.join(''))
  for (const m of l.matchAll(/(?:^|\s)(\[x\]|\[X\]|☒|☑|X)(?=\s|$)/g)) {
    const end = m.index + m[0].length
    const after = normForMatch(l.slice(end))
    if (heads.some((h) => after.startsWith(h))) return true
    // dopo il nome: nel resto della riga nessuna PAROLA (bordi «|», «]», importi
    // «€ 15.000» sì; «Tutela Legale X Assistenza» no: la X è di Assistenza)
    if (!/\p{L}/u.test(l.slice(end)) && namesCoverage(l.slice(0, end - m[1].length), names) === true) return true
  }
  return false
}

/**
 * Una ✓ / ✔ è una SPUNTA della copertura solo se sulla riga sta DOPO il suo
 * nome (segno di colonna: «Tutela Legale   ✓»). Aperta la riga o prima del
 * nome è un PUNTO ELENCO: i DIP scrivono ogni voce così («✓ Ambito civile
 * extracontrattuale : tutela legale», «✓ Tutela Legale» nell'elenco delle
 * garanzie offerte dal prodotto Allianz). Prima quelle righe erano «copertura +
 * spunta»: il DIP andava da solo nel batch 1 e il modello lo leggeva come la
 * scheda (LAMBRATE 24, due auto Allianz di BESA con «Tutela Legale NON
 * OPERANTE» nel contratto: tre polizze senza tutela legale abbinate).
 */
function tickAfterCoverName(line, names) {
  const l = String(line || '')
  // ultimo segno della riga: in un layout a due colonne «Tutela Legale   ✓ Nella
  // sezione…» la ✓ è il punto elenco della colonna accanto
  for (const m of l.matchAll(/[✓✔]/g)) if (!l.slice(m.index + 1).trim() && namesCoverage(l.slice(0, m.index), names) === true) return true
  return false
}

/**
 * Riga STRUTTURALE: nomina la copertura E porta un importo o una spunta sulla
 * stessa riga («Tutela Legale  240,00  42,06», «TUTELA LEGALE  Imponibile annuo
 * € 249,06», «Tutela Legale  ESCLUSA  31.000,00»). È ciò che «Come
 * riconoscerla» chiama premio proprio / casella / riepilogo: un'opzione in un
 * elenco («TUTELA LEGALE (opzionale)») non ce l'ha. Nessun valore o soglia:
 * solo la forma della riga.
 */
export function structuralCoverLines(text, nameTokens, { strictAmount = false } = {}) {
  if (!Array.isArray(nameTokens) || !nameTokens.length) return null
  const amount = strictAmount ? lineHasStructuralAmount : pageHasAmount
  // + le righe col premio nella colonna intestata alla copertura (coverColumnRows)
  const colRows = coverColumnRows(text, nameTokens)
  return String(text || '').split('\n').filter((l, i) => colRows.has(i) || (namesCoverage(l, nameTokens)
    && (amount(l) || boxNextToCoverName(l, nameTokens) || tickAfterCoverName(l, nameTokens))))
}

/** Marcatore di pagina nei prompt: MAI il nome file (stessa regola di stagedDocTag). */
export function operativitaPageTag(ord, page) {
  return `[Documento ${ord} · pag. ${page}]`
}

/** JSON Schema della risposta: tutte le chiavi obbligatorie, esito a tre valori. */
export function operativitaSchema() {
  return {
    $schema: 'https://json-schema.org/draft/07/schema#',
    type: 'object',
    // NIENTE altre domande qui dentro: aggiungere «c'è il contratto?» allo
    // stesso prompt faceva ribaltare l'esito del 7B sulla quietanza DAS
    // («ESCLUSA» tornava un'esclusione). La domanda sul contratto è una
    // chiamata a parte (buildContrattoPrompt), solo quando serve.
    properties: {
      esito: { type: 'string', enum: OPERATIVITA_ESITI },
      documento: { type: 'string' },
      pagina: { type: 'integer' },
      evidenza: { type: 'string' },
      motivo: { type: 'string' },
    },
    required: ['esito', 'documento', 'pagina', 'evidenza', 'motivo'],
    additionalProperties: false,
  }
}

/** Taglia un testo a `max` caratteri utili tenendo righe intere dall'inizio. */
export function cutUseful(text, max) {
  const s = String(text || '')
  if (usefulLength(s) <= max) return s
  const out = []
  let used = 0
  for (const line of s.split('\n')) {
    const len = usefulLength(line) + 1
    if (used + len > max) break
    out.push(line); used += len
  }
  return out.join('\n')
}

/**
 * Sceglie le pagine da mandare al modello entro il budget (in caratteri
 * UTILI), in quest'ordine: (1) le pagine che NOMINANO la copertura (parole
 * distintive di «Come riconoscerla», `lexTokens`; sul frontespizio anche in
 * forma flessa, pageNamesCoverage) E portano importi (scheda
 * con la sezione e il suo premio, quietanza, riepilogo garanzie), per
 * affinità; (2) le altre pagine che la nominano (condizioni, DIP), per
 * affinità; (3) le PRIME pagine dei documenti (frontespizio: è lì che si vede
 * il prodotto); (4) le altre per affinità. Quando una pagina non entra nel
 * budget la selezione SI FERMA: quella pagina apre il batch successivo. Prima
 * si saltava e si andava avanti con le pagine più corte, e una pagina lunga
 * con affinità bassa restava fuori da TUTTI i batch (la scheda di BOIARDO).
 * Il risultato è ordinato per documento e pagina (leggibile nel prompt).
 * @param {{ord:number,page:number,text:string,flat:string,score:number|null}[]} candidates
 * @returns {{ord:number,page:number,text:string,flat:string,score:number|null,cut:boolean,lex?:boolean}[]}
 */
export function selectOperativitaPages(candidates, { budgetChars, maxPageChars = OPERATIVITA_MAX_PAGE_CHARS, lexTokens = [] } = {}) {
  const list = (candidates || []).filter((c) => c && String(c.flat || c.text || '').trim())
  const byScore = (a, b) => ((b.score ?? -1) - (a.score ?? -1)) || (a.ord - b.ord) || (a.page - b.page)
  // Nomina la copertura: forma esatta ovunque, forma flessa sul frontespizio
  // (pageNamesCoverage: stessa regola delle pagine nominate non lette).
  const hasLex = (c) => pageNamesCoverage(c, lexTokens) === true
  const isStructural = (c) => (structuralCoverLines(c.text, lexTokens, { strictAmount: true }) || []).length > 0
  const named = list.filter(hasLex)
  // (0) righe strutturali (nome + importo/spunta sulla stessa riga: la scheda);
  // (1) nominano con importi altrove nella pagina; (2) prosa che nomina.
  const structural = named.filter(isStructural).sort(byScore)
  const namedAmount = named.filter((c) => !isStructural(c) && pageHasAmount(c.flat || c.text)).sort(byScore)
  const namedProse = named.filter((c) => !isStructural(c) && !pageHasAmount(c.flat || c.text)).sort(byScore)
  const firsts = list.filter((c) => !hasLex(c) && c.page === 1).sort(byScore)
  const rest = list.filter((c) => !hasLex(c) && c.page !== 1).sort(byScore)
  const budget = Math.max(0, Number(budgetChars) || 0)
  const chosen = []
  let used = 0
  // Finché ci sono pagine STRUTTURALI il batch è fatto SOLO di quelle: messe
  // insieme alla prosa, il modello sceglieva come prova la frase delle
  // condizioni («Condizioni Tutela Legale: art. 6.7…») invece della riga della
  // scheda due pagine più in là (BOIARDO). Il resto arriva nei batch dopo.
  const order = structural.length ? structural : [...namedAmount, ...namedProse, ...firsts, ...rest]
  for (const c of order) {
    let text = cutUseful(c.text, maxPageChars)
    let len = usefulLength(text)
    if (used + len > budget) {
      // Batch pieno: ci si ferma, questa pagina aprirà il batch successivo.
      // La prima pagina scelta entra sempre, tagliata al budget: meglio mezzo
      // frontespizio che nessuna pagina.
      if (chosen.length) break
      text = cutUseful(text, budget)
      len = usefulLength(text)
      if (!text.trim()) break
    }
    chosen.push({ ...c, text, cut: text.length < String(c.text || '').length, lex: hasLex(c), amount: pageHasAmount(c.flat || c.text), structural: isStructural(c) })
    used += len
  }
  return chosen.sort((a, b) => (a.ord - b.ord) || (a.page - b.page))
}


/**
 * Prompt di operatività. La definizione del TIPO è il testo dell'utente; le
 * parole del contenuto (da cercare / da evitare) sono INDIZI, non regole.
 * Le pagine portano solo il marcatore [Documento N · pag. P].
 */
export function buildOperativitaPrompt({ recognition, contentKeywords = [], contentExcludeKeywords = [], blocks = [] }) {
  const system = 'Sei un verificatore di polizze assicurative italiane. Leggi le pagine e rispondi SOLO con un oggetto JSON, senza testo prima o dopo, senza markdown.'
  const hints = []
  if (contentKeywords.length) hints.push(`Parole del contenuto che l'utente si aspetta di trovare: ${contentKeywords.join(', ')}.`)
  if (contentExcludeKeywords.length) hints.push(`Parole che per l'utente indicano NON pertinenza: ${contentExcludeKeywords.join(', ')} (verifica il contesto: possono riferirsi ad altro).`)
  const pages = blocks.map((b) => `${operativitaPageTag(b.ord, b.page)}\n${b.text}`).join('\n\n')
  const user = [
    'COPERTURA CERCATA — come la riconosce l\'utente:',
    `«${String(recognition || '').trim()}»`,
    ...(hints.length ? ['', ...hints] : []),
    '',
    'DOMANDA: nelle pagine qui sotto questa copertura è OPERANTE, cioè effettivamente acquistata dal contraente?',
    'È operante se è indicata come prodotto o sezione assicurata, se è selezionata/barrata, se ha un premio proprio o se compare nel riepilogo delle garanzie prestate.',
    'NON è operante se è soltanto citata nelle condizioni generali o nel set informativo, se è un\'opzione del modulo non selezionata e senza premio, o se i documenti riguardano un\'altra copertura.',
    '',
    'Rispondi con un oggetto JSON con queste chiavi:',
    '{"esito": "operante" | "non operante" | "non determinabile",',
    ' "documento": "Documento N" (il documento della prova),',
    ' "pagina": numero della pagina della prova,',
    ' "evidenza": "frase COPIATA ESATTAMENTE dal testo (max 200 caratteri) che dimostra l\'esito",',
    // «non operante» senza citazione finiva sempre «Da verificare» (BESA 25/09:
    // «La tutela legale non è selezionata e non ha un premio proprio», nessuna
    // prova): la riga dove la copertura compare È la prova del non acquisto.
    '   (per "non operante" copia la riga in cui la copertura compare: l\'opzione non barrata, la voce senza premio, il richiamo nelle condizioni)',
    ' "motivo": "una frase di spiegazione"}',
    'Se nessuna frase del testo dimostra l\'esito, rispondi "non determinabile" con evidenza vuota.',
    '',
    'PAGINE (una selezione del fascicolo):',
    pages,
  ].join('\n')
  return { system, user }
}

/**
 * DOMANDA SEPARATA: tra le pagine lette c'è il CONTRATTO (frontespizio, scheda
 * di polizza, appendice con garanzie e premi) o solo quietanze / informativa /
 * condizioni? Chiamata a parte per non toccare il prompt di operatività,
 * misurato (messa lì, il 7B ribaltava DAS «ESCLUSA» → esclusione).
 * Dal 26/09/2026 si chiede SEMPRE, una volta per fascicolo e PRIMA
 * dell'operatività, su tutte le pagine finché una polizza non si vede
 * (runContractCheck; regola dell'utente: «SE NON HAI UNA POLIZZA NON ESTRAI:
 * SENZA UNA POLIZZA È SEMPRE NON VALIDO»). Prima si chiedeva solo dopo un
 * «operante»: ALZAIA 101 (una sola quietanza DAS di rinnovo) usciva «non
 * operante» contraddittorio → «Da verificare», la domanda non partiva mai e
 * «Procedi comunque» estraeva la quietanza. Una sola domanda del fascicolo e
 * non una per batch di operatività: la risposta non dipende più dal profilo
 * (quali pagine l'operatività mette prima) e costa di solito una chiamata.
 * Testo e schema invariati rispetto alla misura del 22/09.
 */
export function buildContrattoPrompt({ blocks = [] }) {
  const system = 'Sei un verificatore di polizze assicurative italiane. Rispondi SOLO con un oggetto JSON, senza testo prima o dopo, senza markdown.'
  const pages = blocks.map((b) => `${operativitaPageTag(b.ord, b.page)}\n${b.text}`).join('\n\n')
  const user = [
    'Le pagine qui sotto vengono da un fascicolo assicurativo.',
    // (03/10/2026: aggiunta e TOLTA la coda «o preventivi / quotazioni / offerte /
    // proposte che non riportano un numero di polizza»: il modello la ripeteva per
    // una polizza scansionata senza numero leggibile (ARENA 1 TL «assente», Non
    // valido non forzabile) e prendeva una voltura per contratto (SONZOGNI). I
    // preventivi li toglie preContractLabel, prima del modello.)
    'DOMANDA: tra queste pagine c\'è il CONTRATTO vero e proprio — frontespizio o scheda di polizza, appendice o atto con le garanzie e i premi — oppure ci sono SOLTANTO quietanze di pagamento del premio, set informativo, DIP, questionari o condizioni generali?',
    '',
    'Rispondi con un oggetto JSON con queste chiavi:',
    '{"contratto": "presente" | "assente" | "non determinabile",',
    ' "documento": "Documento N" (dove sta il contratto, se presente),',
    ' "pagina": numero della pagina,',
    ' "motivo": "una frase: che tipo di pagine sono"}',
    '',
    'PAGINE:',
    pages,
  ].join('\n')
  return { system, user }
}

/**
 * DOCUMENTI DI UNA POLIZZA DEL PROFILO SENZA LA POLIZZA (05/10/2026, verifica
 * del cliente su CAVALLO FT796KM: un'appendice DAS «modifica dati
 * contrattuali» della polizza 01469AC12900228, senza il contratto, era un
 * semplice «Non valido»; chiesto «Pertinente ma incompleta – reperire la
 * polizza principale»). Quando la domanda sul contratto dice «assente», si
 * chiede al modello se le pagine si riferiscono comunque a una polizza del
 * tipo che il PROFILO definisce («Come riconoscerla»): decide la definizione,
 * nessuna parola del codice. Il fascicolo resta Non valido (non si estrae, non
 * si forza); cambia l'etichetta e il messaggio.
 */
export function buildIncompletaPrompt({ recognition, blocks = [] }) {
  const system = 'Sei un verificatore di polizze assicurative italiane. Rispondi SOLO con un oggetto JSON, senza testo prima o dopo, senza markdown.'
  const pages = blocks.map((b) => `${operativitaPageTag(b.ord, b.page)}\n${b.text}`).join('\n\n')
  const user = [
    'Le pagine qui sotto vengono da un fascicolo assicurativo in cui NON c\'è il contratto vero e proprio.',
    'DEFINIZIONE del tipo di polizza:',
    String(recognition || '').trim(),
    '',
    'DOMANDA: queste pagine si riferiscono a una polizza di QUESTO tipo (per esempio sono sue appendici, quietanze, certificati o comunicazioni)?',
    '',
    'Rispondi con un oggetto JSON con queste chiavi:',
    '{"riferita": "sì" | "no" | "non determinabile",',
    ' "numero": "il numero della polizza a cui si riferiscono, copiato dal testo (vuoto se non c\'è)",',
    ' "documento": "Documento N", "pagina": numero della pagina,',
    ' "evidenza": "la frase che lo mostra, copiata esattamente dal testo"}',
    '',
    'PAGINE:',
    pages,
  ].join('\n')
  return { system, user }
}

export function incompletaSchema() {
  return {
    $schema: 'https://json-schema.org/draft/07/schema#',
    type: 'object',
    properties: { riferita: { type: 'string', enum: ['sì', 'no', 'non determinabile'] }, numero: { type: 'string' }, documento: { type: 'string' }, pagina: { type: 'integer' }, evidenza: { type: 'string' } },
    required: ['riferita', 'numero', 'documento', 'pagina', 'evidenza'],
    additionalProperties: false,
  }
}

const normCite = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9àèéìòù]+/g, ' ').trim()

/**
 * Risposta alla domanda «pertinente ma incompleta»: vale solo un «sì» la cui
 * evidenza si ritrova nel testo di una pagina mostrata; il numero solo se è
 * scritto in una pagina mostrata. @returns {{numero: string|null, documento: number|null, pagina: number|null} | null}
 */
/**
 * ESEMPI che la DEFINIZIONE («Come riconoscerla») dà del tipo di polizza, nella
 * sola parte POSITIVA (prima di «NON …»): le voci di una parola sola tra
 * parentesi dopo «es.» («DAS», «ARAG»: nomi di prodotto o di compagnia). Servono
 * a riconoscere senza modello i documenti di una polizza del profilo senza la
 * polizza (l'appendice DAS di CAVALLO FT796KM non dice mai «tutela legale»). Il
 * nome della copertura no: «tutela legale» sta anche nelle informative privacy.
 * @returns {string[]}
 */
export function recognitionNamedExamples(recognition) {
  const positive = String(recognition || '').split(/\bNON\b/)[0]
  const out = []
  for (const m of positive.matchAll(/\((?:es\.?|ad esempio|per esempio)\s*([^)]*)\)/gi)) {
    for (const part of m[1].split(/[,;]/)) {
      const t = part.replace(/["«»“”']/g, '').trim()
      if (/^[A-Za-zÀ-ÿ.&-]{3,}$/.test(t)) out.push(t)
    }
  }
  return [...new Set(out)]
}

/** Il testo nomina uno dei nomi come PAROLE intere, senza i punti delle sigle («D.A.S.» = DAS). */
export function textNamesAny(text, names) {
  const words = ' ' + String(text || '').replace(/\./g, '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean).join(' ') + ' '
  return (names || []).some((n) => {
    const w = String(n || '').replace(/\./g, '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter(Boolean).join(' ')
    return w.length >= 3 && words.includes(` ${w} `)
  })
}

export function checkIncompletaAnswer(raw, blocks) {
  let a = null
  try { a = typeof raw === 'string' ? JSON.parse(String(raw).match(/\{[\s\S]*\}/)?.[0] || 'null') : raw } catch { a = null }
  if (!a || String(a.riferita || '').toLowerCase() !== 'sì') return null
  const ev = normCite(a.evidenza)
  const texts = (blocks || []).map((b) => normCite(b.text))
  if (!ev || ev.length < 6 || !texts.some((t) => t.includes(ev))) return null
  const num = String(a.numero || '').trim()
  const numKey = num.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const numOk = numKey.length >= 5 && (blocks || []).some((b) => String(b.text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').includes(numKey))
  const m = String(a.documento || '').match(/(\d+)/)
  return { numero: numOk ? num : null, documento: m ? Number(m[1]) : null, pagina: Number.isInteger(a.pagina) ? a.pagina : null }
}

export function contrattoSchema() {
  return {
    $schema: 'https://json-schema.org/draft/07/schema#',
    type: 'object',
    properties: { contratto: { type: 'string', enum: OPERATIVITA_CONTRATTO }, documento: { type: 'string' }, pagina: { type: 'integer' }, motivo: { type: 'string' } },
    required: ['contratto', 'documento', 'pagina', 'motivo'],
    additionalProperties: false,
  }
}

/**
 * Pagine per la domanda sul CONTRATTO, fatta UNA volta per fascicolo e prima
 * dell'operatività (la polizza c'è o non c'è, qualunque sia il profilo):
 * prima la PRIMA pagina con testo di ogni documento (il frontespizio sta lì:
 * stesso criterio type-blind dei «firsts» di selectOperativitaPages), poi le
 * altre per (documento, pagina, parte). Nessun embedding: conta la posizione,
 * non l'affinità a un profilo. Stessa regola del budget: la pagina che non
 * entra apre il batch dopo; la prima entra sempre, tagliata.
 * @param {{ord:number,page:number,part?:number|null,text:string,flat?:string,first?:boolean}[]} candidates
 * @returns {{ord:number,page:number,text:string,cut:boolean}[]}
 */
export function selectContrattoPages(candidates, { budgetChars, maxPageChars = OPERATIVITA_MAX_PAGE_CHARS, firstsOnly = false } = {}) {
  const list = (candidates || []).filter((c) => c && String(c.flat || c.text || '').trim())
  const byPos = (a, b) => (a.ord - b.ord) || (a.page - b.page) || ((a.part || 0) - (b.part || 0))
  // «Prima pagina» = la prima CON TESTO del documento (`first`, marcata da chi
  // costruisce i candidati: una copertina scansionata vuota non la sposta);
  // senza marcatura, la pagina 1.
  const isFirst = (c) => (typeof c.first === 'boolean' ? c.first : c.page === 1)
  const firsts = list.filter(isFirst).sort(byPos)
  // [flag primepagine] Il primo batch con le SOLE prime pagine: in un PDF unico
  // la scheda di polizza non finisce sommersa da venti parti di set informativo
  // e condizioni (DAS ARENA, scansione: «presente» o «assente» a seconda della
  // corsa). Le altre pagine aprono il batch dopo.
  const rest = firstsOnly && firsts.length ? [] : list.filter((c) => !isFirst(c)).sort(byPos)
  const budget = Math.max(0, Number(budgetChars) || 0)
  const chosen = []
  let used = 0
  for (const c of [...firsts, ...rest]) {
    let text = cutUseful(c.text, maxPageChars)
    let len = usefulLength(text)
    if (used + len > budget) {
      if (chosen.length) break
      text = cutUseful(text, budget)
      len = usefulLength(text)
      if (!text.trim()) break
    }
    chosen.push({ ...c, text, cut: text.length < String(c.text || '').length })
    used += len
  }
  return chosen.sort(byPos)
}

/**
 * Un «presente» vale solo se cita un documento (e una pagina, se la dà) tra
 * quelli MOSTRATI in quel batch: il modello deve indicare dove l'ha visto, e
 * un posto che non ha visto non è una prova (26/09/2026). Altrimenti la
 * risposta diventa «non determinabile»: niente estrazione, e nemmeno un
 * «assente» per tutto il fascicolo. Per «assente» e «non determinabile»
 * documento e pagina si azzerano: il prompt li chiede solo «se presente» e
 * «Assente — Documento 1 pag. 1» faceva pensare che la polizza fosse lì.
 * @param {{contratto:string,documento:number|null,pagina:number|null,motivo:string}|null} answer  da parseContrattoAnswer
 * @param {{ord:number,page:number}[]} blocks  pagine inviate nel batch
 */
export function checkContractAnswer(answer, blocks) {
  if (!answer) return null
  if (answer.contratto !== 'presente') return { ...answer, documento: null, pagina: null }
  const sent = (blocks || []).filter((b) => b && b.ord === answer.documento)
  const pageOk = answer.pagina == null || sent.some((b) => b.page === answer.pagina)
  if (sent.length && pageOk) return answer
  const where = `Documento ${answer.documento ?? '?'}${answer.pagina ? ` pag. ${answer.pagina}` : ''}`
  return { contratto: 'non determinabile', documento: null, pagina: null, motivo: `«presente» citando ${where}, che non è tra le pagine mostrate al modello${answer.motivo ? ` (${answer.motivo})` : ''}`, citedOutside: true }
}

/**
 * PRESENZA DELLA POLIZZA sulle risposte alla domanda sul contratto, batch per
 * batch (regola dell'utente del 26/09/2026: «SENZA UNA POLIZZA È SEMPRE NON
 * VALIDO»). Decide la risposta del MODELLO: nessuna parola, nessun tipo di
 * documento, nessun nome file.
 *
 * | risposte dei batch                                   | esito
 * | almeno un «presente» (citato tra le pagine mostrate) | presente
 * | TUTTI «assente», ogni pagina con testo mostrata e
 * |   ogni documento con testo                           | assente → NON VALIDO
 * | tutti «assente», ma pagine mai mostrate (tetto dei
 * |   batch) o un documento senza testo                  | non verificata
 * | almeno un «non determinabile» o illeggibile          | non determinabile
 * | nessuna risposta                                     | non verificata
 *
 * «assente» è l'unico esito NON forzabile, quindi deve essere certo: ogni
 * batch lo dice e nessuna pagina è rimasta fuori. Prima bastava un «assente»
 * con le sole pagine 1 lette: un PDF unico con lettera di trasmissione a pag.
 * 1 e polizza a pag. 2 diventava Non valido senza rimedio; e un «assente»
 * accanto a un «non determinabile» (la scheda letta male, un JSON troncato)
 * vinceva. «non determinabile» e «non verificata» NON sono Non valido: sono
 * «polizza non vista dal modello» (Da verificare, si estrae solo se
 * l'operatore forza). Un guasto (Ollama giù) non passa di qui: lo gestisce il
 * chiamante (non verificata con `error`, mai Non valido).
 * @param {({contratto:string,documento?:number|null,pagina?:number|null,motivo?:string}|null)[]} answers  in ordine di batch
 * @param {{unreadPages?:number, docsWithoutText?:number}} opts
 *   unreadPages: pagine con testo mai mostrate alla domanda (anche solo in parte)
 * @returns {{esito:'presente'|'assente'|'non determinabile'|'non verificata', documento:number|null, pagina:number|null, motivo:string, reason:string, asked:number}}
 */
export function decideContract(answers, { unreadPages = 0, docsWithoutText = 0 } = {}) {
  const list = (answers || []).map((a) => a || { contratto: 'non determinabile', documento: null, pagina: null, motivo: '' })
  const asked = list.length
  const base = { documento: null, pagina: null, motivo: '', asked }
  const yes = list.find((a) => a.contratto === 'presente')
  if (yes) {
    const where = yes.documento ? ` (Documento ${yes.documento}${yes.pagina ? ` pag. ${yes.pagina}` : ''})` : ''
    return { ...base, esito: 'presente', documento: yes.documento ?? null, pagina: yes.pagina ?? null, motivo: yes.motivo || '', reason: `polizza presente${where}${yes.motivo ? `: ${yes.motivo}` : ''}` }
  }
  if (!asked) return { ...base, esito: 'non verificata', reason: 'domanda sulla polizza non eseguita' }
  if (!list.every((a) => a.contratto === 'assente')) {
    const nd = list.filter((a) => a.contratto !== 'assente')
    const m = nd.find((a) => a.motivo)?.motivo || ''
    const mixed = nd.length < asked ? ` (${asked - nd.length} su ${asked} ${asked === 1 ? 'risposta' : 'risposte'} «assente», le altre incerte)` : ''
    return { ...base, esito: 'non determinabile', motivo: m, reason: `il modello non ha potuto dire se tra i documenti c'è una polizza${mixed}${m ? `: ${m}` : ''}` }
  }
  // Cosa c'è al posto della polizza, con le parole del modello («solo una
  // quietanza di pagamento del premio»): è il perché scritto all'utente. Senza
  // un motivo del modello il testo resta neutro (nessuna ipotesi del codice).
  const motivi = [...new Set(list.map((a) => String(a.motivo || '').trim()).filter(Boolean))].slice(0, 2)
  const what = motivi.length ? motivi.join('; ') : 'il modello non ha visto un contratto nelle pagine lette'
  const common = { ...base, motivo: motivi.join('; ') }
  const gaps = []
  if (unreadPages > 0) gaps.push(`${unreadPages} ${unreadPages === 1 ? 'pagina non è stata mostrata' : 'pagine non sono state mostrate'} al modello`)
  if (docsWithoutText > 0) gaps.push(`${docsWithoutText} ${docsWithoutText === 1 ? 'documento è senza testo leggibile' : 'documenti sono senza testo leggibile'}`)
  if (gaps.length) return { ...common, esito: 'non verificata', reason: `nessuna polizza nelle pagine lette (${what}), ma ${gaps.join(' e ')}: la polizza potrebbe stare lì` }
  return { ...common, esito: 'assente', reason: `nessuna polizza tra i documenti letti: ${what}` }
}

/**
 * Applica la presenza della polizza (decideContract) al verdetto di
 * operatività. «assente» vince su TUTTO — operante, non operante, dubbio:
 * verdetto 'setaside' (NON VALIDO, mai forzabile; decidePrecheck lo mappa su
 * mismatch + notValid). «non determinabile» e «non verificata» sono «polizza
 * non vista dal modello»: un «ok» diventa un dubbio (senza una polizza vista
 * non si estrae da soli: ALZAIA 101, una quietanza con «Tutela Legale 240,00»
 * può dare un «operante» provato), gli altri verdetti restano bloccati con la
 * nota nel perché, così chi preme «Procedi comunque» sa cosa forza.
 * «presente» lascia il verdetto com'è. Il risultato porta sempre `polizza`
 * (motivazione e UI) e `operativitaVerdict` (l'esito della sola copertura:
 * serve alla scelta del profilo Automatico e ai suggerimenti).
 */
export function applyContractVerdict(op, contract) {
  if (!op || !contract) return op
  const polizza = { esito: contract.esito, documento: contract.documento ?? null, pagina: contract.pagina ?? null, motivo: contract.motivo || '', reason: contract.reason || '', asked: contract.asked ?? null, ...(contract.error ? { error: true } : {}) }
  const opVerdict = op.operativitaVerdict !== undefined ? op.operativitaVerdict : (op.verdict ?? null)
  if (contract.esito === 'assente') {
    return { ...op, verdict: 'setaside', notValid: true, operativitaVerdict: opVerdict, contratto: 'assente', polizza, reason: contract.reason }
  }
  if (contract.esito === 'presente') return { ...op, operativitaVerdict: opVerdict, contratto: contract.esito, polizza }
  const note = polizzaDoubtNote(contract)
  const reason = op.reason ? `${op.reason}; ${note}` : note
  return { ...op, verdict: op.verdict === 'ok' ? 'review' : op.verdict, operativitaVerdict: opVerdict, contratto: contract.esito, polizza, reason }
}

/** Nota «polizza non vista dal modello» nel perché di un verdetto (stessa in polizzaPrecheck.js). */
export function polizzaDoubtNote(contract) {
  return `polizza non vista dal modello (${contract?.esito || 'non verificata'}): ${contract?.reason || ''}`
}

/** Legge la risposta alla domanda sul contratto. null se illeggibile. */
export function parseContrattoAnswer(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/)
  if (!m) return null
  let obj
  try { obj = JSON.parse(m[0]) } catch { return null }
  if (!obj || typeof obj !== 'object') return null
  const cRaw = String(obj.contratto || '').toLowerCase().trim()
  const contratto = cRaw.startsWith('presente') || cRaw === 'si' || cRaw === 'sì' ? 'presente' : cRaw.startsWith('assente') || cRaw === 'no' ? 'assente' : 'non determinabile'
  const docNum = String(obj.documento ?? '').match(/\d+/)
  const pag = parseInt(String(obj.pagina ?? '').replace(/\D+/g, ''), 10)
  return { contratto, documento: docNum ? parseInt(docNum[0], 10) : null, pagina: Number.isFinite(pag) && pag > 0 ? pag : null, motivo: typeof obj.motivo === 'string' ? obj.motivo.trim().slice(0, 300) : '' }
}

/** Legge la risposta del modello (JSON, anche sporco). null se illeggibile. */
export function parseOperativitaAnswer(raw) {
  const s = String(raw || '')
  const m = s.match(/\{[\s\S]*\}/)
  if (!m) return null
  let obj
  try { obj = JSON.parse(m[0]) } catch { return null }
  if (!obj || typeof obj !== 'object') return null
  const esitoRaw = String(obj.esito || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const esito = esitoRaw.startsWith('non operante') || esitoRaw === 'no'
    ? 'non operante'
    : esitoRaw.startsWith('operante') || esitoRaw === 'si' || esitoRaw === 'sì'
      ? 'operante'
      : 'non determinabile'
  const docNum = String(obj.documento ?? '').match(/\d+/)
  const pag = parseInt(String(obj.pagina ?? '').replace(/\D+/g, ''), 10)
  return {
    esito,
    documento: docNum ? parseInt(docNum[0], 10) : null,
    pagina: Number.isFinite(pag) && pag > 0 ? pag : null,
    evidenza: typeof obj.evidenza === 'string' ? obj.evidenza.trim().slice(0, 300) : '',
    motivo: typeof obj.motivo === 'string' ? obj.motivo.trim().slice(0, 300) : '',
  }
}

/**
 * La prova citata sta davvero nel testo inviato? Prima nella pagina citata,
 * poi in qualsiasi altra pagina inviata (il modello sbaglia spesso il numero
 * di pagina, non la frase). Confronto sul testo NORMALIZZATO (niente spazi,
 * accenti, punteggiatura: il rumore della griglia/OCR) e, per le citazioni
 * riscritte, per TOKEN (tutti i token ≥4 caratteri nella stessa pagina).
 * `names`: la prova NOMINA la copertura — forma esatta, oppure forma flessa se
 * la pagina della prova è il FRONTESPIZIO del suo documento (pageNamesCoverage:
 * «AMTRUST PROFESSIONISTA SANITARIO PROTETTO» nomina la RC «sanitaria», «AMTRUST
 * TUTELA MEDICI» a pag. 2 no). `formPage`: TUTTE le pagine inviate che
 * contengono la prova sono pagine di questionario/proposta (`questionnaire`, dal
 * titolo della pagina): se la stessa frase sta anche nel contratto, la prova è
 * del contratto, qualunque sia l'ordine dei documenti.
 * @returns {{found:boolean, names:boolean|null, structural:boolean|null, proofIsCoverageRow?:boolean, formPage?:boolean, ord:number|null, page:number|null, where:'citata'|'altra pagina'|null, reason:string}}
 */

export function verifyOperativitaEvidence(answer, blocks, { lexTokens = [], lineQuote = false } = {}) {
  const ev = String(answer?.evidenza || '').trim()
  const ne = normForMatch(ev)
  // La prova NOMINA la copertura? (null = nessuna parola distintiva: non giudicabile)
  const exactNames = namesCoverage(ev, lexTokens)
  if (ne.length < OPERATIVITA_MIN_EVIDENCE) return { found: false, names: exactNames, ord: null, page: null, where: null, reason: ev ? 'prova troppo corta' : 'nessuna prova citata' }
  const tokens = valueTokens(ev).filter((t) => t.length >= 4)
  // Cifre della citazione (importi, numeri di polizza): devono esserci tutte.
  // Numero per numero sul testo GREZZO: normalizzato, «ed.2019 361,99» diventava
  // un solo «201936199» che nella pagina non c'è (la citazione salta le colonne
  // di mezzo della riga del premio DAS).
  const digitRuns = [...new Set([...ev.matchAll(/\d[\d.,]*\d|\d/g)].map((m) => m[0].replace(/\D/g, '')).filter((d) => d.length >= 3))]
  const matches = (b) => {
    // SOLO il testo che il modello ha visto (b.text, eventualmente tagliato):
    // la pagina intera (flat) conterrebbe righe mai inviate.
    const norm = normForMatch(b.text || '')
    if (!norm) return false
    if (norm.includes(ne)) return true
    // Citazione riscritta: tutti i token (≥4 lettere, almeno 4 di essi, o 3 con
    // cifre) e tutte le cifre nella stessa pagina. Tre parole comuni non bastano.
    // [flag citazioneriga] Riga del premio citata saltando parole in mezzo
    // («Tutela Legale - 24,88 3,12 28,00» per «Tutela Legale DAS DRIVE - 24,88
    // 3,12 28,00»): bastano due parole e due importi se stanno, nello stesso
    // ordine, su UNA riga del testo inviato.
    if (lineQuote && tokens.length >= 2 && digitRuns.length >= 2) {
      const parts = [...tokens, ...digitRuns]
      const inOrder = (nl) => { let at = 0; for (const x of parts) { const k = nl.indexOf(x, at); if (k < 0) return false; at = k + x.length } return true }
      if (String(b.text || '').split('\n').some((l) => inOrder(normForMatch(l)))) return true
    }
    if (tokens.length < 3 || (tokens.length < 4 && !digitRuns.length)) return false
    return tokens.every((t) => norm.includes(t)) && digitRuns.every((d) => norm.includes(d))
  }
  // structural: la pagina della prova ha una riga col nome della copertura E un
  // importo/spunta (null = nome non determinabile).
  const struct = (b) => { const l = structuralCoverLines(b.text, lexTokens, { strictAmount: true }); return l === null ? null : l.length > 0 }
  // La prova È una riga strutturale con un importo non nullo? (la copertura
  // con un suo premio/somma: «Tutela Legale  ESCLUSA  31.000,00» della
  // quietanza DAS, dove ESCLUSA è la colonna dell'indicizzazione).
  const proofRow = (b) => {
    const rows = structuralCoverLines(b.text, lexTokens) || []
    return rows.some((l) => lineHasNonZeroAmount(l) && (normForMatch(l).includes(ne) || ne.includes(normForMatch(l)) || valueTokens(ev).filter((t) => t.length >= 4).every((t) => normForMatch(l).includes(normForMatch(t)))))
  }
  const found = (blocks || []).filter(matches)
  if (!found.length) return { found: false, names: exactNames, structural: null, ord: null, page: null, where: null, reason: 'prova citata non trovata nel testo inviato' }
  const cited = found.find((b) => b.ord === answer?.documento && b.page === answer?.pagina)
  const b = cited || found[0]
  // Forma flessa del nome solo se la prova sta sul FRONTESPIZIO (stessa regola delle pagine).
  const names = exactNames === false && b.first ? namesCoverageAnyForm(ev, lexTokens) === true : exactNames
  const formPage = found.every((x) => !!x.questionnaire)
  // PRODOTTO di tutela legale (decisione dell'utente 26/09/2026, «accetta se il
  // documento nomina la copertura»), fuori dai questionari, in due forme:
  // (1) la riga citata è il PREMIO della copertura in una colonna intestata a
  //     lei (coverColumnRows): «Difesa Condominio - ed.2019 298,55 63,44
  //     361,99» sotto «TUTELA / LEGALE», intestazione spezzata su due righe
  //     (DAS condominio). Prima bastava un importo qualsiasi nella citazione e
  //     un documento che nominasse la copertura: la revisione avversaria del
  //     27/09 ha fatto passare «INCENDIO … 3.400.000,00 315,41» di una ITAS con
  //     «TUTELA LEGALE non acquistata» (MORANDI 11) e «Indicizzazione [X] €
  //     176,46» del frontespizio Helvetia (BESA-093/152). Ora l'importo deve
  //     stare nella colonna della copertura.
  // (2) la prova sta sul FRONTESPIZIO che la nomina nel TITOLO (pageHead:
  //     «POLIZZA RAMO TUTELA GIUDIZIARIA»; mai «5. Tutela legale € = = =» a metà
  //     pagina) e la pagina ha una riga con una casella barrata e un premio
  //     («[x] Difesa Penale e Civile 99,84»: le garanzie scelte). Mai la riga
  //     «ATTIVITÀ:» del certificato LUCCA. Senza `head` (test) vale la pagina.
  const lineMatches = (l) => {
    const nl = normForMatch(l)
    if (!nl) return false
    if (nl.includes(ne) || (nl.length >= OPERATIVITA_MIN_EVIDENCE && ne.includes(nl))) return true
    return tokens.length >= 2 && tokens.every((t) => nl.includes(normForMatch(t))) && digitRuns.length > 0 && digitRuns.every((d) => nl.includes(d))
  }
  const colRows = coverColumnRows(b.text, lexTokens)
  const onCoverColumn = colRows.size > 0 && String(b.text || '').split('\n').some((l, i) => colRows.has(i) && lineMatches(l))
  const titleNamed = typeof b.head === 'string'
    ? namesCoverageAnyForm(b.head, lexTokens) === true
    : pageNamesCoverage(b, lexTokens) === true
  const productProof = !formPage && (onCoverColumn || (!!b.first && titleNamed
    && String(b.text || '').split('\n').some((l) => lineHasBoxCheck(l) && lineHasStructuralAmount(l))))
  return {
    found: true, names, structural: struct(b), proofIsCoverageRow: proofRow(b), formPage, productProof, ord: b.ord, page: b.page,
    where: cited ? 'citata' : 'altra pagina', reason: cited ? 'prova trovata nella pagina citata' : `prova trovata in Documento ${b.ord} pag. ${b.page}`,
  }
}

/**
 * DECISIONE. In dubbio non si estrae: tutto ciò che non è "operante con prova"
 * blocca; solo "non operante con prova" è un vero scarto (mismatch), il resto
 * è «da verificare» (review) — l'utente decide con Procedi/Riabbina.
 *
 * | esito             | prova   | parola da evitare | verdetto |
 * | operante          | trovata | no                | ok       |
 * | operante          | trovata | sì                | review   |
 * | operante          | GENERICA (non nomina la copertura) | review |
 * | operante          | pagina SENZA riga «copertura + importo/spunta» | review |
 * | operante          | assente | —                 | review   |
 * | non operante      | trovata | —                 | mismatch |
 * | non operante      | la riga della copertura con un suo importo | review |
 * | non operante      | SOLO in pagine di questionario/proposta | mismatch (formEvidence) |
 * | non operante      | assente | —                 | review   |
 * | non determinabile | —       | —                 | review   |
 * | guasto            | —       | —                 | review   |
 * `requireStructural` = la definizione ammette una SEZIONE
 * (recognitionAllowsSection): vale per la riga strutturale.
 * `formEvidence`: il «non operante» è provato da una RICHIESTA (questionario,
 * proposta), non dal contratto. Da solo resta uno scarto (l'opzione della
 * copertura non barrata nel questionario delle esigenze è la prova più comune
 * di non acquisto: Vittoria «Tutela Legale» senza X, Unipol «o la fornitura di
 * servizi di tutela legale…»); ma NON contraddice un «operante» provato nel
 * contratto (combineOperativitaBatches).
 */
export function decideOperativita({ answer, evidence, excludeMatched = [], error = null, requireStructural = true } = {}) {
  const base = {
    esito: answer?.esito || null,
    documento: evidence?.found ? evidence.ord : (answer?.documento ?? null),
    pagina: evidence?.found ? evidence.page : (answer?.pagina ?? null),
    evidenza: answer?.evidenza || '',
    motivo: answer?.motivo || '',
    evidenceFound: !!evidence?.found,
  }
  if (error) return { ...base, verdict: 'review', reason: `controllo di operatività non eseguibile: ${error}` }
  if (!answer) return { ...base, verdict: 'review', reason: 'risposta del modello non leggibile' }
  const why = base.motivo ? `: ${base.motivo}` : ''
  if (answer.esito === 'non determinabile') return { ...base, verdict: 'review', reason: `copertura non determinabile dal testo${why}` }
  if (answer.esito === 'operante') {
    if (!evidence?.found) return { ...base, verdict: 'review', reason: `copertura dichiarata operante ma la prova citata non è nel testo (${evidence?.reason || 'assente'})${why}` }
    // Prova GENERICA: sta nel testo ma non nomina la copertura («Ogni garanzia
    // opera secondo i termini… delle apposite sezioni»): non dimostra nulla.
    // Prodotto di tutela legale (productProof): la riga del premio o la scheda
    // del documento che nomina la copertura valgono come prova, anche senza la
    // parola nella riga né la riga «copertura + importo».
    const product = !!evidence.productProof && evidence.names === false
    if (product) {
      if (excludeMatched.length) return { ...base, verdict: 'review', reason: `elementi contraddittori: parola da evitare «${excludeMatched[0]}» nel testo, ma copertura operante${why}` }
      return { ...base, verdict: 'ok', productProof: true, reason: `copertura operante (prodotto: il documento della prova nomina la copertura)${why}` }
    }
    if (evidence.names === false) return { ...base, verdict: 'review', reason: `copertura dichiarata operante ma la prova citata è generica: non nomina la copertura${why}` }
    // Prova senza STRUTTURA: nella pagina nessuna riga con la copertura accanto
    // a un importo o a una spunta («TUTELA LEGALE (opzionale)» nell'elenco
    // delle opzioni di un DIP): un'offerta, non un acquisto.
    // Solo se la definizione ammette una SEZIONE (recognitionAllowsSection):
    // quando la copertura è il prodotto intero la riga strutturale non serve.
    if (requireStructural && evidence.structural === false) return { ...base, verdict: 'review', reason: `copertura dichiarata operante ma nella pagina della prova nessuna riga la affianca a un premio, importo o spunta${why}` }
    if (excludeMatched.length) return { ...base, verdict: 'review', reason: `elementi contraddittori: parola da evitare «${excludeMatched[0]}» nel testo, ma copertura operante${why}` }
    return { ...base, verdict: 'ok', reason: `copertura operante${why}` }
  }
  if (!evidence?.found) return { ...base, verdict: 'review', reason: `copertura dichiarata non operante ma la prova citata non è nel testo (${evidence?.reason || 'assente'})${why}` }
  // Contraddizione: «non operante» provato con la RIGA della copertura che
  // porta un suo importo non nullo — è così che si presenta una copertura
  // acquistata (DAS: «Tutela Legale  ESCLUSA  31.000,00», ESCLUSA = colonna
  // indicizzazione). In dubbio non si scarta: da verificare.
  if (evidence.proofIsCoverageRow) return { ...base, verdict: 'review', reason: `copertura dichiarata non operante ma la prova è la riga della copertura con un suo importo: dato contraddittorio${why}` }
  // Prova SOLO in pagine di QUESTIONARIO/PROPOSTA (titolo della pagina,
  // isQuestionnairePageTitle): scarto come ogni «non operante» provato, ma
  // marcato — il modulo registra ciò che si CHIEDE. BOLCHINI RC 2025
  // (26/09/2026): «Indicare il massimale per il quale si richiede copertura: €
  // 250.000» come prova di «non operante», poi la polizza «operante» → «esiti
  // contraddittori» e una polizza vera bloccata.
  if (evidence.formPage) return { ...base, verdict: 'mismatch', formEvidence: true, reason: `copertura non operante secondo un questionario/proposta (una richiesta, non il contratto)${why}` }
  // structuralPage: la pagina della prova ha una riga con la copertura e un
  // premio o una casella — i segni dell'«operante» nella definizione. Un «no»
  // da lì resta uno scarto, ma non basta alla regola (a) per zittire un «non
  // determinabile» (combineOperativitaBatches).
  return { ...base, verdict: 'mismatch', structuralPage: requireStructural && evidence.structural === true, reason: `copertura non operante${why}` }
}

/**
 * Copertura MAI NOMINATA nel fascicolo: nessuna pagina contiene il nome della
 * copertura ricavato da «Come riconoscerla» (recognitionCoverName). L'assenza
 * non si può citare — il modello diceva giustamente «non operante» ma senza
 * prova, e tutto finiva «Da verificare» (BESA 25/09: polizza vita MetLife,
 * appendice Cat Nat, infortuni conducente: 6 dubbi su 9). Qui è un fatto del
 * testo, non un giudizio: non operante, senza chiamare il modello.
 * Il nome si cerca per forma esatta su tutte le pagine e in forma FLESSA sui
 * frontespizi (`titlePages`, prima pagina con testo di ogni documento: stessa
 * regola di pageNamesCoverage). Per forma esatta «MEDICA / SANITARIA» non
 * trovava «… Professionale del Medico», «Professioni Sanitarie», «PROFESSIONISTA
 * SANITARIO» e scartava senza modello 5 polizze RC mediche vere su 16 della
 * cartella rcpm; con la forma flessa su TUTTE le pagine 55 dossier di altri
 * rami su 205 perdevano lo scarto (certificato medico, spese sanitarie), sui
 * soli frontespizi 8 (informative privacy, set informativi DAS «ambito
 * medico-sanitario») più la TL per medici PRINA: decide il modello. Misura
 * del 26/09/2026.
 * @param {string[]} pageTexts  testi (piatti o griglia) di TUTTE le pagine lette
 * @param {string[][]} names    nomi della copertura (recognitionCoverName)
 * @param {{titlePages?:string[]}} [opts]  testi dei frontespizi (anche già in pageTexts)
 * @returns {boolean} true = mai nominata (false anche se non giudicabile)
 */
export function coverNeverNamed(pageTexts, names, { titlePages = [] } = {}) {
  if (!Array.isArray(names) || !names.length) return false
  const texts = (pageTexts || []).filter((t) => String(t || '').trim())
  if (!texts.length) return false
  if (texts.some((t) => namesCoverage(t, names) || verticalCoverColumns(t, names).length)) return false
  return !(titlePages || []).some((t) => String(t || '').trim() && namesCoverageAnyForm(t, names) === true)
}

/**
 * Verdetto COMPLESSIVO su più batch di pagine (copertura del fascicolo a
 * chiamate successive, come i gruppi a copertura totale dell'estrazione): una
 * sola chiamata vedeva 7 pagine su 49 e su BOIARDO diceva «non operante» senza
 * aver letto la scheda con la sezione tutela legale. Regole:
 *  - un batch «operante» con prova → ok, PURCHÉ nessun batch PRECEDENTE abbia
 *    detto «non operante» con prova: i batch vanno in ordine di forza (pagine
 *    che nominano la copertura con importi, poi prosa, poi il resto), quindi un
 *    «operante» tardivo che contraddice un «non operante» provato sulle pagine
 *    più forti è un DUBBIO, non un abbinamento (CAMPESTRE: 5 batch «non
 *    operante», poi «operante» sull'elenco delle opzioni del DIP; un riesame
 *    avversario col modello da 7B è stato provato e TOLTO: smentiva anche le
 *    prove vere — «Tutela Legale · Imponibile annuo € 249,06» di BOIARDO);
 *  - un «non operante» provato SOLO in pagine di questionario/proposta
 *    (formEvidence) non fa scattare la contraddizione: il modulo registra una
 *    RICHIESTA, il contratto dice che cosa è stato acquistato (BOLCHINI RC
 *    2025: questionario «no», polizza «operante» → ok). Anche una risposta
 *    barrata sulla riga della copertura: nei questionari RC le righe con
 *    «professionale» e una X sono domande su altro («Richiedete che tali
 *    sub-appaltatori dispongano di una loro polizza per la responsabilità
 *    professionale? ⃝ Sì ⃝ X No», BOLCHINI) e per forma non si distinguono;
 *  - tutti i batch «non operante» con prova (anche da questionario) → mismatch;
 *    lo stesso se alcuni dicono «non operante» con una prova non ritrovata,
 *    purché almeno uno l'abbia provata;
 *  - altrimenti (prove assenti, dubbi, guasti) → review.
 * Il risultato riportato è quello del batch decisivo (l'operante; altrimenti il
 * primo), con `batches` = batch letti.
 * @param {object[]} results  decisioni di decideOperativita, in ordine di batch
 */
export function combineOperativitaBatches(results, { unreadNamed = 0 } = {}) {
  const list = (results || []).filter(Boolean)
  if (!list.length) return decideOperativita({ error: 'nessun batch eseguito' })
  // La presenza della POLIZZA non si decide qui (26/09/2026): la domanda sul
  // contratto ha la sua tabella (decideContract) e si applica DOPO, su
  // qualunque esito (applyContractVerdict). Prima valeva solo su un «operante»
  // (sole quietanze → Accantonata, forzabile: decisione del 22/09, superata).
  const okIdx = list.findIndex((r) => r.verdict === 'ok')
  if (okIdx >= 0) {
    const ok = list[okIdx]
    const earlier = list.slice(0, okIdx)
    const earlierNo = earlier.find((r) => r.verdict === 'mismatch' && !r.formEvidence)
    if (earlierNo) {
      return {
        ...ok, verdict: 'review', batches: list.length,
        reason: `esiti contraddittori tra i batch di pagine: prima «non operante» (${earlierNo.evidenza ? `«${String(earlierNo.evidenza).slice(0, 120)}»` : earlierNo.reason}), poi «operante» (${ok.evidenza ? `«${String(ok.evidenza).slice(0, 120)}»` : ok.reason})`,
      }
    }
    const formNo = earlier.find((r) => r.verdict === 'mismatch' && r.formEvidence)
    if (formNo) return { ...ok, batches: list.length, reason: `${ok.reason} (prima un «non operante» provato solo da un questionario/proposta — una richiesta, non il contratto: ${formNo.evidenza ? `«${String(formNo.evidenza).slice(0, 120)}»` : formNo.reason})` }
    return { ...ok, batches: list.length }
  }
  // Tutti i batch hanno risposto «non operante» e almeno uno con la prova
  // trovata: un batch la cui citazione non si ritrova (troppo corta, «Sezione
  // PA» dalla griglia) NON contraddice gli altri — dice la stessa cosa senza
  // prova. Prima bastava quel batch a mandare in «Da verificare» cinque «non
  // operante» provati (COND. ALZAIA 104, polizza fabbricato Vittoria, 25/09/2026).
  // Un «non determinabile», una risposta illeggibile o un guasto restano dubbi.
  // (solo i «non operante» con la prova NON ritrovata: una prova trovata ma
  // contraddittoria — la riga della copertura con un suo importo — resta dubbio)
  // Regola (a) (decisione dell'utente 26/09/2026): anche un batch «non
  // determinabile» non contraddice un «non operante» provato dal CONTRATTO — è
  // quasi sempre il batch delle pagine meno affini, dove la copertura non c'è
  // (PIZZAMIGLIO BERTOLAZZI/CAMPESTRE/ALZAIA 104, CALDARA 7: 4 su 4 non
  // pertinenti per il catalogo). Serve almeno un «no» provato fuori dai
  // questionari; nessun «operante», nemmeno dubbio. Il «no» non deve stare su
  // una pagina con la riga «copertura + premio/casella» (structuralPage): lì
  // premio e casella sono i segni dell'acquisto e un «no» è più probabilmente
  // una lettura sbagliata (BESA-110: DAS OneClick, «non operante» citando
  // l'intestazione della scheda col premio € 18,67) — con un batch «non
  // determinabile» dopo, la regola (a) l'avrebbe scartata.
  const contractNo = list.some((r) => r.verdict === 'mismatch' && !r.formEvidence && !r.structuralPage)
  // …ma non il «non determinabile» di un batch che conteneva pagine ‡ (la scheda
  // col premio): lì la copertura c'è, e il silenzio del modello è un dubbio.
  const nd = (r) => r.verdict === 'review' && r.esito === 'non determinabile' && !r.structuralBatch
  const allSayNo = list.every((r) => r.verdict === 'mismatch' || (r.verdict === 'review' && r.esito === 'non operante' && !r.evidenceFound) || (contractNo && nd(r)))
  if (allSayNo && list.some((r) => r.verdict === 'mismatch') && list.some((r) => r.verdict === 'review')) {
    const proven = list.filter((r) => r.verdict === 'mismatch')
    const first = proven.find((r) => !r.formEvidence) || proven[0]
    if (unreadNamed > 0) return { ...first, verdict: 'review', batches: list.length, reason: `${first.reason} (${list.length} batch letti, ma ${unreadNamed} pagine che nominano la copertura non sono state lette)` }
    const nds = list.filter(nd).length
    return { ...first, batches: list.length, reason: `${first.reason} (${list.length} batch di pagine: ${proven.length} «non operante» con prova${list.length - proven.length - nds ? `, ${list.length - proven.length - nds} con prova non ritrovata` : ''}${nds ? `, ${nds} «non determinabile»` : ''}; nessun «operante»)` }
  }
  if (list.every((r) => r.verdict === 'mismatch')) {
    // «Non operante» vale come scarto solo se TUTTE le pagine che nominano la
    // copertura sono state lette: se ne restano fuori (fascicoli enormi oltre
    // i batch massimi) il verdetto è un dubbio, non uno scarto.
    // Riportato: il primo «no» provato nel CONTRATTO, se c'è (non quello del questionario).
    const first = list.find((r) => !r.formEvidence) || list[0]
    if (unreadNamed > 0) return { ...first, verdict: 'review', batches: list.length, reason: `${first.reason} (${list.length} batch letti, ma ${unreadNamed} pagine che nominano la copertura non sono state lette)` }
    return { ...first, batches: list.length, reason: list.length > 1 ? `${first.reason} (${list.length} batch di pagine, nessuna prova di operatività)` : first.reason }
  }
  const rev = list.find((r) => r.verdict === 'review') || list[0]
  return { ...rev, verdict: 'review', batches: list.length, reason: list.length > 1 ? `${rev.reason} (${list.length} batch di pagine)` : rev.reason }
}

/** Esito in italiano per motivazioni e UI. */
export function operativitaVerdictLabel(verdict) {
  return verdict === 'ok' ? 'abbinato' : verdict === 'mismatch' ? 'non pertinente' : verdict === 'review' ? 'da verificare' : verdict === 'setaside' ? 'non valido' : 'accettato senza controllo'
}
