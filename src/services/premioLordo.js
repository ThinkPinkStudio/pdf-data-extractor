/**
 * Calcolo PREMIO LORDO e IMPOTRO PREMIO LORDO TOTALE sul report
 * "Tutte le Applicazioni".
 *
 * Parte PURA: nessun I/O, nessuna dipendenza da Excel. Prende le righe già
 * lette (Numero polizza / Movimento / Garanzia / Premio Netto) e restituisce
 * le due colonne da accodare, più l'elenco delle garanzie sconosciute.
 * L'I/O sul .xlsx sta in scripts/premio-lordo.mjs.
 *
 * Regole (dal committente):
 *  1. si calcola SOLO sulle righe con Movimento = "Inclusione Applicazione";
 *     sulle altre (Quietanza Intermedia, Generica) le due colonne restano vuote;
 *  2. PREMIO LORDO = Premio Netto × (1 + aliquota), aliquota per Garanzia,
 *     arrotondato a 2 decimali (commerciale, half-up);
 *  3. IMPOTRO PREMIO LORDO TOTALE = somma dei PREMIO LORDO del gruppo
 *     (stesso Numero polizza + Inclusione Applicazione), scritta SOLO
 *     sull'ultima riga del gruppo nell'ordine originale.
 *
 * Una garanzia non prevista dalla tabella NON riceve un'aliquota a caso: viene
 * segnalata in `unknownGaranzie` e il chiamante deve chiedere conferma prima di
 * scrivere il file (il CLI si ferma, salvo --assume-default).
 */

/** Movimento che abilita il calcolo. */
export const MOVIMENTO_INCLUSIONE = 'Inclusione Applicazione'

/** Aliquota usata per "tutte le altre garanzie" della tabella. */
export const ALIQUOTA_ALTRE = 0.135

/**
 * Normalizza un'etichetta per il confronto: minuscole, accenti via, trattini e
 * slash come spazi, spazi collassati. Serve perché nel report la stessa
 * garanzia arriva con maiuscole/accenti/trattini incoerenti.
 */
