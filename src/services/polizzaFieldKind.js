/**
 * Tipo dei campi polizza: fonte di verità ESPLICITA (scelta dall'utente
 * nell'editor campi) con fallback al prefisso della description.
 *
 * Fino a oggi il tipo di un campo (numerico/testuale/percentuale/data/fiscale)
 * veniva INFERITO dal motore in due modi fragili: prefisso della `description`
 * (es. "TESTO …", "NUMERO/IMPORTO …") per gbnfSchema.js e polizzaValidation.js,
 * o id/label in `fieldValueKind`. La Field ha un `type?: string` dal default
 * 'text' ma non è mai stato scelto dall'utente né usato come fonte di verità.
 *
 * Ora `type` è ESPLICITO e scegliibile nell'interfaccia; questo modulo è il
 * punto unico di normalizzazione: le chiavi canoniche qui sotto. Modulo PURO —
 * test/polizzaFieldKind.test.mjs.
 *
 * NB: NESSUNA chiave 'auto' qui: "auto" è solo l'opzione vuota del select in
 * PolizzaFieldsEditor (nessun type → il motore ricade sul prefisso description).
 */

// ─── Chiavi canoniche ─────────────────────────────────────────────────────────

export const FIELD_KINDS = [
  'text',
  'number',
  'percent',
  'date',
  'fiscal',
  'boolean',
  'enum',
]

/** Set per membership rapida. */
const FIELD_KIND_SET = new Set(FIELD_KINDS)

/**
 * Normalizza un valore `type` libero verso la chiave canonica.
 * - chiavi canoniche (e loro alias storici/inglesi, case-insensitive) passano;
 * - stringhe senza senso → fallback 'text' (il default storico del motore).
 */
export function kindFromType(type) {
  const t = String(type ?? '').trim().toLowerCase()
  if (!t) return 'text'
  if (FIELD_KIND_SET.has(t)) return t
  // Aliases (chiavi storiche di settingsService/gbnfSchema e varianti comuni).
  if (t === 'string' || t === 'testo' || t === 'parola') return 'text'
  if (t === 'amount' || t === 'importo' || t === 'currency' || t === 'money') return 'number'
  if (t === 'rate' || t === 'percentage' || t === 'percentuale' || t === 'tasso') return 'percent'
  if (t === 'vat' || t === 'cf' || t === 'p.iva' || t === 'piva' || t === 'partitaiva') return 'fiscal'
  if (t === 'bool' || t === 'boolean' || t === 'sino' || t === 'si' || t === 'no') return 'boolean'
  if (t === 'list' || t === 'elenco' || t === 'choices') return 'enum'
  return 'text'
}

/**
 * Riconosce i prefissi esistenti della description e li mappa alle chiavi
 * canoniche. Il prefisso deve stare ALL'INIZIO della stringa: "TESTO. …",
 * "NUMERO/IMPORTO (euro)…", "SÌ/NO", "PERCENTUALE…" contano; una frase che
 * contiene solo "testo" a metà NON conta (il prefisso deve essere seguito da
 * separatore o terminare la stringa). Modulo PURO, nessun side-effect.
 */
