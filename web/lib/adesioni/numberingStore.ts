// Numerazione progressiva CONDIVISA dell'identificativo univoco, persistita
// server-side nella tabella settings (chiave `adesioniNumberingNext`). Porta la
// parità con l'app desktop (recordsStore.getNumbering/setNumbering/
// advanceNumbering): prima nel web viveva solo in localStorage, quindi non
// condivisa tra operatori/dispositivi.
import { pool } from '../db'
import { advanceIfAccepted } from './numbering.js'

const KEY = 'adesioniNumberingNext'

/** Ritorna il prossimo identificativo suggerito ('' = nessuna serie impostata). */
export async function getNumbering(): Promise<{ next: string }> {
  const { rows } = await pool.query<{ value: string }>('SELECT value FROM settings WHERE key = $1', [KEY])
  return { next: rows[0]?.value ?? '' }
}

/** Imposta il numero iniziale/suggerito della serie (seme manuale). */
export async function setNumbering(next: string): Promise<{ next: string }> {
  const val = String(next == null ? '' : next)
  await pool.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [KEY, val]
  )
  return { next: val }
}

/**
 * Avanza la numerazione SOLO se il valore accettato coincide con quello
 * attualmente suggerito (proposta accettata); se l'operatore ha cambiato il
 * numero (override) o non c'è serie attiva, resta invariata. Parità con
 * recordsStore.advanceNumbering + numbering.advanceIfAccepted del desktop.
 */
export async function advanceNumbering(acceptedValue: string): Promise<{ next: string }> {
  const cur = (await getNumbering()).next
  const nxt = advanceIfAccepted(cur, acceptedValue)
  if (nxt !== cur) await setNumbering(nxt)
  return { next: nxt }
}
