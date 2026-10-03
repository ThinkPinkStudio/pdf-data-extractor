/**
 * NUMERI SPEZZATI DAL KERNING del text layer — modulo FOGLIA (nessun import).
 *
 * Sta da solo perché serve a due mondi che non devono importarsi a vicenda:
 * il percorso testo (pdfTextLayer.js → ocrLayout.js → polizzaFactsRegistry.js)
 * e il controllo dell'evidenza (polizzaValidation.js, che polizzaFactsRegistry
 * importa). Con l'import diretto da pdfTextLayer.js si chiudeva un ciclo di
 * moduli. pdfTextLayer.js lo riesporta: chi lo importava da lì non cambia.
 */

/**
 * Ricompone i NUMERI spezzati dal kerning del text layer: pdf.js restituisce
 * "€ 5 .0 00.000", "€ 1 0 .000", "€ 2 .768.544" (frammenti separati da spazi)
 * dove il PDF mostra "€ 5.000.000". Si uniscono SOLO i frammenti contigui
 * fatti di cifre/punti/virgole quando almeno uno NON è un numero ben formato
 * da solo e l'unione è un importo ben formato (migliaia col punto e/o
 * decimali con virgola): due importi veri affiancati ("562,50 56,25") restano
 * separati perché l'unione non è ben formata. Struttura del testo, nessuna
 * soglia. Idempotente: su una riga già ricomposta non cambia nulla.
 */
export function joinSplitNumbers(line) {
  const WELL = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/
  const FRAG = /^[\d.,]+$/
  // La run parte da una CIFRA non preceduta da lettera/punto: prima il punto
  // finale di "consolidato. 54 . 383 ,00" entrava nella run (".54.383,00") e
  // il fatturato del questionario restava spezzato.
  return String(line || '').replace(/(?<![\w.,])\d[\d.,]*(?: [\d.,]+)+/g, (run) => {
    const frags = run.split(' ')
    if (frags.length < 2 || !frags.every((f) => FRAG.test(f))) return run
    if (frags.every((f) => WELL.test(f))) return run
    const joined = frags.join('')
    return WELL.test(joined) && /[.,]/.test(joined) ? joined : run
  })
}

/** joinSplitNumbers riga per riga su un testo intero (stesso risultato della griglia fresca). */
export function joinSplitNumbersInText(text) {
  const s = String(text || '')
  return s.includes(' ') ? s.split('\n').map(joinSplitNumbers).join('\n') : s
}

/**
 * Pagine LETTE DALLA CACHE OCR con i numeri ricomposti. joinSplitNumbers è
 * arrivato (14/09) DOPO l'ultimo bump di OCR_FORMAT (11/09): le griglie in
 * cache scritte prima restavano spezzate e il fatturato del questionario
 * "54 . 383 ,00" cadeva [senza-evidenza] due volte con la citazione giusta
 * (BOLCHINI RC 2026). Ricomporre in lettura (idempotente) evita di buttare la
 * cache e di rifare l'OCR di ogni scansione.
 *
 * `textLayer` (facoltativo): le pagine del text layer dello stesso PDF. Se c'è,
 * si ricompongono SOLO le pagine che hanno testo digitale — le pagine OCR
 * restano identiche a un OCR rifatto da zero (che joinSplitNumbers non lo
 * applica). Senza (null) si ricompongono tutte.
 */
export function joinSplitNumbersInPages(pages, textLayer = null) {
  if (!Array.isArray(pages)) return pages
  return pages.map((p, i) => {
    if (typeof p !== 'string' || !p) return p
    if (Array.isArray(textLayer) && !(textLayer[i] && String(textLayer[i]).trim())) return p
    return joinSplitNumbersInText(p)
  })
}
