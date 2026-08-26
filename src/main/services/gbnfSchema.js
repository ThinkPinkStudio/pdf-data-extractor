/**
 * Vincoli di formato per l'estrazione polizze (Ollama `format`).
 *
 * Due artefatti, stessa semantica:
 *  - JSON Schema (default): è l'API documentata di Ollama ("format can be json
 *    or a JSON schema"). I `pattern` per date/importi/P.IVA diventano grammar
 *    lato llama.cpp.
 *  - GBNF: equivalente esplicito, utile da ispezionare/testare e inviabile se
 *    `settings.polizzaConstrainedFormat === 'gbnf'`.
 *
 * I campi testuali restano stringa libera: una regex su "attività" o "parametro"
 * è più dannosa che utile. Lo spegnimento è `polizzaConstrainedJson: false`
 * (torna `format: 'json'`). Se Ollama rifiuta lo schema, il chiamante fa
 * fallback a `json`.
 *
 * Modulo PURO — test/gbnfSchema.test.mjs.
 *
 * ─── Fonte del tipo (decisione del task) ─────────────────────────────────────
 * Il tipo del valore di un campo è la fonte di verità ESPLICITA `field.type`
 * (scelta dall'utente nell'editor campi, chiavi canoniche in polizzaFieldKind),
 * con fallback AL PREFISSO della description ("TESTO…", "NUMERO/IMPORTO…",
 * "SÌ/NO", "PERCENTUALE…") e infine id/label. `fieldKind` centralizza la regola.
 */

import { fieldKind } from './polizzaFieldKind.js'

// ─── Classificazione del valore ──────────────────────────────────────────────

/**
 * Che tipo di vincolo applicare al `valore` di un campo.
 *
 * Fonte di verità in ordine:
 * 1. il `type` ESPLICITO del campo, se è un kind FORTE (number/percent/fiscal/
 *    date): vince su qualunque description/id. boolean/enum → stringa libera.
 * 2. `type` esplicito 'text' (o assente) = default storico "debole": per NON
 *    rompere i profili già salvati resta il percorso legacy — description con
 *    prefisso TESTO → testo libero; id/label dei default del gestionale
 *    (massimale/premio/imposta → amount, tasso → rate, codice_fiscale_iva → vat).
 */
export function fieldValueKind(field) {
  if (!field) return 'text'
  const kind = fieldKind(field)
  if (kind === 'number') {
    // NUMERO DOCUMENTO (polizza/proposta/appendice/…): è un IDENTIFICATIVO
    // alfanumerico, NON un importo ("RCM00010027822", "781949596"). Il prefisso
    // description "NUMERO." da solo NON basta per decidere amount: si guarda al
    // blob (id+label+descrizione): se è un "numero documento" → testo libero,
    // altrimenti amount.
    const blob = `${field.id || ''} ${field.label || ''} ${field.description || ''}`
    if (/numero\s+(di\s+|della\s+|delle\s+|del\s+)?(polizz|proposta|preventiv|appendic|contratt|adesion)|n[°.]?\s*(polizz|propost|preventiv|appendic)/i.test(blob)) return 'text'
    return 'amount'
  }
  if (kind === 'percent') return 'rate'
  if (kind === 'fiscal') return 'vat'
  if (kind === 'date') return 'date'
  // boolean ("SÌ/NO") ed enum ("elenco di valori liberi") restano testi liberi:
  // un pattern li costringerebbe a un vocabolario chiuso che non hanno.
  if (kind === 'boolean' || kind === 'enum') return 'text'
  // kind === 'text' (da type 'text', da description "TESTO…", o default):
  // percorso legacy, identico al comportamento pre-esplicito.
  // MAI imporre un numero su un campo che la DESCRIPTION dichiara TESTO
  // (stessa fonte di tipo di isTextualField): nei profili Rivisto (es. "TESTO
  // (SÌ/NO)." per l'imposta, "TESTO (elenco)." per i sinistri) un prefisso
  // "TESTO…" ha la priorità sull'ID numerico (premio/imposta/tasso). Su quei
  // campi anche un ID "…_imposta" o "…_tasso" non deve produrre pattern
  // amount/rate, altrimenti il modello è COSTRETTO a rispondere con un numero
  // (visto sul campo: rcp_imposta → 1,32; rct_tasso → 75,00).
  if (/TESTO/.test(String(field.description || ''))) return 'text'
  const id = String(field.id || '')
  const blob = `${id} ${field.label || ''} ${field.description || ''}`
  if (id === 'codice_fiscale_iva' || /codice_fiscale_iva/.test(id)) return 'vat'
  if (/_tasso$/.test(id) || /\btasso\b/i.test(blob)) return 'rate'
  if (/massimale|premio|imposta|importo|scoperto/.test(id) || /massimale|premio|imposta|importo|scoperto/i.test(field.label || '')) {
    return 'amount'
  }
  return 'text'
}

