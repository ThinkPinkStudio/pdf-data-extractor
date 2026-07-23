/**
 * Calcolo del premio dal CODICE CONFIGURAZIONE tramite la tabella prezzi
 * configurabile. Modulo PURO (testabile in Node).
 *
 * Ogni riga della tabella ha { pacchetto, premio, formula? }:
 *  - `premio`  è il valore fisso (lookup), usato come default;
 *  - `formula` è opzionale: se presente e valida, il premio viene CALCOLATO
 *    con un'espressione aritmetica che può riferirsi ai campi del record e
 *    alla variabile `premio` (il valore fisso della riga). Es. "premio * 2",
 *    "importo * 0,05", "max(premio, 15)".
 */
import { DEFAULT_PREZZI } from './tracciato.js'
import { evalExpr, toNumber } from './expr.js'

/** Formatta un numero come importo (2 decimali, virgola come separatore). */
export function formatEuro(n) {
  if (!Number.isFinite(n)) return ''
  return n.toFixed(2).replace('.', ',')
}

/**
 * @param {string} codiceConfig  es. '00001' | '00002' | '00003'
 * @param {object} prezzi        mappa { codice: { pacchetto, premio, formula? } }
 * @param {object} [record]      record dell'aderente (per le variabili della formula)
 * @returns {{ pacchetto: string, premio: string }}
 */
export function premioFor(codiceConfig, prezzi = DEFAULT_PREZZI, record = {}) {
  const key = String(codiceConfig == null ? '' : codiceConfig).trim()
  const row = (prezzi && prezzi[key]) || null
  if (!row) return { pacchetto: '', premio: '' }
  let premio = row.premio || ''
  const formula = String(row.formula || '').trim()
  if (formula) {
    try {
      const vars = { ...(record || {}), premio: toNumber(row.premio) }
      premio = formatEuro(evalExpr(formula, vars))
    } catch (_) {
      // Formula non valida: si ricade sul valore fisso della riga.
      premio = row.premio || ''
    }
  }
  return { pacchetto: row.pacchetto || '', premio }
}