export function inferKindFromDescription(description) {
  const d = String(description ?? '').trim()
  if (!d) return null

  // Prefissi, dal più specifico al più generico (il primo match vince): così
  // "NUMERO/IMPORTO" batte "NUMERO", "TESTO (SÌ/NO)" batte "TESTO", "SÌ/NO"
  // batte "SÌ" e "PERCENTUALE" batte "PERCENT".
  const PREFIXES = [
    // percentuale (prima di PERCENT, di cui è superstringa)
    ['PERCENTUALE (IMPORTO', 'percent'],
    ['PERCENTUALE/IMPORTO/QUOTA', 'percent'],
    ['PERCENTUALE/IMPORTO/NUMERO', 'percent'],
    ['PERCENTUALE-IMPORTO', 'percent'],
    ['PERCENTUALE O IMPORTO', 'percent'],
    ['PERCENTUALE/TASSO', 'percent'],
    ['PERCENTUALE/IMPORTO', 'percent'],
    ['PERCENTUALE', 'percent'],
    ['PERCENT DI', 'percent'],
    ['PERCENTUALE(', 'percent'],
    ['PERCENTUALE ', 'percent'],
    ['PERCENTUALE-', 'percent'],
    ['PERCENTUALE.', 'percent'],
    ['PERCENT', 'percent'],
    ['PERCENT ', 'percent'],
    ['PERCENT-', 'percent'],
    ['PERCENT(', 'percent'],
    ['PERCENT.', 'percent'],
    ['TASSO', 'percent'],
    ['TASSO ', 'percent'],
    ['TASSO-', 'percent'],
    ['TASSO.', 'percent'],
    ['TASSO(', 'percent'],
    // fiscale
    ['FISCALE/P.IVA', 'fiscal'],
    ['FISCALE/CF', 'fiscal'],
    ['FISCALE', 'fiscal'],
    ['FISCALE ', 'fiscal'],
    ['FISCALE-', 'fiscal'],
    ['FISCALE.', 'fiscal'],
    ['FISCALE(', 'fiscal'],
    ['CODICE FISCALE/P.IVA', 'fiscal'],
    ['CODICE FISCALE', 'fiscal'],
    ['CODICE FISCALE ', 'fiscal'],
    ['CODICE FISCALE-', 'fiscal'],
    ['CODICE FISCALE.', 'fiscal'],
    ['CODICE FISCALE(', 'fiscal'],
    ['CF/P.IVA', 'fiscal'],
    ['CF', 'fiscal'],
    ['CF ', 'fiscal'],
    ['CF-', 'fiscal'],
    ['CF.', 'fiscal'],
    ['CF(', 'fiscal'],
    ['P.IVA/CF', 'fiscal'],
    ['P.IVA', 'fiscal'],
    ['P.IVA ', 'fiscal'],
    ['P.IVA-', 'fiscal'],
    ['P.IVA.', 'fiscal'],
    ['P.IVA(', 'fiscal'],
    ['PIVA', 'fiscal'],
    ['PIVA ', 'fiscal'],
    ['PIVA-', 'fiscal'],
    ['PIVA.', 'fiscal'],
    ['PIVA(', 'fiscal'],
    ['PARTITA IVA', 'fiscal'],
    ['PARTITA IVA ', 'fiscal'],
    ['PARTITA IVA-', 'fiscal'],
    ['PARTITA IVA.', 'fiscal'],
    ['CODICE', 'fiscal'],
    ['CODICE ', 'fiscal'],
    ['CODICE-', 'fiscal'],
    ['CODICE.', 'fiscal'],
    ['CODICE(', 'fiscal'],
    // booleano (SÌ/NO prima di SÌ/SI)
    ['BOOLEANO (SÌ/NO)', 'boolean'],
    ['BOOLEANO (SI/NO)', 'boolean'],
    ['BOOLEANO', 'boolean'],
    ['BOOLEANO ', 'boolean'],
    ['BOOLEANO-', 'boolean'],
    ['BOOLEANO.', 'boolean'],
    ['BOOLEANO(', 'boolean'],
    ['BOOLEAN', 'boolean'],
    ['BOOLEAN ', 'boolean'],
    ['SI/NO', 'boolean'],
    ['SÌ/NO', 'boolean'],
    ['SÌ O NO', 'boolean'],
    ['SI O NO', 'boolean'],
    ['SÌNO', 'boolean'],
    ['SINO', 'boolean'],
    ['SÌ', 'boolean'],
    ['SÌ ', 'boolean'],
    ['SÌ-', 'boolean'],
    ['SÌ.', 'boolean'],
    ['SÌ(', 'boolean'],
    ['SI', 'boolean'],
    ['SI ', 'boolean'],
    ['SI-', 'boolean'],
    ['SI.', 'boolean'],
    ['SI(', 'boolean'],
    ['NO', 'boolean'],
    ['NO ', 'boolean'],
    ['NO-', 'boolean'],
    ['NO.', 'boolean'],
    ['NO(', 'boolean'],
    // elenco
    ['ELENCO', 'enum'],
    ['ELENCO ', 'enum'],
    ['ELENCO-', 'enum'],
    ['ELENCO.', 'enum'],
    ['ELENCO(', 'enum'],
    ['DATI', 'enum'],
    ['DATI ', 'enum'],
    ['DATI-', 'enum'],
    ['DATI.', 'enum'],
    ['DATI(', 'enum'],
    // data
    ['DATA VALIDITÀ', 'date'],
    ['DATA VALIDITA', 'date'],
    ['DATA DI', 'date'],
    ['DATA DI ', 'date'],
    ['DATA INIZIO', 'date'],
    ['DATA FINE', 'date'],
    ['DATA DECORRENZA', 'date'],
    ['DATA SCADENZA', 'date'],
    ['DATA EMISSIONE', 'date'],
    ['DATA PERIODO', 'date'],
    ['DATA/PERIODO', 'date'],
    ['DATA-', 'date'],
    ['DATA.', 'date'],
    ['DATA(', 'date'],
    ['DATA ', 'date'],
    // numero/importo (NUMERO prima di IMPORTO: nessuno dei due è superstringa
    // dell'altro, ma l'ordine è indifferente per i casi reali)
    ['NUMERO/IMPORTO', 'number'],
    ['NUMERO/IMPORTO ', 'number'],
    ['NUMERO/IMPORTO-', 'number'],
    ['NUMERO/IMPORTO.', 'number'],
    ['NUMERO/IMPORTO(', 'number'],
    ['NUMERO', 'number'],
    ['NUMERO ', 'number'],
    ['NUMERO-', 'number'],
    ['NUMERO.', 'number'],
    ['NUMERO(', 'number'],
    ['IMPORTO', 'number'],
    ['IMPORTO ', 'number'],
    ['IMPORTO-', 'number'],
    ['IMPORTO.', 'number'],
    ['IMPORTO(', 'number'],
    ['CIFRA', 'number'],
    ['CIFRA ', 'number'],
    ['CIFRA-', 'number'],
    ['CIFRA.', 'number'],
    ['CIFRA(', 'number'],
    // testo: TESTO (elenco)→enum e TESTO (SÌ/NO)→boolean PRIMA del TESTO generico
    ['TESTO (ELENCO', 'enum'],
    ['TESTO(ELENCO', 'enum'],
    ['TESTO ELENCO', 'enum'],
    ['TESTO (SÌ/NO)', 'boolean'],
    ['TESTO (SI/NO)', 'boolean'],
    ['TESTO(SÌ/NO)', 'boolean'],
    ['TESTO(SI/NO)', 'boolean'],
    ['TESTO (SÌ O NO)', 'boolean'],
    ['TESTO (SÌ', 'boolean'],
    ['TESTO (SI', 'boolean'],
    ['TESTO SÌ', 'boolean'],
    ['TESTO SI', 'boolean'],
    ['TESTO', 'text'],
    ['TESTO ', 'text'],
    ['TESTO-', 'text'],
    ['TESTO.', 'text'],
    ['TESTO(', 'text'],
    ['TESTO/', 'text'],
    ['TESTO:', 'text'],
    ['TESTO;', 'text'],
  ]
  const upper = d.toUpperCase()
  for (const [pre, kind] of PREFIXES) {
    if (upper.startsWith(pre)) return kind
  }
  return null
}

/**
 * Auto-kind di un campo quando l'utente NON ha scelto type esplicito né ha
 * scritto il prefisso description classico. È il fallback "best effort" che
 * rende MONOTONI i guardrail anti-0/anti-numero anche sui profili che non
 * dichiarano il tipo (fascicolo A/B: i campi TED erano type 'text' di default
 * e i valori numerici scalavano via sniffati, ma lo "0" restava).
 *
 * Ordine (il primo match vince):
 *   1. type esplicito FORTE (number/percent/date/fiscal/boolean/enum) → quello;
 *   2. prefisso della description (inferKindFromDescription);
 *   3. label che si auto-descrive (RIPETIZIONE di un termine tipo Frazionamento,
 *      Esclusioni, Condizioni, Tacito Rinnovo) → text SCARTA-numeri;
 *   4. altrimenti null (nessun giudizio: i guardrail testuali restano inerti).
 *
 * Ritorna una chiave canonica di FIELD_KINDS o null. MAI 'text' a default pieno:
 * 'text' di default lascerebbe i numeri passare sui campi di anagrafica.
 */
/**
 * La descrizione pone una DOMANDA di verifica ("Verifica se sono coperti…",
 * "Indica se è previsto…"): la risposta è un giudizio Sì/No che non compare
 * letteralmente nel testo. Per questi campi l'unica prova possibile è la
 * citazione ("evidenza") della clausola: lo schema la rende OBBLIGATORIA e il
 * controllo di evidenza la pretende nel testo. Decide la descrizione.
 */
