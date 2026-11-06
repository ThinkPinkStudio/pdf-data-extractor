// CSA ADESIONI INFORTUNI (06/11/2026) — regole pure della polizza infortuni
// conducenti AIG (collettiva IAH0015716, contraente CSA): campi della maschera
// (= colonne del file «BDX Inclusioni»), opzioni con premi e massimali,
// questionario delle esigenze (4 domande SI/NO), controlli, numerazione
// IAH0015842/001, 002, … Nessun DB, nessun I/O: lo usano le route, le pagine e
// i test (test/infortuniRules.test.mjs).
//
// Ogni numero (premi, imposte, massimali, numero di polizza) viene dalla
// configurazione salvata nelle Impostazioni della sezione; qui ci sono solo i
// valori di partenza, presi dal certificato e dalla tabella «Garanzie e
// massimali» mandati dal cliente.

import { decodeCf, checkPerson, fmtDate } from '../rsm/rules.js'
import { nextIdentificativo } from '../adesioni/numbering.js'

export { fmtDate }

/* ─── Configurazione ───────────────────────────────────────────────────── */

export const DEFAULT_OPTIONS = [
  { key: 'base', name: 'Base', premio: '45,00', imposte: '5,00', morte: '50.000', invalidita: '50.000', franchigia: '3%', speseMediche: '1.000', franchigiaSpese: '100' },
  { key: 'premium', name: 'Premium', premio: '60,00', imposte: '6,67', morte: '50.000', invalidita: '50.000', franchigia: '3%', speseMediche: '2.500', franchigiaSpese: '100' },
  { key: 'top', name: 'Top', premio: '100,00', imposte: '11,11', morte: '100.000', invalidita: '100.000', franchigia: '3%', speseMediche: '3.500', franchigiaSpese: '100' },
]

export function defaultConfig() {
  return {
    // Numero della polizza collettiva sul certificato (≠ numero di adesione).
    polizzaCollettiva: 'IAH0015716',
    options: DEFAULT_OPTIONS.map((o) => ({ ...o })),
    // Il certificato del cliente dice «tramite […]»: da completare in Impostazioni.
    pagamento: '',
    mailTo: '',
    mailCc: '',
    mailSubject: 'CSA Adesioni Infortuni — BDX inclusioni',
  }
}

/** Configurazione salvata completata coi default (campi nuovi, opzioni vuote). */
export function withDefaults(saved) {
  const base = defaultConfig()
  const s = saved && typeof saved === 'object' ? saved : {}
  const options = Array.isArray(s.options) && s.options.length ? s.options : base.options
  return { ...base, ...s, options: options.map((o) => ({ ...DEFAULT_OPTIONS[0], ...o, key: String(o.key || o.name || '').trim().toLowerCase() })) }
}

export const optionOf = (config, key) => (config.options || []).find((o) => o.key === String(key || '').toLowerCase()) || null

/* ─── Campi: le colonne del BDX, nell'ordine del file ──────────────────── */

// `col` è l'intestazione ESATTA del file «BDX Inclusioni CSA» (riga 2).
export const FIELDS = [
  { id: 'numero', col: 'Polizza n°', type: 'auto' },
  { id: 'nome', col: 'Nome Cliente', type: 'text', required: true },
  { id: 'cognome', col: 'Cognome Cliente', type: 'text', required: true },
  { id: 'data_nascita', col: 'Data di nascita ', type: 'date', required: true },
  { id: 'codice_fiscale', col: 'Codice Fiscale', type: 'cf', required: true },
  { id: 'email', col: 'MAIL / PEC CLIENTE', type: 'email', required: true },
  { id: 'targa', col: 'Targa', type: 'text', required: true },
  { id: 'tipo_veicolo', col: 'Tipo Veicolo', type: 'text', required: true },
  { id: 'marca', col: 'Marca', type: 'text', required: true },
  { id: 'modello', col: 'Modello', type: 'text', required: true },
  { id: 'data_adesione', col: 'Data Adesione / Effetto Copertura', type: 'date', required: true },
  { id: 'data_scadenza', col: 'Data scadenza copertura', type: 'date', required: true },
  { id: 'opzione', col: 'Opzione ', type: 'option', required: true },
  { id: 'premio', col: 'Premio Lordo alla firma', type: 'auto' },
  { id: 'note', col: 'NOTE', type: 'text' },
]

