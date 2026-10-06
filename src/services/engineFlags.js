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
export const DEFAULT_FLAGS = Object.freeze(['filtroelenchi', 'rigagriglia', 'riepilogo', 'primepagine', 'coppietesto', 'fuocopolizza', 'ocrsoloscansioni', 'altresezioni', 'garanziecolonna', 'categoriaaltrui'])

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
  verifiche: 'prompt: anche per le verifiche la frase può usare parole diverse (resta la citazione che nomina l\'oggetto)',
  recupero: 'Stadio E con le pagine dei batch, budget dal contesto, ranking semantico+IDF per rango, senza label (F07)',
  sezioni: 'A.7: tra più righe (rate, coperture e totale) la riga che la DESCRIZIONE chiede (premio annuo, non la rata iniziale; la copertura, non il totale del contratto), invece del «TOTALE dell\'intero periodo»',
  zeri: 'A.7: un importo stampato a zero (0,00) in una cella è un valore da riportare quando la descrizione del campo lo prevede (interessi, diritti)',
  righe: 'A.7: tra più righe la riga che corrisponde a ciò che chiede la DESCRIZIONE del campo, senza istruzioni fisse né esempi (al posto del «TOTALE dell\'intero periodo»)',
  date8: 'A.8: le DATE del frontespizio sono provvisorie quando un documento datato è più recente: la cascata le chiede anche a lui (quietanza di rinnovo) e decide l\'arbitro',
  a7ripiego: 'A.7: una proposta la cui riga e colonna non nominano il campo (riga «Categoria» per l\'Attività) è solo ripiego: il campo resta da chiedere alla cascata (la sola regola di a78)',
  a7ripiegotesti: 'Come a7ripiego ma per i soli campi di TESTO: gli importi di A.7 da righe che non nominano il campo restano come prima',
  altresezioni: 'Dopo il merge: in un documento con una «SEZIONE <copertura>», un importo dei campi della copertura che compare solo dentro ALTRE sezioni si svuota (Vittoria: «Franchigia 300» della sezione acqua condotta)',
  garanziecolonna: 'Dopo il merge: l\'elenco delle garanzie scelte della copertura dalle righe con un premio nella colonna intestata alla copertura, se il valore estratto non ne nomina nessuna (DAS: «Difesa Condominio»)',
  verificatesti: 'Dopo il merge: ogni valore di TESTO (non elenco, non verifica) chiesto al modello in una chiamata a sé contro la sola descrizione del campo; se non corrisponde cade e si prova il candidato alternativo',
  categoriaaltrui: 'Dopo il merge: un campo di testo il cui valore è un\'opzione che la descrizione di un ALTRO campo elenca («una tra …») e che la sua descrizione non nomina si svuota (Attività = «Auto/Circolazione» della Tipologia)',
  coppiecopertura: 'Pertinenza: nelle coppie etichetta→valore anche le celle col premio sotto la colonna intestata alla copertura (scheda DAS OneClick: «TUTELA LEGALE» → 24,00)',
  datagriglia: 'Datazione: un documento che il markdown lascia senza data si data dalla griglia dei prompt (solo righe di periodo o date ripetute) — quietanze «sandwich» del ramo Docling',
  filtroelenchi: 'Campi che la descrizione definisce ELENCO: se il modello dice che NESSUNA voce trovata corrisponde alla descrizione, il campo resta vuoto (le scelte parziali non cambiano nulla)',
  ocrsoloscansioni: 'OCR col modello visivo (polizzaOcrEngine) solo nei fascicoli di sole scansioni; dove c\'è testo digitale Tesseract',
  citazioneriga: 'Pertinenza: la prova citata vale anche se salta parole in mezzo, quando due sue parole e due importi stanno nello stesso ordine su una riga del testo inviato',
  coppietesto: 'Pertinenza e domanda sulla polizza: le coppie etichetta→valore del layout comprendono anche i TESTI sotto l\'intestazione di colonna («Indicizzazione → ESCLUSA»)',
  fuocopolizza: 'Fascicolo con documenti di PIÙ polizze: l\'estrazione legge solo i documenti della polizza provata dalla pertinenza (esclusi quelli con soli numeri di polizza diversi; quelli senza numero restano)',
  primepagine: 'Domanda sulla polizza: il primo batch con le SOLE prime pagine dei documenti (la scheda non si perde tra le pagine del set informativo); le altre nei batch dopo',
  riepilogo: 'Dopo il merge: un importo che la descrizione lega alla «stessa riga o stesso riepilogo» di un altro campo si svuota se nessuna pagina del suo documento porta anche quel valore; diritti/interessi uguali alle imposte sono un numero copiato',
  rigagriglia: 'Dopo il merge, dalla GRIGLIA: un importo della copertura letto nella riga dei totali passa alla riga della copertura nella stessa colonna; i campi vuoti «sulla stessa riga» del premio prendono la cella sotto l\'intestazione che li nomina',
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