export function descriptionAsksVerification(description) {
  const dlow = String(description || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return /^(?:verifica|indica|specifica|controlla|dichiara|riporta)\s+se\b/.test(dlow)
}

/**
 * Risposte AMMESSE da una descrizione di VERIFICA ("Verifica se…"): le parole
 * singole citate tra virgolette ('Sì', 'No', 'presente', 'escluso'), nell'ordine
 * e nella grafia della descrizione; vuoto (null) è sempre ammesso. Lista vuota
 * se la descrizione non pone una verifica o non cita risposte. Solo parole di
 * 2-12 lettere: gli apostrofi del testo ("oggetto dell'assicurazione") non
 * sono citazioni.
 */
export function verificationAnswers(description) {
  if (!descriptionAsksVerification(description)) return []
  const out = []
  const seen = new Set()
  for (const m of String(description || '').matchAll(/['"«]([A-Za-zÀ-ÿ]{2,12})['"»]/g)) {
    const k = m[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (seen.has(k)) continue
    seen.add(k); out.push(m[1])
  }
  return out
}

/** Grafia canonica (della descrizione) di una risposta di verifica, o null se non ammessa. */
export function canonicalVerificationAnswer(description, value) {
  const answers = verificationAnswers(description)
  if (!answers.length) return undefined
  const k = String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return answers.find((a) => a.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === k) || null
}

// ─── OGGETTO di una verifica: la citazione deve NOMINARE ciò che si verifica ──
// Analisi errori 25/09/2026 (rcp-pilato/saporiti/cresta, spallino-rc): in una
// chiamata con dieci campi "Verifica se…" il modello rispondeva "Sì"/"presente"
// a quasi tutti citando una frase VERA ma d'altro ("B. Consulenza Fiscale …"
// per il visto leggero, "è compreso l'incarico di Curatore…" per sindaco/
// revisore, "a) attività di rappresentanza e difesa…" per la progettazione, "La
// presente Estensione…" per il visto leggero). Il controllo di evidenza
// pretendeva solo che la citazione esistesse nel testo. Ora la citazione deve
// anche NOMINARE l'oggetto della verifica, letto dalla TESTA della descrizione
// (lo stesso principio dell'operatività: «la prova deve nominare la
// copertura»). Tutto viene dalle descrizioni del profilo: niente label, niente
// liste di dominio, nessuna soglia. Le parole vuote qui sotto sono GRAMMATICA
// (articoli, preposizioni, congiunzioni, i predicati della domanda "se sono
// coperti / è presente / risultano dichiarati"), mai nomi di garanzie.

const stripAccentsLow = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

// Articoli determinativi: la parte utile di un'alternativa comincia DOPO
// l'ultimo ("la polizza comprende la garanzia visto leggero" → "garanzia visto
// leggero"; "sono coperti gli incarichi di sindaco" → "incarichi di sindaco").
const OBJECT_ARTICLES = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'l'])
// Predicati della DOMANDA di verifica: anche loro chiudono il preambolo
// ("nella proposta risultano DICHIARATI sinistri" → "sinistri"; "presente
// garanzia Tutela" → "garanzia Tutela"). "è" resta accentato: la congiunzione
// "e" ("rappresentanza e difesa") non taglia nulla.
const OBJECT_PREDICATES = new Set([
  '\u00e8', 'sono', 'sia', 'siano', 'risulta', 'risultano', 'comprende', 'comprendono', 'include', 'includono',
  'prevede', 'prevedono', 'presente', 'presenti', 'previsto', 'prevista', 'previsti', 'previste',
  'coperto', 'coperta', 'coperti', 'coperte', 'compreso', 'compresa', 'compresi', 'comprese',
  'incluso', 'inclusa', 'inclusi', 'incluse', 'dichiarato', 'dichiarata', 'dichiarati', 'dichiarate',
  'espressamente', 'operante', 'operanti', 'attivo', 'attiva', 'attivi', 'attive',
])
// Parole grammaticali: preposizioni (semplici e articolate), congiunzioni,
// negazione, determinanti. Mai parole di dominio.
const OBJECT_STOP = new Set([
  'il', 'lo', 'la', 'i', 'gli', 'le', 'l', 'un', 'una', 'uno', 'di', 'd', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra',
  'del', 'dello', 'della', 'dei', 'degli', 'delle', 'dell', 'al', 'allo', 'alla', 'ai', 'agli', 'alle', 'all',
  'dal', 'dallo', 'dalla', 'dai', 'dagli', 'dalle', 'dall', 'nel', 'nello', 'nella', 'nei', 'negli', 'nelle', 'nell',
  'sul', 'sullo', 'sulla', 'sui', 'sugli', 'sulle', 'sull', 'col', 'coi', 'e', 'ed', 'o', 'od', 'oppure', 'se', 'che',
  'cui', 'non', 'ne', 'anche', 'altri', 'altre', 'altro', 'altra', 'ogni', 'eventuali', 'eventuale', 'ex', 'dinanzi',
  'verifica', 'indica', 'specifica', 'controlla', 'dichiara', 'riporta', 'es',
])
const VERIFY_PREFIX_RE = /^\s*(?:verifica|indica|specifica|controlla|dichiara|riporta)\s+se\b\s*/i
// Riferimento normativo "NNN/AAAA" col suo eventuale prefisso ("ex D.Lgs.
// 231/2001", "Legge n. 109/1994"): un'alternativa a sé, confrontata per
// numero (anche "163/06" per "163/2006"), mai spezzata dai punti di "D.Lgs.".
const LEGAL_CODE_RE = /(?:\b(?:ex\s+)?(?:d\.?\s*lgs\.?|d\.?\s*m\.?|d\.?\s*p\.?\s*r\.?|legge|l\.|art\.?)\s*(?:n\.?\s*)?)?(?<![\d/])(\d{1,4})\s*\/\s*(\d{4}|\d{2})(?![\d/])/gi

/**
 * RADICE di una parola per il confronto citazione↔oggetto: minuscole senza
 * accenti, via l'ultima vocale (flessione: sindaco/sindaci, perdita/perdite),
 * poi le prime 6 lettere — la stessa radice di headerLex. Regge anche i
 * derivati: "Attività di progettista" nomina la progettazione (GUFFANTI RC:
 * Art. 1 Oggetto), "Coordinatore" il coordinamento. Le parole corte restano
 * intere: "enti" non è "documenti" (confronto per PAROLA intera).
 */
export function objectRadix(word) {
  return stripAccentsLow(word).replace(/[aeiou]$/, '').slice(0, 6)
}

/**
 * TESTA di una descrizione: fino ai due punti, o alla fine di una FRASE (punto
 * o punto e virgola seguiti da spazio e MAIUSCOLA), fuori dalle parentesi. Le
 * abbreviazioni ("ex D.Lgs. 231/2001", "es.", "n.", "art.", "ARCH. MARGHERITA"
 * tra parentesi) non la chiudono: col taglio a ogni punto l'oggetto dell'ODV
 * finiva a "ex D" e "consigliere di amministrazione" spariva.
 */
export function descriptionHeadText(description) {
  const d = String(description || '')
  let depth = 0
  for (let i = 0; i < d.length; i++) {
    const c = d[i]
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0) {
      if (c === ':') return d.slice(0, i).trim()
      if ((c === '.' || c === ';') && /^\s+\p{Lu}/u.test(d.slice(i + 1, i + 12))) return d.slice(0, i).trim()
    }
  }
  return d.replace(/[\s.;]+$/, '').trim()
}

// Parole (minuscole, accenti conservati per riconoscere "è") di un testo; le
// elisioni si staccano: "dall'autorità" → dall, autorità; "d'ufficio" → d, ufficio.
function objectTokens(text) {
  return String(text || '').toLowerCase().replace(/[\u2019'`\u00b4]/g, ' ').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}
const isObjectContent = (t) => {
  const a = stripAccentsLow(t)
  return a.length > 1 && !/^\d+$/.test(a) && !OBJECT_STOP.has(a) && !OBJECT_PREDICATES.has(t) && !OBJECT_PREDICATES.has(a)
}
// Parole di contenuto dopo il preambolo (ultimo articolo o predicato seguito da
// almeno una parola di contenuto).
function objectWords(text) {
  const toks = objectTokens(text)
  let cut = -1
  for (let i = 0; i < toks.length; i++) {
    if ((OBJECT_ARTICLES.has(toks[i]) || OBJECT_PREDICATES.has(toks[i])) && toks.slice(i + 1).some(isObjectContent)) cut = i
  }
  return toks.slice(cut + 1).filter(isObjectContent).map(stripAccentsLow)
}
// Parentesi di primo livello: ogni voce tra parentesi è un'alternativa a sé
// ("(ex Legge Merloni 109/1994, D.Lgs. 163/2006, 50/2016 o 36/2023)").
function splitTopLevelParens(text) {
  let depth = 0, outside = '', cur = ''
  const inside = []
  for (const c of String(text || '')) {
    if (c === '(') { if (depth === 0) { cur = ''; outside += ', ' } else cur += c; depth++; continue }
    if (c === ')' && depth > 0) { depth--; if (depth === 0) { inside.push(cur); continue } }
    if (depth > 0) cur += c
    else outside += c
  }
  if (depth > 0 && cur) inside.push(cur)
  return [outside, ...inside]
}
// "amministratore di società/enti": la barra tra parole CORTE resta dentro la
// frase (due varianti), mai un'alternativa nuda "enti" che starebbe ovunque.
function expandInnerSlashes(text) {
  const m = String(text).match(/(\p{L}+)\s*\/\s*(\p{L}+)/u)
  if (!m) return [text]
  const head = text.slice(0, m.index), tail = text.slice(m.index + m[0].length)
  return [...expandInnerSlashes(head + m[1] + tail), ...expandInnerSlashes(head + m[2] + tail)]
}
// Alternative (testi) di una porzione di testa: separatori ',', ';', ' o ',
// ' od ', ' oppure ', ' e/o ' e la barra SOLO tra parole di almeno 5 lettere
// ("visto leggero / assistenza fiscale"). I riferimenti normativi escono prima.
function splitObjectAlternatives(text, codes) {
  const withoutCodes = String(text || '').replace(LEGAL_CODE_RE, (all, num, year) => { codes.push({ num, year }); return ', ' })
  return withoutCodes
    .split(/[,;]|\s+(?:o|od|oppure|e\/o)\s+|(?<=\p{L}{5})\s*\/\s*(?=\p{L}{5})/iu)
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap(expandInnerSlashes)
}
/**
 * Parte POSITIVA della descrizione: senza le clausole "NON è…", "non
 * confondere…", "mai…", "né…". Le parole citate per contrasto non dicono cosa
 * il campo È (stessa regola di descriptionAllowsRunningText). Era una funzione
 * interna del motore a stadi (somiglianza lessicale); ora serve anche ai
 * vincoli di formato e alle guardie del sanitizer, che non devono leggere né
 * la label né le negazioni.
 */
export function positiveDescriptionText(desc) {
  return String(desc || '')
    .replace(/(?:^|[.;:!?]\s*|\(|,\s*)\s*(?:NON|non)\s+(?:\u00e8|e'|e\b|sono|confonder\w*|considerar\w*|riportar\w*|prender\w*|usar\w*|dedur\w*|copiar\w*)[^.;!?)]*/g, ' ')
    .replace(/(?:^|[.;:!?]\s*)\s*(?:MAI|mai|n\u00e9|ne')\s+[^.;!?]*/g, ' ')
}
const positiveDescription = positiveDescriptionText
// ESEMPI citati nella parte positiva ("(cita la frase, es. 'rappresentanza e
// difesa dinanzi all'autorità giudiziaria', 'perizie giudiziali')", "(es.
// 'Perdita di documenti')"): sono i modi in cui il testo nomina l'oggetto.
// Una citazione chiude solo con la virgoletta seguita da spazio/punteggiatura:
// l'apostrofo di "all'autorità" non la chiude.
function quotedObjectExamples(description) {
  const answers = new Set(verificationAnswers(description).map(stripAccentsLow))
  const out = []
  const QUOTE = /['"\u00ab\u2018]([^"\u00ab\u00bb]{2,120}?)['"\u00bb\u2019](?=[\s,.;:)]|$)/g
  for (const m of positiveDescription(description).matchAll(/\bes\.\s*((?:['"\u00ab\u2018][^"\u00ab\u00bb]{2,120}?['"\u00bb\u2019](?=[\s,.;:)]|$)[\s,]*(?:(?:o|oppure)\s+)?)+)/gi)) {
    for (const q of m[1].matchAll(QUOTE)) if (!answers.has(stripAccentsLow(q[1]).trim())) out.push(q[1])
  }
  return out
}
// Forma di una parola per la FREQUENZA DOCUMENTALE e la parentela tra teste:
// solo senza l'ultima vocale, più fine della radice di confronto (a 6 lettere
// "custode" e "custodia" coinciderebbero e il custode giudiziario sembrerebbe
// una parola generica perché un'altra testa parla di custodia di documenti).
const dfForm = (w) => stripAccentsLow(w).replace(/[aeiou]$/, '')
// Parole di contenuto della testa di un campo, senza gli esempi "(es. …)": un
// esempio di un altro campo ("asseverazioni Superbonus" tra le esclusioni) non
// rende generica una parola dell'oggetto.
function headFormSeq(field) {
  const head = descriptionHeadText(field?.description).replace(/\(\s*es\.[^)]*\)/gi, ' ')
  return objectTokens(head).filter(isObjectContent).map(dfForm)
}
const containsRun = (seq, run) => {
  if (!run.length || run.length > seq.length) return false
  for (let i = 0; i + run.length <= seq.length; i++) if (run.every((r, k) => seq[i + k] === r)) return true
  return false
}

/**
 * ALTERNATIVE che nominano l'oggetto di un campo di VERIFICA, lette dalla
 * TESTA della descrizione ("Verifica se … :") più gli esempi citati nella parte
 * positiva. Ogni alternativa è { words, radix } (tutte le parole devono stare
 * nella citazione) oppure { code, num, year } (riferimento normativo).
 *
 * Parole NON identificative, per FREQUENZA DOCUMENTALE su TUTTE le teste del
 * profilo: una parola di TESTA di alternativa che compare anche nella testa di
 * un altro campo è un nome generico ("garanzia", "incarichi", "attività",
 * "copertura") e non diventa obbligatoria; si toglie solo in TESTA
 * all'alternativa e mai l'ultima parola, così i qualificatori restano
 * ("assistenza FISCALE", "direzione LAVORI", e "sinistri" per la verifica dei
 * sinistri anche se il massimale "per sinistro" la usa). Le teste che
 * ripetono una delle frasi dell'oggetto ("Massimale specifico della garanzia
 * visto leggero / assistenza fiscale…") parlano della STESSA cosa: non contano.
 *
 * @param {object} field
 * @param {object[]} profileFields tutti i campi del profilo
 * @returns {Array<{words:string[],radix:string[]}|{code:string,num:string,year:string}>} [] se il campo non è una verifica
 */
export function verificationObjectPhrases(field, profileFields = []) {
  const desc = String(field?.description || '')
  if (!descriptionAsksVerification(desc)) return []
  const head = descriptionHeadText(desc).replace(VERIFY_PREFIX_RE, '')
  const codes = []
  const texts = []
  for (const part of splitTopLevelParens(head)) texts.push(...splitObjectAlternatives(part, codes))
  for (const ex of quotedObjectExamples(desc)) texts.push(...splitObjectAlternatives(ex, codes))
  const alts = []
  const seen = new Set()
  for (const t of texts) {
    const words = objectWords(t)
    if (!words.length) continue
    const key = words.join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    alts.push({ words, forms: words.map(dfForm) })
  }
  // Frequenza documentale: teste degli ALTRI campi, tolte quelle "parenti"
  // (contengono per intero una frase di più parole dell'oggetto).
  const multi = alts.filter((a) => a.forms.length >= 2)
  const others = new Set()
  for (const g of profileFields || []) {
    if (!g || g === field || (field?.id != null && g.id === field.id)) continue
    const seq = headFormSeq(g)
    if (multi.some((a) => containsRun(seq, a.forms))) continue
    for (const r of seq) others.add(r)
  }
  const out = []
  const seenOut = new Set()
  for (const a of alts) {
    let k = 0
    while (k < a.forms.length - 1 && others.has(a.forms[k])) k++
    const words = a.words.slice(k), radix = words.map(objectRadix)
    const key = radix.join(' ')
    if (seenOut.has(key)) continue
    seenOut.add(key)
    out.push({ words, radix })
  }
  const seenCode = new Set()
  for (const c of codes) {
    const key = `${c.num}/${c.year}`
    if (seenCode.has(key)) continue
    seenCode.add(key)
    out.push({ code: key, num: c.num, year: c.year })
  }
  return out
}

/**
 * true se la citazione NOMINA l'oggetto: contiene tutte le parole (per radice,
 * a parola intera) di almeno un'alternativa, NELL'ORDINE dell'alternativa
 * (altre parole in mezzo ammesse), oppure uno dei riferimenti normativi (anche
 * con le cifre spezzate dal kerning: "D. Lgs. 50 /20 1 6"). L'ordine conta:
 * "La Società si obbliga … nonché Amministratore di sostegno" (RCP PILATO,
 * garanzia C) contiene "società" e "amministratore" ma non nomina
 * l'"amministratore di società/enti" dell'ODV; "funzione di amministratore …
 * di società, aziende" (GUFFANTI, art. 10) sì.
 * Senza alternative (descrizione che non ne dà) il controllo non si applica.
 */
export function evidenceNamesObject(evidenza, phrases) {
  if (!Array.isArray(phrases) || !phrases.length) return true
  const ev = String(evidenza || '')
  if (!ev.trim()) return false
  // Parole spezzate dal kerning del text layer ("P olizza", "L egge",
  // "S inistro"): la maiuscola consonante isolata si riattacca.
  const rejoined = ev.replace(/(?<![\p{L}\p{N}])([B-DF-HJ-NP-TV-Z])\s(?=[a-z]{2,})/gu, '$1')
  const seq = objectTokens(rejoined).map(objectRadix)
  const digitsJoined = ev.replace(/(?<=[\d/])\s+(?=[\d/])/g, '')
  const inOrder = (radix) => {
    let at = 0
    for (const r of radix) {
      const i = seq.indexOf(r, at)
      if (i === -1) return false
      at = i + 1
    }
    return true
  }
  return phrases.some((p) => {
    if (p.code) {
      const years = p.year.length === 4 ? [p.year, p.year.slice(2)] : [p.year, `19${p.year}`, `20${p.year}`]
      return new RegExp(`(?<![\\d/])${p.num}/(?:${years.join('|')})(?![\\d/])`).test(digitsJoined)
    }
    return p.radix.length > 0 && inOrder(p.radix)
  })
}

// ─── Guardie e formato del valore dalla DESCRIZIONE (analisi errori 25/09/2026, F09) ──
// Le guardie del sanitizer e dell'evidenza leggevano id+label+descrizione
// intera: la label guidava l'estrazione (Regola 1) e le clausole negate
// contavano come affermazioni ("NON è … la partita IVA" faceva del N° Polizza
// un campo P.IVA; "…del Massimale per Sinistro" nella descrizione dei
// Sottolimiti ne faceva un importo e il "50%" cadeva). Qui le regole leggono
// SOLO la parte positiva della descrizione, e la sua testa quando conta la
// natura del campo. Nessuna lista di domini: parole di formato e grammatica.

/** Testa POSITIVA della descrizione (descriptionHeadText senza le clausole negate). */
export function positiveDescriptionHead(description) {
  return positiveDescriptionText(descriptionHeadText(description)).replace(/\s+/g, ' ').trim()
}

// "Numero di polizza/proposta/preventivo/appendice/contratto/adesione", "N.
// polizza", "Numero identificativo della polizza" (Tutela Legale 3, type
// 'number': senza la label "N° Polizza" era la sola formula della
// descrizione), "Numero completo della polizza" (CSA RC Professionale):
// l'IDENTIFICATIVO di un documento, alfanumerico, mai un importo. "\bn" e non
// "n": "indicata in polizza" (Attività assicurata di RCT RCO/RCTOP/RCP) non è
// "N. polizza".
const DOCUMENT_NUMBER_RE = /numero\s+(?:\p{L}+\s+)?(?:(?:di|della|delle|del|dello)\s+)?(?:polizz|propost|preventiv|appendic|contratt|adesion)|\bn[°.]?\s*(?:polizz|propost|preventiv|appendic)/giu

/**
 * true se la parte POSITIVA della descrizione chiede il NUMERO di un documento
 * (polizza, proposta, preventivo, appendice, contratto, adesione), fuori dalle
 * clausole negate ("NON il numero di preventivo, proposta o appendice": la
 * negazione senza verbo che positiveDescriptionText non toglie). Prima la
 * stessa regex girava su id+label+descrizione intera: bastava la label, e un
 * "NON è il numero di proposta" rendeva identificativo qualunque campo.
 */
export function descriptionAsksDocumentNumber(description) {
  const pos = positiveDescriptionText(description)
  for (const m of pos.matchAll(DOCUMENT_NUMBER_RE)) if (!clauseIsNegated(pos, m.index)) return true
  return false
}

// Citazione vera (virgoletta aperta dopo spazio/parentesi/virgola/due punti/
// barra e chiusa prima di spazio o punteggiatura): gli apostrofi di
// "l'importo" e "dell'assicurato" non sono citazioni.
const OFFER_QUOTE = String.raw`(?<=^|[\s(,:/])['"«“‘]([^"«»“”]{1,60}?)['"»”’](?=[\s,.;:)!?/]|$)`
const OFFER_QUOTE_RE = new RegExp(OFFER_QUOTE, 'g')
const OFFER_LIST = String.raw`((?:['"«“‘][^"«»“”]{1,60}?['"»”’](?:\s*(?:,|/|\bo\b|\boppure\b)\s*)?)+)`
// Una PAROLA che la grammatica "importo o parola" sa scrivere: lettere, spazi,
// apostrofi, 3-40 caratteri (stessa forma di VALUE_PATTERNS.amountOrWord).
const OFFER_WORD_RE = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' ]{2,39}$/

/**
 * PAROLE che la parte positiva della descrizione offre come RISPOSTA:
 * citate dopo "parola" («oppure la parola "Illimitato"/"ILLIMITATO"»), subito
 * dopo un verbo di risposta («scrivi 'entro il massimale di polizza'»,
 * «restituisci la parola 'NESSUNA'») o in testa a un esempio («(es.
 * 'NESSUNA', 'COME DA SCHEDA TECNICA', oppure un importo)»). Una citazione
 * dopo "accanto a", "nella colonna", "nella riga" è un'ETICHETTA da cercare,
 * non una risposta; "Vuoto se nessun documento lo dichiara" e "e nessuna
 * percentuale" non offrono nulla (RCP SAPORITI: quel "nessuna" apriva le parole
 * libere sullo Scoperto e il modello scriveva "RCO per ogni Sinistro di un
 * importo pari", troncato a 40 lettere dalla grammatica).
 *
 * Due casi in cui una citazione dopo "es." NON è una risposta:
 *  - l'esempio sta in una clausola NEGATA che positiveDescriptionText non
 *    toglie perché non ha il verbo ("NON una sigla o il nome della garanzia
 *    (es. 'RCO', 'R.C.O.')", CSA RCT-RCO): è ciò che il campo NON è;
 *  - la descrizione dà già un esempio NUMERICO del valore e l'esempio citato
 *    non contiene né cifre né "importo": è il nome di una colonna ("la cifra
 *    nella colonna 'PREMIO NETTO' del certificato (es. 'PREMIO NETTO ALLA
 *    FIRMA')", RC PROF MED V2, esempio del valore "(es. 118,90)"). Un esempio
 *    che mette le parole accanto all'importo ("(es. 'NESSUNA', 'COME DA SCHEDA
 *    TECNICA', oppure un importo)") offre davvero le parole.
 */
export function descriptionOfferedWords(description) {
  const pos = positiveDescriptionText(description)
  const out = []
  const collect = (list) => {
    for (const q of String(list || '').matchAll(OFFER_QUOTE_RE)) {
      const w = q[1].trim()
      if (OFFER_WORD_RE.test(w) && !out.includes(w)) out.push(w)
    }
  }
  const numericExample = /\b(?:es\.|esempio)\s*[^)\n]{0,80}?\d/i.test(pos)
  const triggers = [
    [new RegExp(String.raw`\bparol[ae]\s+(?:per\s+intero\s+)?` + OFFER_LIST, 'gi'), false],
    [new RegExp(String.raw`\b(?:scrivi|rispondi|restituisci|riporta|metti)\s+(?:(?:la\s+parola|il\s+testo|la\s+dicitura|solo|soltanto|sempre)\s+)?` + OFFER_LIST, 'gi'), false],
    [new RegExp(String.raw`\bes\.\s*` + OFFER_LIST, 'gi'), true],
  ]
  for (const [re, isExample] of triggers) {
    for (const m of pos.matchAll(re)) {
      if (clauseIsNegated(pos, m.index)) continue
      if (isExample && numericExample) {
        const rest = pos.slice(m.index).match(/^[^)\n]*/)[0]
        if (!/\d|\bimport|\bcifr|\bsomm/i.test(rest)) continue
      }
      collect(' ' + m[1])
    }
  }
  return out
}

// La CLAUSOLA che contiene la posizione `at` (dal ';', dai ':' o dalla fine
// dell'ultima frase — punto seguito da MAIUSCOLA, così "es." e "D.Lgs." non la
// chiudono) è negata: "NON…", "mai…", "né…".
function clauseIsNegated(text, at) {
  const before = String(text || '').slice(0, at)
  let cut = Math.max(before.lastIndexOf(';'), before.lastIndexOf(':'))
  for (const m of before.matchAll(/[.!?]\s+(?=\p{Lu})/gu)) cut = Math.max(cut, m.index)
  return /(?:^|[^\p{L}])(?:non|mai|né)(?=[^\p{L}]|$)/iu.test(before.slice(cut + 1))
}

/**
 * true se un ESEMPIO della parte positiva della descrizione è una
 * PERCENTUALE: "la percentuale di scoperto (es. 10%)", "(es. 'scoperto 10%
 * minimo 5.000')". Il formato del valore lo dichiara la descrizione: la
 * grammatica deve poter scrivere "10%" e il sanitizer non deve buttarlo
 * (prima lo Scoperto base non poteva MAI ricevere il suo 10%: né il pattern
 * degli importi né la guardia sul "%" lo ammettevano).
 */
export function descriptionPercentExample(description) {
  for (const m of positiveDescriptionText(description).matchAll(/\b(?:es\.|esempio)\s*([^)\n]{0,80})/gi)) {
    if (/\d\s?%/.test(m[1])) return true
  }
  return false
}

/**
 * true se la parte positiva della descrizione dichiara un FORMATO NUMERICO:
 * un esempio con cifre ("(es. 3.000.000,00)") o una parola di formato
 * (importo, cifra, somma, euro, numero, percentuale, €, %). Serve quando il
 * tipo "importo" viene SOLO da una parola della testa: "Parametro utilizzato
 * per la regolazione del premio (es. Retribuzioni o Fatturato)" è importo per
 * la parola "premio", ma la descrizione non chiede un numero e la grammatica
 * obbligava il modello a scriverne uno (EULIP: parametro sempre vuoto).
 */
export function descriptionGivesNumericFormat(description) {
  const pos = positiveDescriptionText(description)
  if (/\b(?:es\.|esempio)\s*[^)\n]{0,80}?\d/i.test(pos)) return true
  return /\b(?:importo|importi|cifra|cifre|somma|somme|euro|numero|numeri|numerico|numerica|percentual\w*)\b|€|%/.test(stripAccentsLow(pos))
}

export function autoKind(field) {
  if (field == null) return null
  const hasType = field.type != null && String(field.type).trim() !== ''
  if (hasType) {
    const kind = kindFromType(field.type)
    if (kind !== 'text') return kind
  }
  const fromDesc = inferKindFromDescription(field.description)
  if (fromDesc) return fromDesc
  // Descrizione che pone una DOMANDA ("Verifica se sono coperti…", "Indica se
  // la polizza comprende…"): la risposta è un testo (Sì/No, presente, escluso,
  // una clausola), MAI un importo nudo — salvo che la stessa descrizione chieda
  // di riportare massimali/limiti/importi. Sul GUFFANTI/Saporiti l'imposta
  // 654,40 finiva su sei campi "Verifica se…" perché nessuna regola li
  // riconosceva come testuali (type 'text' non basta: è il default storico).
  const dlow = String(field.description || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (/^(?:verifica|indica|specifica|controlla|dichiara)\s+se\b/.test(dlow) && !/riport\w*\s+(?:i\s+|il\s+|gli\s+|le\s+|l')?(?:massimal|limit|import|somm|valor)/.test(dlow)) {
    return 'text'
  }
  // TESTO per ESEMPI: la descrizione porta esempi "(es. Retribuzioni o
  // Fatturato)" fatti di sole PAROLE (nessuna cifra, e non dice "oppure un
  // importo/numero"): il campo è testuale, un numero puro è il dato sbagliato
  // (EULIP: "Parametro di regolazione" = 0,41, cioè il tasso).
  const exWords = dlow.match(/\(es\.?\s*([^)]*)\)/)
  if (exWords && !/\d/.test(exWords[1]) && /[a-z]{3,}/.test(exWords[1]) && !/import|numer|cifr|somm|valor/.test(exWords[1])) {
    return 'text'
  }
  // NUMERO per DESCRIZIONE: la descrizione parla di un importo/imposta/massimale
  // e porta un esempio numerico "(es. 49,05)" → è un numero, qualunque sia la
  // label. Nel profilo RC V3 i campi etichettati "Frazionamento" e "Tacito
  // Rinnovo" chiedono in realtà premio imponibile e imposte: la lista delle
  // label li marcava TESTO e i loro importi venivano scartati. La descrizione
  // vince sulla label (Regola 1). Una descrizione che dice "come TESTO"/"parola"
  // resta testuale.
  // Esempio numerico anche in ELENCO: "(es. 49,05, 137,67)", "(es. 2.500.000,00,
  // 5.000.000)". Prima serviva un solo numero e con due la regola non scattava:
  // il campo cadeva nella vecchia lista di label e "137,67" veniva scartato.
  if (/\b(importo|cifra|somma|massimale|imposta|imposte|imponibile|franchigia|scoperto|fatturato|capitale|premio\s+(?:lordo|netto|imponibile|totale|annuo))\b/.test(dlow)
      && /\(es\.?\s*[€\s]*\d[\d.,\s€]*\)/.test(dlow)
      && !/\btesto\b|come testo|\bparola\b|si\/no/.test(dlow)) {
    return 'number'
  }
  // [13/09/2026] Tolta la lista di LABEL ("frazionamento", "tacito rinnovo",
  // "esclusioni"…) che marcava il campo come testuale: la label non guida mai
  // l'estrazione (Regola 1) e in RC V3 le label "Frazionamento"/"Tacito
  // Rinnovo" chiedono imponibile e imposte. Decide solo la descrizione.
  return null
}

/**
 * Fonte di verità del tipo di un campo (fallback al prefisso description):
 * 1. `field.type` presente E normalizzabile a un kind FORTE → quel kind;
 * 2. altrimenti il prefisso della description (inferKindFromDescription);
 * 3. altrimenti 'text'.
 *
 * NB: 'text' non è un tipo "forte": type:'text' (o assente) è il DEFAULT
 * STORICO scritto su quasi tutti i campi già salvati senza valore semantico.
 * Per NON rompere quei profili, 'text' esplicito NON prevale sulla description:
 * decide il prefisso (le regole dei guard are on description). L'utente che
 * vuole forzare un campo testuale sceglie 'TESTO' nel select o scrive la
 * description "TESTO…". I kind forti (number/percent/date/fiscal/boolean/enum)
 * invece VINCONO sempre sulla description.
 */
export function fieldKind(field) {
  if (field == null) return 'text'
  const hasType = field.type != null && String(field.type).trim() !== ''
  if (hasType) {
    const kind = kindFromType(field.type)
    if (kind !== 'text') return kind
  }
  const fromDesc = inferKindFromDescription(field.description)
  if (fromDesc) return fromDesc
  return 'text'
}

/**
 * NATURA SEMANTICA di un campo polizza, ricavata SOLO da label+description
 * (type-blind: MAI dall'id, che ora è un UUID casuale senza significato).
 *
 * Ritorna una stringa descrittiva della "grandezza" del campo, usata dai
 * guard-rail e dalle coerenze cross-field per decidere il ruolo di un campo
 * senza leggere il nome dell'id. Valori tipici: 'massimale_sinistro',
 * 'massimale_annuo', 'massimale_persona', 'massimale_danni',
 * 'massimale_prestatore', 'massimale_mat', 'massimale_interr',
 * 'franchigia', 'scoperto', 'premio_totale', 'premio_imponibile',
 * 'imposta', 'tasso', 'parametro', 'importo_preventivo', 'fatturato',
 * 'attivita', 'anagrafica', … oppure null se la natura non è riconoscibile.
 *
 * Le chiavi di ruolo derivano dal VOCABOLO della label/description (massimale/
 * premio/imposta/scoperto/franchigia/… + specificazione), NON dalla forma
 * dell'id. Un campo la cui label/description non esprime una grandezza
 * riconoscibile ritorna null (natura non decidibile → i guard-rail restano
 * inerti).
 */
export function fieldNatura(field) {
  if (field == null) return null
  const descCut = String(field.description || '')
    .split(/\b(?:non\s+confonder\w*|non\s+riutilizz\w*|non\s+deve\w*|non\s+pu[oò]\w*|non\s+[èe]\b|mai\b|evitare\b|es\.|esempi\w*)\b/i)[0]
  const blob = `${String(field.label || '')} ${descCut}`
  const low = ' ' + String(blob).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') + ' '
  const labelLow = ' ' + String(field.label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') + ' '

  // FRANCHIGIA / SCOPERTO: la LABEL è il segnale primario. Un campo la cui
  // label dice "Franchigia"/"Scoperto" è franchigia/scoperto anche se la
  // descrizione cita "massimale" in contrapposizione ("NON il massimale"):
  // la citazione negativa NON deve riclassificarlo come massimale.
  if (/franchig/i.test(labelLow)) return 'franchigia'
  if (/scopert/i.test(labelLow)) return 'scoperto'

  // Massimali: la grandezza specifica vince sul generico "massimale".
  if (low.includes('massimale')) {
    const spec = [
      ['interruzione', 'massimale_interr'],
      ['annuo', 'massimale_annuo'],
      ['per persona', 'massimale_persona'],
      ['persona', 'massimale_persona'],
      ['per prestatore', 'massimale_prestatore'],
      ['prestatore', 'massimale_prestatore'],
      ['danni materiali', 'massimale_danni'],
      // "per sinistro"/"singolo sinistro"/"ogni sinistro" PRIMA del "danni"
      // nudo: una descrizione di un massimale PER SINISTRO può citare i
      // "danni cagionati dagli Assicurati" e NON è un massimale danni.
      ['per sinistro', 'massimale_sinistro'],
      ['singolo sinistro', 'massimale_sinistro'],
      ['ogni sinistro', 'massimale_sinistro'],
      ['danni', 'massimale_danni'],
    ]
    for (const [pat, kind] of spec) {
      if (low.includes(pat)) return kind
    }
    if (/per\s+ogni\s+sinistro/.test(low) || /unico\s+per\s+sinistro/.test(low)) return 'massimale_sinistro'
    return 'massimale'
  }

  // PREMI / IMPOSTA / ATTIVITÀ: la LABEL è il segnale primario.
  // Un campo la cui label dice "Imposte/Imposta" è imposta anche se la
  // descrizione cita il "PREMIO TOTALE" della tabella del premio (GUFFANTI:
  // "Imposte … nella tabella 'PREMIO TOTALE NETTO IMPONIBILE …'"). Allo stesso
  // modo un campo "Premio lordo/totale" resta premio_totale anche se la
  // descrizione cita "imposte". Solo se la label non è parlante si ricade
  // sulla descrizione, e SOLO per i prefissi chiari (mai una citazione di
  // contesto). Questo evita che la presenza delle parole "imposte"/"attività"
  // nella descrizione riclassifichi un campo di natura diversa.
  if (/\bimpost/i.test(labelLow)) return 'imposta'
  if (/premio\s+imponib/i.test(labelLow)) return 'premio_imponibile'
  if (/premio\s+(?:lordo|totale|annuo)/i.test(labelLow)) return 'premio_totale'
  // Descrizione con prefisso ESPLICITO (all'inizio): "PREMIO IMPONIBILE…",
  // "PREMIO LORDO…" → natura premio. Una citazione a metà ("la colonna
  // 'PREMIO TOTALE'") NON è un prefisso e non deve riclassificare.
  if (/^[^.,;:]*premio\s+imponib/i.test(low)) return 'premio_imponibile'
  if (/^[^.,;:]*premio\s+(?:lordo|totale|annuo)/i.test(low)) return 'premio_totale'
  if (/\bimpost/i.test(low)) return 'imposta'
  if (/franchig/i.test(low)) return 'franchigia'
  if (/scopert/i.test(low)) return 'scoperto'
  if (/\btass/i.test(low)) return 'tasso'
  if (/parametro\s+regolaz/i.test(low) || /\bparametro\b/i.test(low)) return 'parametro'
  if (/importo\s+preventiv/i.test(low) || /preventiv/i.test(low)) return 'importo_preventivo'
  if (/fatturat/i.test(low)) return 'fatturato'
  // ATTIVITÀ / BISOGNI: la LABEL è il segnale primario. Un campo la cui label
  // dice "Bisogni assicurativi" NON è "attività" anche se la descrizione
  // elenca "Tutela della propria attività professionale" tra i bisogni
  // (GUFFANTI: campo_j3byrdl). Allo stesso modo una label "Garanzie scelte"
  // non è "attività". La descrizione conta solo per i campi la cui label
  // dichiara esplicitamente l'attività/professione.
  if (/\bbisogn/i.test(labelLow)) return 'bisogni'
  if (/\battivit|professione/i.test(labelLow)) return 'attivita'
  // "attività" con confine di PAROLA: NON deve matchare "Retroattività" né
  // "Data retroattività" (che sono la retroattività, non l'attività assicurata).
  if (/\battivit|professione/i.test(low)) return 'attivita'

  return null
}