export const VEHICLE_TYPES = ['Autovettura', 'Motociclo', 'Ciclomotore', 'Autocarro', 'Camper']

/* ─── Questionario delle richieste ed esigenze (AIG, 4 domande) ────────── */

export const QUESTIONS = [
  { id: 'q1', text: 'Dichiara di essere interessato ad acquistare un prodotto assicurativo che prevede un indennizzo in caso di morte, invalidità permanente, rimborso spese mediche a seguito di infortunio automobilistico?' },
  { id: 'q2', text: 'E’ consapevole che l’assicurazione non opera qualora l’assicurato sia affetto da alcolismo, tossicodipendenza, o AIDS o malattie correlate?' },
  { id: 'q3', text: 'E’ informato sulla possibile presenza in polizza, di Scoperti/Franchigie/limiti/Esclusioni?' },
  { id: 'q4', text: 'Le somme assicurate/massimali e la durata previste dalla polizza assicurativa sono coerenti con la sua esigenza di protezione?' },
]

/* ─── Date e importi ───────────────────────────────────────────────────── */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isIsoDate(v) {
  const m = ISO_RE.exec(String(v || ''))
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

/** Scadenza proposta: un anno dopo l'adesione (stesso giorno; 29/02 → 28/02). */
export function defaultScadenza(iso) {
  if (!isIsoDate(iso)) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y + 1, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0)
  return dt.toISOString().slice(0, 10)
}

/** '45,00' / '1.000' / 45 → 45 (numero), NaN se non leggibile. */
export function parseEuro(v) {
  if (typeof v === 'number') return v
  const s = String(v || '').replace(/[€\s]/g, '')
  if (!s) return NaN
  const n = Number(s.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}

/** 45 → '45,00' */
export function fmtEuro(n) {
  return Number.isFinite(n) ? n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+,)/g, '.') : ''
}

/** '45,00' → '45' (premi interi senza decimali, come sul certificato). */
export function shortEuro(v) {
  const n = parseEuro(v)
  if (!Number.isFinite(n)) return String(v || '')
  return Number.isInteger(n) ? String(n).replace(/\B(?=(\d{3})+$)/g, '.') : fmtEuro(n)
}

/* ─── Controlli ────────────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 'a@x.it, b@y.it; c@z.it' → indirizzi validi. */
export const splitAddresses = (v) => String(v || '').split(/[;,\s]+/).map((s) => s.trim()).filter((s) => EMAIL_RE.test(s))
export const cleanCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const isPartitaIva = (v) => /^\d{11}$/.test(cleanCode(v))

/**
 * Controlla un'adesione. Ritorna { errors: {campo: testo}, warnings: [testo],
 * valid }. Gli ERRORI bloccano il salvataggio; gli AVVISI (nome che non
 * torna col codice fiscale, una risposta NO) si mostrano ma non bloccano.
 */
