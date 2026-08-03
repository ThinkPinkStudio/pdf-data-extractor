/**
 * Mappature PURE record ⇄ tracciato/modulo (testabili in Node).
 *
 * Un "record" è un oggetto { fieldId: valore, idd: { DOMANDA: risposta } }.
 */
import { MAX_IDD_QUESTIONS, normHeader, trackHeadersFor } from './tracciato.js'
import { toTrackDate, toModuloDate } from './coverageDates.js'
import { premioFor, opzioneLabelFor } from './premioService.js'

/** Chiave con cui l'errore di una risposta del questionario entra in `errors`. */
export const iddErrorKey = (domanda) => `idd:${domanda}`

/** Il questionario si valorizza SOLO per TIPO MOVIMENTO "A" (legenda AXA). */
export function iddApplies(record) {
  return String((record && record.tipo_movimento) || '').toUpperCase() === 'A'
}

/** Risposta data a una domanda, normalizzata (stringa, senza spazi ai bordi). */
export function iddAnswer(record, domanda) {
  const ans = (record && record.idd) || {}
  const v = ans[domanda]
  return v == null ? '' : String(v).trim()
}

/**
 * Domande del questionario rimaste senza risposta valida su un record di
 * attivazione: sono quelle che, altrimenti, arriverebbero in AXA con la colonna
 * CODICE RISPOSTA vuota. Per i movimenti M/E il questionario non si compila,
 * quindi l'elenco è sempre vuoto.
 */
export function missingIddAnswers(record, idd) {
  if (!iddApplies(record) || !Array.isArray(idd)) return []
  const out = []
  for (const q of idd.slice(0, MAX_IDD_QUESTIONS)) {
    const v = iddAnswer(record, q.domanda)
    if (!v) { out.push({ domanda: q.domanda, reason: 'required' }); continue }
    const opts = Array.isArray(q.options) ? q.options : []
    if (opts.length && !opts.some(o => String(o.value) === v)) out.push({ domanda: q.domanda, reason: 'select' })
  }
  return out
}

/**
 * Costruisce la riga del tracciato (array di valori nell'ordine delle
 * intestazioni). Senza `headers` espliciti si usa un tracciato dimensionato sul
 * questionario, così le risposte hanno sempre una colonna dove finire.
 */
export function buildTrackRow(record, fields, idd, headers) {
  const cols = Array.isArray(headers) && headers.length ? headers : trackHeadersFor(idd)
  const byTrack = {}
  for (const f of fields) {
    if (!f.trackCol) continue
    let v = f.type === 'fixed' ? f.fixed : record[f.id]
    if (f.type === 'date') v = toTrackDate(v)
    byTrack[normHeader(f.trackCol)] = v == null ? '' : v
  }
  const isA = iddApplies(record)
  ;(Array.isArray(idd) ? idd : []).slice(0, MAX_IDD_QUESTIONS).forEach((q, i) => {
    byTrack[normHeader(`CODICE DOMANDA ${i + 1}`)] = q.domanda
    byTrack[normHeader(`CODICE RISPOSTA ${i + 1}`)] = isA ? iddAnswer(record, q.domanda) : ''
  })
  return cols.map(h => {
    const v = byTrack[normHeader(h)]
    return v == null ? '' : v
  })
}

/** Costruisce l'oggetto dati per i segnaposto del modulo .docx. */
export function buildDocxData(record, fields, prezzi, offsetDays = 0) {
  const data = {}
  for (const f of fields) {
    if (!f.docx) continue
    let v = f.type === 'fixed' ? f.fixed : record[f.id]
    if (f.docxDateOffset) v = toModuloDate(v, offsetDays)
    else if (f.type === 'date') v = toTrackDate(v)
    data[f.docx] = v == null ? '' : String(v)
  }
  data.cognome_nome = [record.cognome, record.nome].filter(Boolean).join(' ').trim()
  const pr = premioFor(record.codice_configurazione, prezzi, record)
  data.premio = pr.premio || ''
  data.pacchetto = pr.pacchetto || ''
  data.opzione = opzioneLabelFor(record.codice_configurazione)
  return data
}