export function normalizeLabel(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritici: "calamità" → "calamita"
    .toLowerCase()
    .replace(/[-‐-―/_:;]+/g, ' ') // trattini (anche tipografici), slash, due punti → spazio
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Tabella delle aliquote. `match` accetta stringhe (confronto esatto sul
 * normalizzato) e RegExp (per le famiglie: "Infortuni conducente",
 * "Garanzie Accessorie Formula Uno/Due", …).
 *
 * ATTENZIONE all'ordine: "assistenza in viaggio" (10%) è un match ESATTO, così
 * "Assistenza in viaggio ibrido-elettrico" cade correttamente nel 13,5%.
 */
export const ALIQUOTE = [
  { rate: 0.265, match: ['rca'] },
  { rate: 0.10, match: ['assistenza in viaggio'] },
  { rate: 0.125, match: ['tutela legale base'] },
  { rate: 0.025, match: [/^infortun/] },
  {
    rate: ALIQUOTA_ALTRE,
    match: [
      'cristalli',
      'furto totale o parziale',
      'incendio',
      'calamita naturali',
      'guasti integrale',
      'atti vandalici ed eventi sociopolitici',
      'assistenza in viaggio ibrido elettrico',
      // Le etichette reali portano suffissi che la tabella del committente omette:
      // "A4T GARANZIE AGGIUNTIVE (post 1/8/2006)", "GARANZIE ACCESSORIE: FORMULA UNO".
      /^a4t garanzie aggiuntive\b/,
      /^garanzie accessorie formula (uno|due)\b/
    ]
  }
]

/**
 * Aliquota per una garanzia.
 * @returns {{rate:number, known:boolean}} `known:false` = non in tabella:
 *   si propone ALIQUOTA_ALTRE ma va confermata dall'utente.
 */
export function aliquotaFor(garanzia) {
  const norm = normalizeLabel(garanzia)
  if (!norm) return { rate: ALIQUOTA_ALTRE, known: false }
  for (const entry of ALIQUOTE) {
    for (const m of entry.match) {
      const hit = typeof m === 'string' ? norm === m : m.test(norm)
      if (hit) return { rate: entry.rate, known: true }
    }
  }
  return { rate: ALIQUOTA_ALTRE, known: false }
}

/**
 * Modo di arrotondamento. Cambia SOLO i valori esattamente a metà (…,xx5):
 * pochi su migliaia, ma spostano di 0,01 anche il totale del gruppo.
 *
 * - 'commerciale' (default, quello chiesto dalla specifica): half-up, cioè si
 *   sale allontanandosi da zero. 26,105 → 26,11.
 * - 'legacy': half-even (arrotondamento "del banchiere"), che è quello del
 *   vecchio file di output. 26,105 → 26,10 perché 26,10 ha l'ultima cifra pari.
 *   Serve a chi deve restare coerente con quanto già consegnato.
 */
let roundingMode = 'commerciale'

/** @param {'commerciale'|'legacy'} mode */
export function setRoundingMode(mode) {
  if (!['commerciale', 'legacy'].includes(mode)) throw new Error(`Modo di arrotondamento ignoto: ${mode}`)
  roundingMode = mode
}

export function getRoundingMode() {
  return roundingMode
}

/** Applica la regola di pareggio corrente a quoziente + resto (resto su 1000). */
function resolveTie(q, rem, sign, mode) {
  if (rem > 500) return q + sign
  if (rem < 500) return q
  if (mode === 'commerciale') return q + sign // half-up: si allontana da zero
  return Math.abs(q) % 2 === 1 ? q + sign : q // half-even
}

/**
 * PREMIO LORDO di una riga, in aritmetica INTERA: niente float, niente casi
 * limite inventati dall'IEEE754.
 *
 * Il Premio Netto è valuta (2 decimali) e le aliquote hanno al massimo 3
 * decimali, quindi `centesimi × (1000 + millesimi_aliquota)` è il valore esatto
 * in unità di 1/100000: il pareggio a metà si riconosce dal resto === 500,
 * invece di dipendere da come il double ha rappresentato 26,105.
 *
 * @param {number|string} premioNetto
 * @param {number} rate  es. 0.265
 * @returns {number} NaN se il premio netto non è leggibile
 */
export function premioLordoFor(premioNetto, rate, mode = roundingMode) {
  const netto = parseAmount(premioNetto)
  if (!Number.isFinite(netto)) return NaN
  const cents = Math.round(netto * 100)
  const milli = Math.round(rate * 1000)
  const prod = cents * (1000 + milli) // unità di 1/100000
  const sign = prod < 0 ? -1 : 1
  const q = Math.trunc(prod / 1000)
  const rem = Math.abs(prod % 1000)
  return resolveTie(q, rem, sign, mode) / 100
}

/**
 * Arrotondamento generico a `dec` decimali secondo il modo corrente.
 * Usato per i controlli e per i totali; il calcolo di riga passa invece per
 * `premioLordoFor`, che è esatto.
 */
export function roundHalfUp(value, dec = 2) {
  const n = Number(value)
  if (!Number.isFinite(n)) return NaN
  const factor = 10 ** dec
  // Si ripulisce il rumore binario (26.104999999999997 → 26,105) prima di
  // decidere il pareggio, e di nuovo dopo la scala: anche ×100 ne introduce.
  const clean = Number(n.toPrecision(15))
  const scaled = Number((clean * factor).toPrecision(15))
  const sign = scaled < 0 ? -1 : 1
  const q = Math.trunc(scaled)
  const rem = Math.round(Math.abs(scaled - q) * 1000)
  return resolveTie(q, rem, sign, roundingMode) / factor
}

/** Somma esatta di importi a 2 decimali (in centesimi: niente deriva float). */
export function sumMoney(values) {
  let cents = 0
  for (const v of values) {
    if (!Number.isFinite(v)) continue
    cents += Math.round(v * 100)
  }
  return cents / 100
}

/**
 * Numero da cella: accetta già-numero, formato italiano ("1.234,56"),
 * formato inglese ("1,234.56") e simboli di valuta.
 */
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  let s = String(value ?? '').trim()
  if (!s) return NaN
  s = s.replace(/[€\s ']/g, '')
  const neg = /^\(.*\)$/.test(s)
  if (neg) s = s.slice(1, -1)
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > -1 && lastDot > -1) {
    // l'ultimo dei due è il separatore decimale, l'altro è delle migliaia
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (lastComma > -1) {
    // Sorgente italiana: una virgola sola è SEMPRE il separatore decimale.
    s = s.replace(',', '.')
  }
  const n = parseFloat(s)
  if (!Number.isFinite(n)) return NaN
  return neg ? -n : n
}

/** True se il movimento è "Inclusione Applicazione" (tollerante su spazi/case). */
export function isInclusione(movimento) {
  return normalizeLabel(movimento) === normalizeLabel(MOVIMENTO_INCLUSIONE)
}

/** Formato italiano a 2 decimali: 1.234,56 (per i report a terminale). */
export function formatItalian(value, dec = 2) {
  if (!Number.isFinite(value)) return ''
  return value.toLocaleString('it-IT', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

/**
 * Calcola le due colonne.
 *
 * @param {Array<{numeroPolizza:*, movimento:*, garanzia:*, premioNetto:*}>} rows
 *        nell'ORDINE originale del foglio.
 * @returns {{
 *   premioLordo: Array<number|null>,     // allineata a rows, null = cella vuota
 *   totale: Array<number|null>,          // valorizzata solo sull'ultima riga di gruppo
 *   unknownGaranzie: Array<{garanzia:string, rows:number[], count:number}>,
 *   missingPremio: Array<{index:number, raw:*}>,
 *   tieBreaks: Array<{index:number, garanzia:*, premioNetto:*, valore:number, alt:number}>,
 *   groups: Array<{polizza:string, rows:number[], lastIndex:number, total:number}>,
 *   stats: {total:number, inclusioni:number, calcolate:number}
 * }}
 */
export function computePremioLordo(rows) {
  const premioLordo = new Array(rows.length).fill(null)
  const totale = new Array(rows.length).fill(null)
  const unknownMap = new Map()
  const missingPremio = []
  const tieBreaks = []
  const groupMap = new Map()
  let inclusioni = 0

  rows.forEach((row, i) => {
    if (!isInclusione(row.movimento)) return
    inclusioni++

    const { rate, known } = aliquotaFor(row.garanzia)
    if (!known) {
      const label = String(row.garanzia ?? '').trim() || '(vuota)'
      const rec = unknownMap.get(label) || { garanzia: label, rows: [], count: 0 }
      rec.rows.push(i)
      rec.count++
      unknownMap.set(label, rec)
    }

    const valore = premioLordoFor(row.premioNetto, rate)
    if (!Number.isFinite(valore)) {
      missingPremio.push({ index: i, raw: row.premioNetto })
      return
    }
    premioLordo[i] = valore

    // Pareggio a metà: segnalarlo permette di sapere quali righe cambiano
    // valore se si passa da 'commerciale' a 'legacy'.
    const alt = premioLordoFor(row.premioNetto, rate, roundingMode === 'commerciale' ? 'legacy' : 'commerciale')
    if (alt !== valore) tieBreaks.push({ index: i, garanzia: row.garanzia, premioNetto: row.premioNetto, valore, alt })

    const key = String(row.numeroPolizza ?? '').trim()
    const group = groupMap.get(key) || { polizza: key, rows: [], lastIndex: i, total: 0 }
    group.rows.push(i)
    group.lastIndex = i // le righe si scorrono in ordine: l'ultima vista è l'ultima del gruppo
    groupMap.set(key, group)
  })

  // REGOLA 3: il totale è la somma dei PREMIO LORDO GIÀ ARROTONDATI del gruppo
  // (somma in centesimi, così 12 addendi non producono 583,0199999).
  const groups = [...groupMap.values()]
  for (const g of groups) {
    g.total = sumMoney(g.rows.map((i) => premioLordo[i]))
    totale[g.lastIndex] = g.total
  }

  return {
    premioLordo,
    totale,
    unknownGaranzie: [...unknownMap.values()],
    missingPremio,
    tieBreaks,
    groups,
    stats: {
      total: rows.length,
      inclusioni,
      calcolate: premioLordo.filter((v) => v != null).length
    }
  }
}

/**
 * Verifica finale richiesta dal committente. Ricontrolla il RISULTATO, non
 * l'input: righe invariate, ogni inclusione valorizzata, un solo totale per
 * gruppo sull'ultima riga e pari alla somma del gruppo.
 *
 * @returns {{ok:boolean, checks:Array<{name:string, ok:boolean, detail:string}>}}
 */
export function verifyResult(rows, result, { expectedRowCount = rows.length } = {}) {
  const checks = []
  const { premioLordo, totale } = result

  checks.push({
    name: 'righe invariate',
    ok: premioLordo.length === expectedRowCount && totale.length === expectedRowCount,
    detail: `${premioLordo.length} righe in output, ${expectedRowCount} attese`
  })

  const senzaLordo = []
  rows.forEach((row, i) => {
    if (isInclusione(row.movimento) && premioLordo[i] == null) senzaLordo.push(i)
  })
  checks.push({
    name: 'ogni Inclusione Applicazione ha un PREMIO LORDO',
    ok: senzaLordo.length === 0,
    detail: senzaLordo.length ? `righe senza valore: ${senzaLordo.join(', ')}` : 'tutte valorizzate'
  })

  const nonInclusioniValorizzate = []
  rows.forEach((row, i) => {
    if (!isInclusione(row.movimento) && (premioLordo[i] != null || totale[i] != null)) {
      nonInclusioniValorizzate.push(i)
    }
  })
  checks.push({
    name: 'le righe non-inclusione restano vuote',
    ok: nonInclusioniValorizzate.length === 0,
    detail: nonInclusioniValorizzate.length
      ? `righe da svuotare: ${nonInclusioniValorizzate.join(', ')}`
      : 'nessuna riga estranea valorizzata'
  })

  const totaliErrati = []
  for (const g of result.groups) {
    const scritte = g.rows.filter((i) => totale[i] != null)
    const atteso = sumMoney(g.rows.map((i) => premioLordo[i]))
    if (scritte.length !== 1 || scritte[0] !== g.lastIndex || Math.abs(totale[g.lastIndex] - atteso) > 0.005) {
      totaliErrati.push(`${g.polizza} (${scritte.length} totali, atteso ${atteso})`)
    }
  }
  checks.push({
    name: 'un solo totale per polizza, sull\'ultima riga, pari alla somma',
    ok: totaliErrati.length === 0,
    detail: totaliErrati.length ? totaliErrati.join(' · ') : `${result.groups.length} gruppi verificati`
  })

  return { ok: checks.every((c) => c.ok), checks }
}
