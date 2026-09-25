/**
 * INTERRUTTORI del motore per le correzioni da MISURARE.
 *
 * Una correzione nuova entra spenta dietro un flag; le run di test la accendono
 * con l'override `polizzaEngineFlags` (golden-prod `--flags campi,cascata4`) e
 * si misura sull'app deployata contro la stessa base, una alla volta, con UN
 * solo deploy. Quando la misura la promuove, il flag entra in DEFAULT_FLAGS (e
 * in CLAUDE.md); se la boccia, si toglie il codice.
 *
 * Sintassi di `polizzaEngineFlags`: nomi separati da virgola o spazio; `-nome`
 * spegne un flag di default, `nessuno` azzera i default.
 */

/** Flag accesi in produzione (misurati). */
export const DEFAULT_FLAGS = Object.freeze([])

/**
 * Flag conosciuti, col perché. Un nome sconosciuto nell'override si ignora.
 * - campi: valori dei campi compilabili (AcroForm) nella griglia del text layer.
 * - cascata4: la cascata chiede al massimo FIELDS_PER_CALL campi per chiamata
 *   (come i gruppi) e scarta le copie con lo stesso text layer (F04).
 */
export const KNOWN_FLAGS = Object.freeze({
  campi: 'valori dei campi compilabili (AcroForm) nella griglia del text layer',
  cascata4: 'cascata a FIELDS_PER_CALL campi per chiamata; copie identiche anche per text layer (F04)',
})

/** @returns {Set<string>} */
export function engineFlags(settings) {
  const out = new Set(DEFAULT_FLAGS)
  const raw = String(settings?.polizzaEngineFlags || '').toLowerCase()
  for (const tok of raw.split(/[\s,;]+/).filter(Boolean)) {
    if (tok === 'nessuno' || tok === 'none') { out.clear(); continue }
    const off = tok.startsWith('-')
    const name = tok.replace(/^[-+]/, '')
    if (!Object.prototype.hasOwnProperty.call(KNOWN_FLAGS, name)) continue
    if (off) out.delete(name)
    else out.add(name)
  }
  return out
}

/** true se il flag è acceso per queste impostazioni (default compresi). */
export function engineFlag(settings, name) {
  return engineFlags(settings).has(name)
}

/** Riga di diagnostica: i flag attivi, o «nessuno». */
export function engineFlagsLabel(settings) {
  const s = [...engineFlags(settings)].sort()
  return s.length ? s.join(',') : 'nessuno'
}
