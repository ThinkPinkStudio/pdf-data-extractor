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
 */

// ─── Classificazione del valore ──────────────────────────────────────────────

/**
 * Che tipo di vincolo applicare al `valore` di un campo.
 * `date` dal type configurato; il resto da id/etichetta (i profili utente
 * rinomano spesso le label, gli id default restano stabili).
 */
export function fieldValueKind(field) {
  if (!field) return 'text'
  if (field.type === 'date') return 'date'
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

/**
 * @param {Array<{id:string,label?:string,type?:string,description?:string}>} fields
 * @param {'staged'|'perField'} shape
 */
export function buildJsonSchema(fields, shape = 'staged') {
  const list = Array.isArray(fields) ? fields.filter((f) => f && f.id) : []
  if (shape === 'perField') {
    const kind = fieldValueKind(list[0])
    // {} è la risposta corretta "non trovato". oneOf: oggetto vuoto O entry.
    return {
      $schema: 'https://json-schema.org/draft/07/schema#',
      oneOf: [
        { type: 'object', additionalProperties: false, properties: {} },
        entrySchema(kind, { requiredEvidence: true }),
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

export function buildGbnfGrammar(fields, shape = 'staged') {
  const list = Array.isArray(fields) ? fields.filter((f) => f && f.id) : []
  if (shape === 'perField') {
    const kind = fieldValueKind(list[0])
    const v = gbnfValoreRhs(kind)
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
  if (mode === 'gbnf') return buildGbnfGrammar(list, shape)
  return buildJsonSchema(list, shape)
}
