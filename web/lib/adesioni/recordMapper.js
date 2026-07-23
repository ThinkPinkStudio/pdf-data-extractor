/**
 * Mappature PURE record ⇄ tracciato/modulo (testabili in Node).
 *
 * Un "record" è un oggetto { fieldId: valore, idd: { DOMANDA: risposta } }.
 */
import { TRACCIATO_HEADERS, normHeader } from './tracciato.js'
import { toTrackDate, toModuloDate } from './coverageDates.js'
import { premioFor } from './premioService.js'

/** Costruisce la riga del tracciato (array di 34 valori nell'ordine delle intestazioni). */
export function buildTrackRow(record, fields, idd, headers = TRACCIATO_HEADERS) {
  const byTrack = {}
  for (const f of fields) {
    if (!f.trackCol) continue
    let v = f.type === 'fixed' ? f.fixed : record[f.id]
    if (f.type === 'date') v = toTrackDate(v)
    byTrack[normHeader(f.trackCol)] = v == null ? '' : v
  }
  const ans = record.idd || {}
  const isA = String(record.tipo_movimento || '').toUpperCase() === 'A'
  idd.forEach((q, i) => {
    byTrack[normHeader(`CODICE DOMANDA ${i + 1}`)] = q.domanda
    byTrack[normHeader(`CODICE RISPOSTA ${i + 1}`)] = isA ? (ans[q.domanda] ?? '') : ''
  })
  return headers.map(h => {
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
    record[f.id] = raw == null ? '' : (f.type === 'date' ? toTrackDate(raw) : (raw instanceof Date ? toTrackDate(raw) : String(raw)))
  }
  // questionario: legge le coppie CODICE DOMANDA i / CODICE RISPOSTA i
  for (let i = 1; i <= idd.length + 5; i++) {
    const dom = norm[normHeader(`CODICE DOMANDA ${i}`)]
    const ris = norm[normHeader(`CODICE RISPOSTA ${i}`)]
    if (dom != null && String(dom).trim() !== '') {
      record.idd[String(dom).trim()] = ris == null ? '' : String(ris).trim()
    }
  }
  return record
}

/** Validazione PURA di un record secondo le definizioni dei campi. Ritorna { errors: {id:msg} }. */
export function validateRecord(record, fields) {
  const errors = {}
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