export const VALUE_PATTERNS = {
  // GG/MM/AAAA — non valida il calendario (31/02 passa): ci pensa normalizeDateValue.
  date: '^(0[1-9]|[12][0-9]|3[01])/(0[1-9]|1[0-2])/[0-9]{4}$',
  // Importo italiano: 4.000.000,00 oppure 1800000 oppure 1.800.000
  amount: '^([0-9]{1,3}(\\.[0-9]{3})+|[0-9]+)(,[0-9]{1,2})?$',
  // P.IVA 11 cifre o CF 16 alfanumerici (il checksum resta a sanitizeFieldValue)
  vat: '^([0-9]{11}|[A-Z0-9]{16})$',
  // Tasso per mille: 2,450 / 0.245
  rate: '^[0-9]+([,.][0-9]+)?$',
}

function stringSchema(kind) {
  const pattern = VALUE_PATTERNS[kind]
  return pattern ? { type: 'string', pattern } : { type: 'string' }
}

function gbnfRuleName(id, i) {
  const s = String(id || `f${i}`).replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z]/.test(s) ? `f_${s}` : `f_n_${s}`
}

// ─── JSON Schema (Ollama `format`) ───────────────────────────────────────────

function entrySchema(kind, { requiredEvidence = false } = {}) {
  const props = {
    valore: {
      anyOf: [
        stringSchema(kind),
        { type: 'null' },
      ],
    },
    evidenza: { type: 'string' },
    documento: { type: 'string' },
    data_validita: {
      anyOf: [
        { type: 'string', pattern: VALUE_PATTERNS.date },
        { type: 'null' },
      ],
    },
  }
  const required = requiredEvidence ? ['valore', 'evidenza'] : ['valore']
  return { type: 'object', properties: props, required, additionalProperties: false }
}

// Schema per-field che il grounding richiede: oltre a valore/evidenza deve
// ammettere la citazione {source:{doc,page,line}} e la confidenza, altrimenti il
// modello non può riferire DOVE ha trovato il valore e verifyGroundedValue scarta
// tutto con "doc undefined". Mantiene i pattern per ciascun kind.
function groundedEntrySchema(kind) {
  const props = {
    valore: {
      anyOf: [
        stringSchema(kind),
        { type: 'null' },
      ],
    },
    source: {
      type: 'object',
      properties: {
        doc: { type: 'integer' },
        page: { type: 'integer' },
        line: { type: 'integer' },
      },
      required: ['doc', 'page'],
      additionalProperties: false,
    },
    confidence: { type: 'number' },
  }
  return { type: 'object', properties: props, required: ['valore'], additionalProperties: false }
}

/**
 * @param {Array<{id:string,label?:string,type?:string,description?:string}>} fields
 * @param {'staged'|'perField'} shape
 */
export function buildJsonSchema(fields, shape = 'staged', opts = {}) {
  const list = Array.isArray(fields) ? fields.filter((f) => f && f.id) : []
  if (shape === 'perField') {
    const kind = fieldValueKind(list[0])
    // {} è la risposta corretta "non trovato". oneOf: oggetto vuoto O entry.
    const entry = opts.grounding === true ? groundedEntrySchema(kind) : entrySchema(kind, { requiredEvidence: true })
    return {
      $schema: 'https://json-schema.org/draft/07/schema#',
      oneOf: [
        { type: 'object', additionalProperties: false, properties: {} },
        entry,
      ],
    }
  }
  const properties = {}
  for (const f of list) properties[f.id] = entrySchema(fieldValueKind(f))
  return {
    $schema: 'https://json-schema.org/draft/07/schema#',
    type: 'object',
    properties,
    additionalProperties: false,
  }
}

// ─── GBNF ────────────────────────────────────────────────────────────────────

const GBNF_COMMON = `
ws ::= [ \\t\\n]*
char ::= [^"\\\\] | "\\\\" (["\\\\/bfnrt] | "u" [0-9a-fA-F]{4})
string ::= "\\"" char* "\\""
date-body ::= ("0" [1-9] | [12] [0-9] | "3" [01]) "/" ("0" [1-9] | "1" [0-2]) "/" [0-9]{4}
date ::= "\\"" date-body "\\""
int-plain ::= [0-9]+
int-grouped ::= [0-9]{1,3} ("." [0-9]{3})+
amount-body ::= (int-grouped | int-plain) ("," [0-9]{1,2})?
amount ::= "\\"" amount-body "\\""
vat ::= "\\"" ([0-9]{11} | [A-Z0-9]{16}) "\\""
rate ::= "\\"" [0-9]+ ([,.] [0-9]+)? "\\""
null ::= "null"
`

