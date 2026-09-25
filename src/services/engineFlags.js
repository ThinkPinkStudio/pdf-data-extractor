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
 * Flag conosciuti, col perché (nomi in MINUSCOLO: l'override si confronta in
 * minuscolo). Un nome sconosciuto nell'override si ignora.
 * - campi: valori dei campi compilabili (AcroForm) nella griglia del text layer.
 * - cascata4: la cascata chiede al massimo FIELDS_PER_CALL campi per chiamata
 *   (come i gruppi) e scarta le copie con lo stesso text layer (F04).
 * - a78: le proposte degli stadi tabella (A.7) e frontespizio (A.8) sono
 *   provvisorie; A.7 senza etichetta che nomina il campo = solo ripiego; A.8
 *   legge la griglia del documento più recente (F13).
 * - elenchi: un valore-elenco («voce; voce») prende come sorgente la pagina
 *   con più voci e l'affinità dalle finestre delle voci (F08, parte 2).
 * - recupero: lo Stadio E usa le pagine dei batch (griglia + coppie +
 *   tabelle Docling), il budget dal contesto reale, il ranking semantico
 *   fuso per rango con quello lessicale-IDF (mai la label), pagine identiche
 *   una volta, precedenza ai campi mai chiesti (F07).
 */
export const KNOWN_FLAGS = Object.freeze({
  campi: 'valori dei campi compilabili (AcroForm) nella griglia del text layer',
  cascata4: 'cascata a FIELDS_PER_CALL campi per chiamata; copie identiche anche per text layer (F04)',
  a78: 'proposte di tabella (A.7) e frontespizio (A.8) provvisorie; A.7 senza etichetta del campo solo ripiego; A.8 dalla griglia (F13)',
  elenchi: 'elenchi «voce; voce»: sorgente = pagina con più voci, affinità sulle finestre delle voci (F08, parte 2)',
  recupero: 'Stadio E con le pagine dei batch, budget dal contesto, ranking semantico+IDF per rango, senza label (F07)',
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
