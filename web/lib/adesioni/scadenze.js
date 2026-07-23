/**
 * Logica PURA delle scadenze (nessun import Electron → testabile in Node).
 * Classifica le date di fine copertura rispetto al mese passato / corrente /
 * successivo, per evidenziare cosa è scaduto o sta per scadere.
 */
import { toDate } from './coverageDates.js'

/** Chiave anno-mese (es. 2026-07) di una Date UTC. */
function ym(d) {
  return d.getUTCFullYear() * 12 + d.getUTCMonth()
}

/**
 * Classifica una data GG/MM/AAAA rispetto a `now`:
 *   'past'    → mese precedente
 *   'current' → mese corrente
 *   'next'    → mese successivo
 *   null      → fuori dalla finestra o data non valida
 */
export function expiryBucket(value, now = new Date()) {
  const d = toDate(value)
  if (!d) return null
  const ref = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const diff = ym(d) - ym(ref)
  if (diff === -1) return 'past'
  if (diff === 0) return 'current'
  if (diff === 1) return 'next'
  return null
}

/**
 * Raggruppa le voci dello store per bucket di scadenza (campo data_fine).
 * Ritorna { past: [], current: [], next: [] } ordinate per data crescente.
 */
export function groupByExpiry(entries, now = new Date()) {
  const groups = { past: [], current: [], next: [] }
  for (const entry of entries || []) {
    const data = entry && entry.data ? entry.data : entry
    const bucket = expiryBucket(data?.data_fine, now)
    if (bucket) groups[bucket].push(entry)
  }
  const time = (e) => {
    const d = toDate((e.data || e)?.data_fine)
    return d ? d.getTime() : 0
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => time(a) - time(b))
  return groups
}
