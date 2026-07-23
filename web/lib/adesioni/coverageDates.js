/**
 * Logica PURA delle date di copertura (nessun import Electron → testabile in Node).
 *
 * Convenzione AXA (vedi legenda): "la validità della copertura ha inizio dalle
 * ore 24:00 della data indicata". Quindi per essere attiva dal 01/11 si indica
 * il 31/10. Nel TRACCIATO in uscita si mantiene la data del flusso così com'è
 * (la compagnia se l'aspetta in quel formato); nel MODULO si mostra la data
 * REALE di decorrenza/scadenza, cioè la data del flusso + offset (default 1).
 */

const MS_DAY = 24 * 60 * 60 * 1000

/** Converte un valore (Date, seriale Excel, o stringa) in Date UTC a mezzanotte. */
export function toDate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date && !isNaN(value)) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()))
  }
  if (typeof value === 'number' && isFinite(value)) {
    // Seriale Excel (giorni dal 1899-12-30).
    const ms = Math.round((value - 25569) * MS_DAY)
    const d = new Date(ms)
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  }
  const s = String(value).trim()
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/)
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]))
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return null
}

/** Formatta una Date in GG/MM/AAAA. */
export function formatDateIT(date) {
  if (!(date instanceof Date) || isNaN(date)) return ''
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const yyyy = date.getUTCFullYear()
  return `${dd}/${mm}/${yyyy}`
}

export function addDays(date, n) {
  if (!(date instanceof Date) || isNaN(date)) return null
  return new Date(date.getTime() + n * MS_DAY)
}

/** Data per il TRACCIATO (formato AXA): valore del flusso normalizzato a GG/MM/AAAA. */
export function toTrackDate(value) {
  const d = toDate(value)
  return d ? formatDateIT(d) : (value == null ? '' : String(value))
}

/**
 * Data per il MODULO: data del flusso + offset giorni. Con offset 0 (default)
 * la data stampata coincide con quella del tracciato; impostare 1 solo se si
 * vuole stampare la decorrenza reale (semantica "dalle ore 24:00").
 */
export function toModuloDate(value, offsetDays = 0) {
  const d = toDate(value)
  if (!d) return value == null ? '' : String(value)
  return formatDateIT(addDays(d, offsetDays))
}

/**
 * Sposta una data GG/MM/AAAA di N anni (rinnovo). Il 29/02 su anno non
 * bisestile diventa 28/02. Valori non riconosciuti restano invariati.
 */
export function addYearsIT(value, years = 1) {
  const d = toDate(value)
  if (!d) return value == null ? '' : String(value)
  const y = d.getUTCFullYear() + years
  const m = d.getUTCMonth()
  const day = d.getUTCDate()
  let out = new Date(Date.UTC(y, m, day))
  if (out.getUTCMonth() !== m) out = new Date(Date.UTC(y, m + 1, 0)) // 29/02 → 28/02
  return formatDateIT(out)
}