/** Mappa una riga del flusso (oggetto header→valore) in un record per id campo. */
export function flussoRowToRecord(rowByHeader, fields, idd) {
  const norm = {}
  for (const [k, v] of Object.entries(rowByHeader)) norm[normHeader(k)] = v
  const record = { idd: {} }
  for (const f of fields) {
    if (f.type === 'fixed') { record[f.id] = f.fixed; continue }
    if (!f.flussoCol) { record[f.id] = ''; continue }
    const raw = norm[normHeader(f.flussoCol)]
    let val = raw == null ? '' : (f.type === 'date' ? toTrackDate(raw) : (raw instanceof Date ? toTrackDate(raw) : String(raw)))
    // Excel spesso legge i codici come numeri e perde gli zeri iniziali (00001 → 1).
    // Per i campi select con option a larghezza fissa, ripristina lo zero-padding.
    if (f.type === 'select' && Array.isArray(f.options) && val !== '') val = coerceOption(val, f.options)
    record[f.id] = val
  }
  // questionario: legge le coppie CODICE DOMANDA i / CODICE RISPOSTA i fino al
  // massimo ammesso dalla compagnia (20), qualunque sia il numero di domande
  // configurate: il flusso in ingresso può averne di più o di meno.
  for (let i = 1; i <= MAX_IDD_QUESTIONS; i++) {
    const dom = iddCell(norm, 'DOMANDA', i)
    const ris = iddCell(norm, 'RISPOSTA', i)
    if (dom != null && String(dom).trim() !== '') {
      record.idd[String(dom).trim()] = ris == null ? '' : String(ris).trim()
    }
  }
  return record
}

/**
 * Legge la cella di una coppia del questionario accettando le grafie viste sui
 * flussi reali: "CODICE DOMANDA 1", "CODICE DOMANDA1", "CODICE_DOMANDA_1".
 * Senza questa tolleranza una sola grafia diversa faceva perdere le risposte.
 */
function iddCell(norm, kind, i) {
  const variants = [`CODICE ${kind} ${i}`, `CODICE ${kind}${i}`, `CODICE_${kind}_${i}`, `CODICE ${kind}_${i}`]
  for (const v of variants) {
    const val = norm[normHeader(v)]
    if (val != null && String(val).trim() !== '') return val
  }
  return null
}

/**
 * Coerce di un valore all'option di un select. Se combacia già, lo restituisce.
 * Altrimenti, per valori numerici, prova lo zero-padding alla larghezza di ciascuna
 * option (es. '1' → '00001'). Se nessuna combacia, restituisce il valore originale.
 */
function coerceOption(val, options) {
  const s = String(val).trim()
  if (options.some(o => String(o.value) === s)) return s
  if (/^\d+$/.test(s)) {
    for (const o of options) {
      const ov = String(o.value)
      if (/^\d+$/.test(ov) && s.padStart(ov.length, '0') === ov) return ov
    }
  }
  return s
}

/**
 * Validazione PURA di un record secondo le definizioni dei campi e — quando il
 * questionario è passato — delle risposte IDD. Ritorna { errors: {id:msg} };
 * gli errori del questionario usano la chiave `idd:CODICE_DOMANDA`.
 *
 * Il questionario è obbligatorio per i movimenti di attivazione: senza questo
 * controllo un record si salvava (e finiva in AXA) con le colonne CODICE
 * RISPOSTA vuote, che è esattamente il difetto segnalato sul tracciato.
 */
export function validateRecord(record, fields, idd) {
  const errors = {}
  for (const m of missingIddAnswers(record, idd)) errors[iddErrorKey(m.domanda)] = m.reason
  for (const f of fields) {
    if (f.enabled === false || f.type === 'fixed') continue
    const v = record[f.id]
    const empty = v == null || String(v).trim() === ''
    if (f.required && empty) { errors[f.id] = 'required'; continue }
    if (empty) continue
    const s = String(v)
    if (f.maxLength && s.length > f.maxLength) { errors[f.id] = 'maxlen'; continue }
    if (f.type === 'date' && !/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { errors[f.id] = 'date'; continue }
    if (f.type === 'number' && !/^-?\d+([.,]\d+)?$/.test(s.trim())) { errors[f.id] = 'number'; continue }
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) { errors[f.id] = 'email'; continue }
    if (f.type === 'select' && Array.isArray(f.options) && !f.options.some(o => o.value === s)) { errors[f.id] = 'select'; continue }
  }
  return { errors, valid: Object.keys(errors).length === 0 }
}