export function validateAdesione(rec, config, refYear = new Date().getFullYear()) {
  const r = rec || {}
  /** @type {Record<string, string>} */
  const errors = {}
  /** @type {string[]} */
  const warnings = []
  const val = (id) => String(r[id] ?? '').trim()
  for (const f of FIELDS) {
    if (f.required && !val(f.id)) errors[f.id] = 'Campo obbligatorio'
  }
  for (const f of FIELDS) {
    if (f.type === 'date' && val(f.id) && !isIsoDate(val(f.id))) errors[f.id] = 'Data non valida'
  }
  if (val('email') && !EMAIL_RE.test(val('email'))) errors.email = 'Indirizzo email non valido'
  if (val('opzione') && !optionOf(config, val('opzione'))) errors.opzione = 'Opzione non prevista'
  if (isIsoDate(val('data_adesione')) && isIsoDate(val('data_scadenza')) && val('data_scadenza') <= val('data_adesione')) {
    errors.data_scadenza = 'La scadenza deve essere dopo la data di adesione'
  }
  if (isIsoDate(val('data_nascita')) && isIsoDate(val('data_adesione')) && val('data_nascita') >= val('data_adesione')) {
    errors.data_nascita = 'La data di nascita deve essere prima dell\'adesione'
  }
  const cf = cleanCode(val('codice_fiscale'))
  if (cf && !isPartitaIva(cf)) {
    const d = decodeCf(cf, refYear)
    if (!d.valid) errors.codice_fiscale = 'Codice fiscale non valido: 16 caratteri (persona) o 11 cifre (partita IVA)'
    else if (!d.checkOk) errors.codice_fiscale = 'Il carattere di controllo del codice fiscale non torna: probabile errore di battitura'
    else {
      const { issues } = checkPerson({ cognome: val('cognome'), nome: val('nome'), cf, birthDate: isIsoDate(val('data_nascita')) ? val('data_nascita') : null }, refYear)
      for (const i of issues) if (i.level === 'error' && !/^cf-(formato|controllo|mancante)$/.test(i.code)) warnings.push(i.text)
    }
  }
  const answers = r.questionario || {}
  for (const q of QUESTIONS) {
    const a = answers[q.id]
    if (a !== 'SI' && a !== 'NO') errors[`questionario.${q.id}`] = 'Risposta obbligatoria'
  }
  if (QUESTIONS.some((q) => answers[q.id] === 'NO')) {
    warnings.push('Almeno una risposta del questionario è NO: verifica che il prodotto sia adeguato alle esigenze del cliente.')
  }
  return { errors, warnings, valid: Object.keys(errors).length === 0 }
}

/** Record pulito da salvare: codici in maiuscolo, premio dall'opzione. */
export function normalizeAdesione(rec, config) {
  const r = { ...(rec || {}) }
  for (const f of FIELDS) if (typeof r[f.id] === 'string') r[f.id] = r[f.id].trim()
  r.codice_fiscale = cleanCode(r.codice_fiscale)
  r.targa = cleanCode(r.targa)
  r.opzione = String(r.opzione || '').toLowerCase()
  const opt = optionOf(config, r.opzione)
  r.premio = opt ? opt.premio : ''
  r.questionario = { ...(r.questionario || {}) }
  return r
}

/* ─── Numerazione: IAH0015842/001 → /002 … ─────────────────────────────── */

export const DEFAULT_FIRST_NUMBER = 'IAH0015842/001'
export { nextIdentificativo as nextNumber }

/* ─── Righe del BDX ────────────────────────────────────────────────────── */

/** Valori di una riga del BDX nell'ordine di FIELDS (date come Date UTC, premio numero). */
export function bdxRow(rec, config) {
  const opt = optionOf(config, rec.opzione)
  return FIELDS.map((f) => {
    const v = rec[f.id]
    if (f.type === 'date') return isIsoDate(v) ? new Date(`${v}T00:00:00Z`) : (v || null)
    if (f.id === 'opzione') return opt ? opt.name : (v || '')
    if (f.id === 'premio') { const n = parseEuro(opt ? opt.premio : v); return Number.isFinite(n) ? n : null }
    return v == null || v === '' ? null : String(v)
  })
}

/** Nome file sicuro per i documenti di un'adesione. */
export function docBaseName(rec) {
  const num = String(rec.numero || '').replace(/[^\w-]+/g, '_')
  const who = [rec.cognome, rec.nome].filter(Boolean).join('_').replace(/[^\w-]+/g, '_')
  return [num, who].filter(Boolean).join('_') || 'adesione'
}
