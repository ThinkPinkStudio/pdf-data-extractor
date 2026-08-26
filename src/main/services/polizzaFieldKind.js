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
export function autoKind(field) {
  if (field == null) return null
  const hasType = field.type != null && String(field.type).trim() !== ''
  if (hasType) {
    const kind = kindFromType(field.type)
    if (kind !== 'text') return kind
  }
  const fromDesc = inferKindFromDescription(field.description)
  if (fromDesc) return fromDesc
  // Label che si auto-descrive come TESTO testuale (per definizione non
  // numerico): lo "0" e i numeri puri qui sono placeholder, non dati.
  const l = `${field.label || ''}`
  const low = ' ' + l.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') + ' '
  // Label che si auto-descrive come un campo NON-numerico (natura testuale/
  // elenco/domanda): lo "0" e i numeri puri qui sono placeholder, non dati.
  // Lista STRETTA: i tipi di campo RC visti nei profili reali senza prefisso
  // TESTO (Tacito Rinnovo, Frazionamento, Esclusioni, Condizioni, Visto
  // leggero, attività, sottolimiti, retroattività, sinistri).
  if (/(frazionamento|esclusioni|condizioni|tacito rinnovo|sottolimiti|estensioni|attivita|professione|retroattivita|sinistri|clausole|visto leggero|garanzie|prestazioni|scoperti|opzioni|elenco)/.test(low)) {
    return 'text'
  }
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