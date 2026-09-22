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
  return /(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)|€\s*\d/.test(String(text || ''))
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

/** Casella barrata / spunta su una riga della griglia. */
export function lineHasCheck(line) {
  return /(?:^|\s)(?:\[x\]|\[X\]|☒|☑|✓|✔|X)(?:\s|$)/.test(String(line || ''))
}

/**
 * Riga STRUTTURALE: nomina la copertura E porta un importo o una spunta sulla
 * stessa riga («Tutela Legale  240,00  42,06», «TUTELA LEGALE  Imponibile annuo
 * € 249,06», «Tutela Legale  ESCLUSA  31.000,00»). È ciò che «Come
 * riconoscerla» chiama premio proprio / casella / riepilogo: un'opzione in un
 * elenco («TUTELA LEGALE (opzionale)») non ce l'ha. Nessun valore o soglia:
 * solo la forma della riga.
 */
export function structuralCoverLines(text, nameTokens) {
  if (!Array.isArray(nameTokens) || !nameTokens.length) return null
  return String(text || '').split('\n').filter((l) => namesCoverage(l, nameTokens) && (pageHasAmount(l) || lineHasCheck(l)))
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
 * distintive di «Come riconoscerla», `lexTokens`) E portano importi (scheda
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
  const hasLex = (c) => namesCoverage(c.flat || c.text, lexTokens) === true
  const isStructural = (c) => (structuralCoverLines(c.text, lexTokens) || []).length > 0
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
 * condizioni? Si chiede SOLO dopo un «operante» (cartella di sole quietanze →
 * Accantonata, forzabile: decisione dell'utente del 22/09/2026). Chiamata a
 * parte per non toccare il prompt di operatività, misurato.
 */
export function buildContrattoPrompt({ blocks = [] }) {
  const system = 'Sei un verificatore di polizze assicurative italiane. Rispondi SOLO con un oggetto JSON, senza testo prima o dopo, senza markdown.'
  const pages = blocks.map((b) => `${operativitaPageTag(b.ord, b.page)}\n${b.text}`).join('\n\n')
  const user = [
    'Le pagine qui sotto vengono da un fascicolo assicurativo.',
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

export function contrattoSchema() {
  return {
    $schema: 'https://json-schema.org/draft/07/schema#',
    type: 'object',
    properties: { contratto: { type: 'string', enum: OPERATIVITA_CONTRATTO }, documento: { type: 'string' }, pagina: { type: 'integer' }, motivo: { type: 'string' } },
    required: ['contratto', 'documento', 'pagina', 'motivo'],
    additionalProperties: false,
  }
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
 * @returns {{found:boolean, ord:number|null, page:number|null, where:'citata'|'altra pagina'|null, reason:string}}
 */
export function verifyOperativitaEvidence(answer, blocks, { lexTokens = [] } = {}) {
  const ev = String(answer?.evidenza || '').trim()
  const ne = normForMatch(ev)
  // La prova NOMINA la copertura? (null = nessuna parola distintiva: non giudicabile)
  const names = namesCoverage(ev, lexTokens)
  if (ne.length < OPERATIVITA_MIN_EVIDENCE) return { found: false, names, ord: null, page: null, where: null, reason: ev ? 'prova troppo corta' : 'nessuna prova citata' }
  const tokens = valueTokens(ev).filter((t) => t.length >= 4)
  // Cifre della citazione (importi, numeri di polizza): devono esserci tutte.
  const digitRuns = [...new Set((ne.match(/\d{3,}/g) || []))]
  const matches = (b) => {
    // SOLO il testo che il modello ha visto (b.text, eventualmente tagliato):
    // la pagina intera (flat) conterrebbe righe mai inviate.
    const norm = normForMatch(b.text || '')
    if (!norm) return false
    if (norm.includes(ne)) return true
    // Citazione riscritta: tutti i token (≥4 lettere, almeno 4 di essi, o 3 con
    // cifre) e tutte le cifre nella stessa pagina. Tre parole comuni non bastano.
    if (tokens.length < 3 || (tokens.length < 4 && !digitRuns.length)) return false
    return tokens.every((t) => norm.includes(t)) && digitRuns.every((d) => norm.includes(d))
  }
  // structural: la pagina della prova ha una riga col nome della copertura E un
  // importo/spunta (null = nome non determinabile).
  const struct = (b) => { const l = structuralCoverLines(b.text, lexTokens); return l === null ? null : l.length > 0 }
  const cited = (blocks || []).find((b) => b.ord === answer?.documento && b.page === answer?.pagina)
  if (cited && matches(cited)) return { found: true, names, structural: struct(cited), ord: cited.ord, page: cited.page, where: 'citata', reason: 'prova trovata nella pagina citata' }
  for (const b of blocks || []) {
    if (b === cited) continue
    if (matches(b)) return { found: true, names, structural: struct(b), ord: b.ord, page: b.page, where: 'altra pagina', reason: `prova trovata in Documento ${b.ord} pag. ${b.page}` }
  }
  return { found: false, names, structural: null, ord: null, page: null, where: null, reason: 'prova citata non trovata nel testo inviato' }
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
 * | non operante      | assente | —                 | review   |
 * | non determinabile | —       | —                 | review   |
 * | guasto            | —       | —                 | review   |
 */
export function decideOperativita({ answer, evidence, excludeMatched = [], error = null } = {}) {
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
    if (evidence.names === false) return { ...base, verdict: 'review', reason: `copertura dichiarata operante ma la prova citata è generica: non nomina la copertura${why}` }
    // Prova senza STRUTTURA: nella pagina nessuna riga con la copertura accanto
    // a un importo o a una spunta («TUTELA LEGALE (opzionale)» nell'elenco
    // delle opzioni di un DIP): un'offerta, non un acquisto.
    if (evidence.structural === false) return { ...base, verdict: 'review', reason: `copertura dichiarata operante ma nella pagina della prova nessuna riga la affianca a un premio, importo o spunta${why}` }
    if (excludeMatched.length) return { ...base, verdict: 'review', reason: `elementi contraddittori: parola da evitare «${excludeMatched[0]}» nel testo, ma copertura operante${why}` }
    return { ...base, verdict: 'ok', reason: `copertura operante${why}` }
  }
  if (!evidence?.found) return { ...base, verdict: 'review', reason: `copertura dichiarata non operante ma la prova citata non è nel testo (${evidence?.reason || 'assente'})${why}` }
  return { ...base, verdict: 'mismatch', reason: `copertura non operante${why}` }
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
 *  - tutti i batch «non operante» con prova → mismatch;
 *  - altrimenti (prove assenti, dubbi, guasti) → review.
 * Il risultato riportato è quello del batch decisivo (l'operante; altrimenti il
 * primo), con `batches` = batch letti.
 * @param {object[]} results  decisioni di decideOperativita, in ordine di batch
 */
export function combineOperativitaBatches(results, { unreadNamed = 0 } = {}) {
  const list = (results || []).filter(Boolean)
  if (!list.length) return decideOperativita({ error: 'nessun batch eseguito' })
  const contractSeen = list.some((r) => r.contratto === 'presente')
  const contractAnswers = list.map((r) => r.contratto).filter(Boolean)
  const okIdx = list.findIndex((r) => r.verdict === 'ok')
  if (okIdx >= 0) {
    const ok = list[okIdx]
    const earlierNo = list.slice(0, okIdx).find((r) => r.verdict === 'mismatch')
    if (earlierNo) {
      return {
        ...ok, verdict: 'review', batches: list.length, contratto: contractSeen ? 'presente' : ok.contratto,
        reason: `esiti contraddittori tra i batch di pagine: prima «non operante» (${earlierNo.evidenza ? `«${String(earlierNo.evidenza).slice(0, 120)}»` : earlierNo.reason}), poi «operante» (${ok.evidenza ? `«${String(ok.evidenza).slice(0, 120)}»` : ok.reason})`,
      }
    }
    // SOLE QUIETANZE (decisione dell'utente, 22/09/2026): copertura operante ma
    // nessuna pagina letta è il contratto (frontespizio/scheda/appendice) →
    // ACCANTONATA, bloccata ma forzabile con «Procedi comunque». Il verdetto
    // 'setaside' è mappato da decidePrecheck su mismatch+setAside.
    if (!contractSeen && contractAnswers.length && contractAnswers.every((c) => c === 'assente')) {
      return { ...ok, verdict: 'setaside', batches: list.length, contratto: 'assente', reason: `copertura operante ma senza polizza principale: nelle pagine lette solo quietanze, informativa o condizioni, nessun frontespizio o scheda di polizza${ok.motivo ? ` (${ok.motivo})` : ''}` }
    }
    return { ...ok, batches: list.length, contratto: contractSeen ? 'presente' : ok.contratto }
  }
  if (list.every((r) => r.verdict === 'mismatch')) {
    // «Non operante» vale come scarto solo se TUTTE le pagine che nominano la
    // copertura sono state lette: se ne restano fuori (fascicoli enormi oltre
    // i batch massimi) il verdetto è un dubbio, non uno scarto.
    if (unreadNamed > 0) return { ...list[0], verdict: 'review', batches: list.length, reason: `${list[0].reason} (${list.length} batch letti, ma ${unreadNamed} pagine che nominano la copertura non sono state lette)` }
    return { ...list[0], batches: list.length, reason: list.length > 1 ? `${list[0].reason} (${list.length} batch di pagine, nessuna prova di operatività)` : list[0].reason }
  }
  const rev = list.find((r) => r.verdict === 'review') || list[0]
  return { ...rev, verdict: 'review', batches: list.length, reason: list.length > 1 ? `${rev.reason} (${list.length} batch di pagine)` : rev.reason }
}

/** Esito in italiano per motivazioni e UI. */
export function operativitaVerdictLabel(verdict) {
  return verdict === 'ok' ? 'abbinato' : verdict === 'mismatch' ? 'non pertinente' : verdict === 'review' ? 'da verificare' : verdict === 'setaside' ? 'accantonato' : 'accettato senza controllo'
}