function gbnfValoreRhs(kind) {
  if (kind === 'date') return 'date'
  if (kind === 'amount') return 'amount'
  if (kind === 'vat') return 'vat'
  if (kind === 'rate') return 'rate'
  return 'string'
}

function gbnfEntryRule(name, kind) {
  const v = gbnfValoreRhs(kind)
  // Ordine fisso: valore, evidenza opzionale, documento opzionale, data_validita opzionale.
  // Forzare l'ordine aiuta i modelli piccoli; le chiavi extra sono vietate.
  return `${name}_entry ::= "{" ws "\\"valore\\"" ws ":" ws (${v} | null)`
    + ` ("," ws "\\"evidenza\\"" ws ":" ws string)?`
    + ` ("," ws "\\"documento\\"" ws ":" ws string)?`
    + ` ("," ws "\\"data_validita\\"" ws ":" ws (date | null))? ws "}"`
}

export function buildGbnfGrammar(fields, shape = 'staged', opts = {}) {
  const list = Array.isArray(fields) ? fields.filter((f) => f && f.id) : []
  if (shape === 'perField') {
    const kind = fieldValueKind(list[0])
    const v = gbnfValoreRhs(kind)
    if (opts?.grounding === true) {
      // Per-field CON grounding: la risposta deve includere la citazione
      // {source:{doc,page,line}, confidence} per la verifica deterministica.
      return `root ::= "{" ws "}" | "{" ws "\\"valore\\"" ws ":" ws (${v} | null)`
        + ` ("," ws "\\"source\\"" ws ":" ws source-obj)`
        + ` ("," ws "\\"confidence\\"" ws ":" ws number)`
        + ` ws "}"\n`
        + `source-obj ::= "{" ws "\\"doc\\"" ws ":" ws number ws "," ws "\\"page\\"" ws ":" ws number (ws "," ws "\\"line\\"" ws ":" ws number)? ws "}"\n`
        + `number ::= "0" | ([1-9] [0-9]*) | ("-" ("0" | ([1-9] [0-9]*))) (([.,] [0-9]+)?)\n`
        + GBNF_COMMON
    }
    return `root ::= "{" ws "}" | "{" ws "\\"valore\\"" ws ":" ws (${v} | null)`
      + ` ("," ws "\\"evidenza\\"" ws ":" ws string) ws "}"`
      + GBNF_COMMON
  }
  const rules = []
  const alts = []
  list.forEach((f, i) => {
    const name = gbnfRuleName(f.id, i)
    const kind = fieldValueKind(f)
    // Escape minimo dell'id nel letterale JSON (gli id sono uuid o snake_case).
    const lit = JSON.stringify(f.id)
    alts.push(`${name}_kv`)
    rules.push(`${name}_kv ::= ${lit} ws ":" ws ${name}_entry`)
    rules.push(gbnfEntryRule(name, kind))
  })
  const items = alts.length
    ? `root ::= "{" ws items? ws "}"\nitem ::= ${alts.join(' | ')}\nitems ::= item ("," ws item)*`
    : 'root ::= "{" ws "}"'
  return `${items}\n${rules.join('\n')}${GBNF_COMMON}`
}

/**
 * Valore da mettere in `format` della chat Ollama.
 * @returns {'json'|object|string}
 */
export function ollamaFormatFor(fields, shape, settings) {
  if (settings?.polizzaConstrainedJson === false) return 'json'
  const mode = String(settings?.polizzaConstrainedFormat || 'schema').toLowerCase()
  if (mode === 'json') return 'json'
  const list = Array.isArray(fields) ? fields : []
  if (shape !== 'perField' && !list.length) return 'json'
  const grounding = settings?.polizzaGrounding === true
  // Se il per-field gira CON grounding, lo schema per-field deve ammettere la
  // citazione {source:{doc,page,line}, confidence}: il modello deve poter dire
  // DOVE ha trovato il valore, altrimenti verifyGroundedValue scarta tutto.
  if (grounding) {
    if (mode === 'gbnf') return buildGbnfGrammar(list, shape, { grounding })
    return buildJsonSchema(list, shape, { grounding })
  }
  if (mode === 'gbnf') return buildGbnfGrammar(list, shape)
  return buildJsonSchema(list, shape)
}
