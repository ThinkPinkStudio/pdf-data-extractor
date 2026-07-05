// Parser dei metadati dal percorso relativo di upload delle polizze.
//
// L'archivio del cliente segue (nel ~90% dei casi) la gerarchia:
//   [in vigore|non in vigore] / [Area Storica|CSA <sede>] / [in vigore] /
//   Gruppo <X> / [In vigore|non in vigore] / <Società|Persona> /
//   [in uso|Deposito] / <Ramo> / [sottocartelle] / file.pdf
//
// La classificazione è per PATTERN sul singolo segmento, non per posizione:
// l'upload può partire da qualsiasi profondità dell'albero e il 10% dei
// percorsi devia dallo schema. Ogni campo è indipendente: ciò che non si
// riconosce resta null, senza invalidare il resto.
//
// Nessuna dipendenza da Node/DB: importabile da web (via sharedServices),
// desktop e test (node --test).

// Normalizza per il confronto: minuscole, senza accenti, spazi compattati.
export function normalizeSegment(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Alias → ramo canonico. Le chiavi sono normalizzate (normalizeSegment).
// I valori canonici coincidono con le etichette usate nelle cartelle "in uso"
// del cliente (più i classici INCENDIO/RCA/RCT citati a voce).
export const RAMO_ALIASES = new Map([
  ['rct', 'RCT'],
  ['rc terzi', 'RCT'],
  ['rcto', 'RCTO'],
  ['rct o', 'RCTO'],
  ['rcto p', 'RCTOP'],
  ['rctop', 'RCTOP'],
  ['rco', 'RCO'],
  ['rcp', 'RCP'],
  ['rc prodotti', 'RCP'],
  ['rca', 'RCA'],
  ['auto', 'Auto'],
  ['incendio', 'Incendio'],
  ['incendio banca', 'Incendio'],
  ['furto', 'Furto'],
  ['cauzioni', 'Cauzioni'],
  ['crediti', 'Crediti'],
  ['d&o', 'D&O'],
  ['d & o', 'D&O'],
  ['do', 'D&O'],
  ['multirischi', 'Multirischi'],
  ['globale fabbricati', 'Globale Fabbricati'],
  ['trasporti', 'Trasporti'],
  ['tutela legale', 'Tutela legale'],
  ['infortuni', 'Infortuni'],
  ['infortuni amministratori', 'Infortuni'],
  ['infortuni dipendenti', 'Infortuni'],
  ['infortuni dirigenti', 'Infortuni'],
  ['infortuni impiegati', 'Infortuni'],
  ['vita', 'Vita'],
  ['vita dirigenti', 'Vita'],
  ['rsm', 'RSM'],
  ['rsm gravi patologie', 'RSM'],
  ['rsm integrativa f a s i', 'RSM'],
  ['assistenza dipendenti', 'Assistenza'],
  ['assistenza nucleo', 'Assistenza'],
  ['titoli pass broker', 'Titoli Pass Broker'],
  ['cyber', 'Cyber'],
  ['elettronica', 'Elettronica'],
  ['car', 'CAR'],
  ['postuma', 'Postuma'],
])

// Segmenti amministrativi/di servizio noti che NON portano informazione
// (né società né ramo): vanno ignorati nella classificazione.
const NOISE_PATTERNS = [
  /^quietanzament/i,
  /^quietanzamenti/i,
  /^condizioni/i,
  /^contabilita/i,
  /^da cancellare$/i,
  /^documenti vari$/i,
  /^archivio( morto)?/i,
  /^archvio/i, // typo reale visto nell'archivio del cliente
  /^annulli/i,
  /^scatoloni/i,
  /^estrazioni/i,
  /^carichi excell/i,
  /^regolazioni premio$/i,
  /^polizze scaricate/i,
  /^q ze da stampare/i,
  /^titoli (incassati|da incassare)/i,
  /^elenco polizze/i,
  /^area storica$/i, // gestita come agenzia, mai come società
  /^full$/i,
  /^convenzione/i,
  /^deposito$/i,
  /^in uso$/i,
  /^privati$/i,
  /^vari /i,
  /^scadenz/i,
  /^portafoglio/i,
]

function isNoise(norm) {
  return NOISE_PATTERNS.some((re) => re.test(norm))
}

function matchRamo(norm) {
  if (RAMO_ALIASES.has(norm)) return RAMO_ALIASES.get(norm)
  // Match tollerante: "RCTOP nuova", "Infortuni Marchetti", "Tutela legale quadri dirigenti"…
  for (const [alias, canon] of RAMO_ALIASES) {
    if (alias.length >= 3 && (norm.startsWith(alias + ' ') || norm.endsWith(' ' + alias))) return canon
  }
  return null
}

/**
 * Classifica il nome file in un tipo documento e ne estrae l'eventuale anno.
 * @returns {{ docType: string, anno: number|null }}
 */
export function classifyFileName(fileName) {
  const base = String(fileName || '').replace(/\.[a-z0-9]{2,5}$/i, '')
  const norm = normalizeSegment(base)
  const yearMatch = norm.match(/\b(19|20)\d{2}\b/)
  const anno = yearMatch ? parseInt(yearMatch[0], 10) : null

  if (/quietanz/.test(norm)) return { docType: 'quietanza', anno }
  if (/^app\b|appendice|\bapp \d/.test(norm)) return { docType: 'appendice', anno }
  if (/certificato/.test(norm)) return { docType: 'certificato', anno }
  if (/questionario/.test(norm)) return { docType: 'questionario', anno }
  if (/bilanc|nota integrativa|relazione sulla gestione/.test(norm)) return { docType: 'bilancio', anno }
  if (/regolazione/.test(norm)) return { docType: 'regolazione', anno }
  if (/quotazione|preventivo/.test(norm)) return { docType: 'quotazione', anno }
  if (/set informativo|condizioni/.test(norm)) return { docType: 'set_informativo', anno }
  if (/polizza|polizze/.test(norm)) return { docType: 'polizza', anno }
  return { docType: 'altro', anno }
}

/**
 * Estrae i metadati dal percorso relativo di un file caricato.
 * @param {string} relPath percorso relativo con separatore '/' (come inviato dal client)
 * @returns {{
 *   agenzia: string|null, gruppo: string|null, societa: string|null,
 *   statoVigore: string|null, uso: string|null, ramo: string|null,
 *   docType: string, anno: number|null,
 *   raw: { segments: string[], unclassified: string[] }
 * }}
 */
export function parseDocumentPath(relPath) {
  const parts = String(relPath || '').split('/').filter(Boolean)
  const fileName = parts.length > 0 ? parts[parts.length - 1] : ''
  const folders = parts.slice(0, -1)

  const out = {
    agenzia: null,
    gruppo: null,
    societa: null,
    statoVigore: null,
    uso: null,
    ramo: null,
    docType: 'altro',
    anno: null,
    raw: { segments: folders, unclassified: [] },
  }

  let gruppoIndex = -1
  const unclassified = [] // { seg, index }

  folders.forEach((seg, index) => {
    const norm = normalizeSegment(seg)
    if (!norm) return

    if (norm === 'in vigore' || norm === 'non in vigore') {
      // Compare a due livelli (radice e dentro il gruppo): vince l'occorrenza
      // più profonda, che qualifica la singola società/polizza.
      out.statoVigore = norm
      return
    }
    if (norm === 'in uso' || norm === 'deposito') {
      out.uso = norm
      return
    }
    if (norm === 'area storica' || /^csa\b/.test(norm)) {
      out.agenzia = seg.trim()
      return
    }
    if (/^gruppo\b/.test(norm)) {
      out.gruppo = seg.trim()
      gruppoIndex = index
      return
    }
    const ramo = matchRamo(norm)
    if (ramo && !out.ramo) {
      out.ramo = ramo
      return
    }
    if (isNoise(norm)) return
    unclassified.push({ seg: seg.trim(), index })
  })

  // Società: primo segmento non classificato DOPO il gruppo (es. "Adamant Bionrg").
  // Senza gruppo riconosciuto (es. persone fisiche in CSA Lipari: "Ascheri Stefano"),
  // il primo segmento non classificato fa sia da gruppo logico sia da società.
  const afterGruppo = unclassified.filter((u) => u.index > gruppoIndex)
  if (afterGruppo.length > 0) out.societa = afterGruppo[0].seg
  out.raw.unclassified = unclassified.map((u) => u.seg)

  const fileInfo = classifyFileName(fileName)
  out.docType = fileInfo.docType
  out.anno = fileInfo.anno
  return out
}
