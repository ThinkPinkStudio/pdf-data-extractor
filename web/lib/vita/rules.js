// Polizza Vita collettiva (Amundi, Crédit Agricole Vita): regole di calcolo.
// Modulo PURO (nessun DB, nessuna interfaccia): le formule del file «Elenco
// assicurati VITA 2026» riscritte come funzioni. Gli importi non si salvano mai,
// si ricalcolano dai fatti (data di nascita, RAL, figura chiave, documenti).

export const DEFAULT_RULES = {
  multiplier: 2.5, // capitale = 2,5 × RAL
  keyFigureCapital: 1400000, // figura chiave: capitale fisso
  noDocUpTo: 400000, // fino a qui nessun documento sanitario
  visitUpTo: 800000, // con il rapporto di visita (e l'ok C.A. Vita) il capitale arriva a qui; oltre servono accertamenti o check-up
  checkupMonths: 6, // validità del check-up per la fascia oltre
  rights: 1.03, // diritti per assicurato
  minAge: 18,
  deathMaxAge: 80, // garanzia morte
  ipMaxAge: 70, // invalidità permanente da malattia
  refundBasis: 'start', // esclusioni: 'start' = tasso e capitale pagati a inizio anno, 'exit' = età al giorno di uscita
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// ROUNDUP(x, 2) di Excel, senza gli errori di virgola mobile (341,03 resta 341,03).
// Solo per importi positivi: su un negativo arrotonderebbe verso lo zero (i rimborsi
// passano da round2).
export function roundUp2(x) {
  const v = x * 100
  const r = Math.round(v)
  return (Math.abs(v - r) < 1e-6 ? r : Math.ceil(v)) / 100
}

const DAY = 86400000
const dayNum = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY) }
export const daysBetween = (a, b) => dayNum(b) - dayNum(a)
export function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}` }

/**
 * Età computabile (regola della polizza): anni compiuti se alla decorrenza non sono
 * trascorsi più di sei mesi dall'ultimo compleanno, altrimenti l'età da compiere
 * (compiuti + 1). Coincide con ROUND((data − nascita − 2)/365,25) del file su tutte
 * le 308 righe del 2026.
 */
export function ageAt(birthISO, atISO) {
  if (!birthISO || !atISO) return null
  const [by, bm, bd] = String(birthISO).slice(0, 10).split('-').map(Number)
  const [ay, am, ad] = String(atISO).slice(0, 10).split('-').map(Number)
  let years = ay - by
  if (am < bm || (am === bm && ad < bd)) years--
  // ultimo compleanno e sei mesi dopo (il 29/02 cade il 28/02 negli anni non bisestili)
  const ly = by + years
  const mm = bm + 6
  const sy = ly + (mm > 12 ? 1 : 0)
  const sm = ((mm - 1) % 12) + 1
  const dim = new Date(Date.UTC(sy, sm, 0)).getUTCDate()
  const sixISO = `${sy}-${String(sm).padStart(2, '0')}-${String(Math.min(bd, dim)).padStart(2, '0')}`
  return String(atISO).slice(0, 10) > sixISO ? years + 1 : years
}

/** Tasso ‰ per età dalla tabella { età: tasso }; null se l'età non c'è. */
export function rateFor(age, rates) {
  if (age == null) return null
  const v = rates[age]
  return typeof v === 'number' ? v : null
}

/** Garanzie all'età computabile: morte + IPT fino a 70, solo morte fino a 80. */
export function coverage(age, rules = DEFAULT_RULES) {
  if (age == null) return ''
  if (age < rules.minAge) return ''
  if (age <= rules.ipMaxAge) return 'MORTE + IPT'
  if (age <= rules.deathMaxAge) return 'SOLO CASO MORTE'
  return 'FUORI COPERTURA'
}

/**
 * Fascia sanitaria del capitale PREVISTO: 'nessuna' (fino a 400.000),
 * 'visita' (fino a 800.000), 'visita+accertamenti' (oltre).
 */
export function medicalBand(target, rules = DEFAULT_RULES) {
  if (target <= rules.noDocUpTo) return 'nessuna'
  if (target <= rules.visitUpTo) return 'visita'
  return 'visita+accertamenti'
}

/**
 * Capitale assicurato. `doc` = { visit: bool (rapporto di visita fornito), extra: bool
 * (accertamenti sanitari o check-up degli ultimi 6 mesi), ok: bool (ok di C.A. Vita
 * sul livello raggiunto) }. Senza documenti il capitale resta a 400.000; con il
 * rapporto di visita (e l'ok della compagnia) sale a 800.000 al massimo; per arrivare
 * al capitale previsto servono il rapporto di visita PIÙ accertamenti o check-up,
 * sempre con l'ok della compagnia. La differenza è la scopertura (mai negativa).
 */
export function capitalOf({ ral, keyFigure }, doc = {}, rules = DEFAULT_RULES) {
  const target = round2(keyFigure ? rules.keyFigureCapital : (ral || 0) * rules.multiplier)
  // Alla figura chiave la documentazione si chiede sempre, anche se il suo capitale
  // fosse sotto la prima soglia (il valore si cambia dalle Impostazioni).
  let band = medicalBand(target, rules)
  if (keyFigure && band === 'nessuna') band = 'visita'
  let capital = target
  if (band !== 'nessuna') {
    const visitOk = !!(doc.visit && doc.ok)
    // Il tetto non alza mai il capitale sopra quello previsto (figura chiave con capitale basso).
    const upTo = (max) => Math.min(target, max)
    // Il rapporto di visita è sempre necessario: gli accertamenti si aggiungono, non lo sostituiscono.
    if (band === 'visita') capital = visitOk ? target : upTo(rules.noDocUpTo)
    else capital = visitOk && doc.extra ? target : visitOk ? upTo(rules.visitUpTo) : upTo(rules.noDocUpTo)
  }
  return { target, band, capital: round2(capital), scopertura: round2(target - capital) }
}

/**
 * Che cosa manca per arrivare al capitale previsto:
 * 'visita' (rapporto di visita medica), 'ok' (risposta di C.A. Vita su quanto inviato),
 * 'accertamenti' (accertamenti sanitari o check-up, oltre la visita già accettata),
 * null se non manca nulla.
 */
export function missingDoc({ band, doc = {} }) {
  if (band === 'nessuna') return null
  if (!doc.visit) return 'visita'
  if (!doc.ok) return 'ok'
  if (band === 'visita+accertamenti' && !doc.extra) return 'accertamenti'
  return null
}

/**
 * Premio annuo: netto = capitale × tasso ‰ × (1 + sovrappremio %); lordo = netto +
 * diritti, arrotondato per eccesso al centesimo (ROUNDUP di Excel).
 * `sovrPct` è in PERCENTUALE (25 = +25%): nel file del cliente la colonna SOVRAPREMI
 * contiene una frazione (0,25), quindi all'import va moltiplicata per 100.
 */
export function premiumOf(capital, rate, sovrPct = 0, rules = DEFAULT_RULES) {
  if (rate == null) return { net: null, rights: rules.rights, gross: null }
  const net = round2((capital * rate / 1000) * (1 + (sovrPct || 0) / 100))
  return { net, rights: rules.rights, gross: roundUp2(net + rules.rights) }
}

/**
 * Frazione d'anno dal giorno del movimento al 31/12 (giorni / 365), come YEARFRAC
 * base 3 del file del cliente: il 31/12 non è contato, quindi un movimento del 01/01
 * vale 364/365 e uno del 31/12 vale 0. Chi è in copertura dal primo giorno dell'anno
 * non è un movimento: sta nello stato di rischio e paga il premio annuo pieno.
 * Una data fuori dall'anno va rifiutata prima di arrivare qui (`days` resterebbe
 * negativo o sopra 365, mentre la frazione è limitata a 0..1).
 */
export function prorata(dateISO, yearEndISO) {
  const f = daysBetween(dateISO, yearEndISO) / 365
  return Math.max(0, Math.min(1, f))
}

/**
 * Riga di movimento. Inclusione: premio pieno sulla frazione + diritti.
 * Esclusione: rimborso sulla frazione, niente diritti. Con refundBasis 'start'
 * l'esclusione usa tasso e capitale già pagati (`paid` = { capital, rate }).
 */
export function movementOf({ kind, date, capital, rate, sovrPct = 0, paid = /** @type {{ capital: number, rate: number } | null} */ (null) }, yearEndISO, rules = DEFAULT_RULES) {
  const frac = prorata(date, yearEndISO)
  const days = daysBetween(date, yearEndISO)
  const useCap = kind === 'ESCLUSIONE' && rules.refundBasis === 'start' && paid ? paid.capital : capital
  const useRate = kind === 'ESCLUSIONE' && rules.refundBasis === 'start' && paid ? paid.rate : rate
  if (useRate == null) return { days, frac, net: null, rights: 0, gross: null }
  const base = (useCap * useRate / 1000) * (1 + (sovrPct || 0) / 100) * frac
  if (kind === 'INCLUSIONE') {
    const net = round2(base)
    return { days, frac, net, rights: rules.rights, gross: round2(net + rules.rights) }
  }
  const net = -round2(base)
  return { days, frac, net, rights: 0, gross: net }
}

/** Calcolo completo di un assicurato a una data di decorrenza. */
export function computeInsured(p, rates, atISO, rules = DEFAULT_RULES) {
  const age = ageAt(p.birthDate, atISO)
  const rate = rateFor(age, rates)
  const cap = capitalOf({ ral: p.ral, keyFigure: p.keyFigure }, p.doc, rules)
  const prem = premiumOf(cap.capital, rate, p.sovrPct, rules)
  return { age, rate, ...cap, ...prem, cover: coverage(age, rules) }
}

/* ─── Codice fiscale (solo per i dati di prova) ─────────────────────────── */

const ODD = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 }
const MONTHS = 'ABCDEHLMPRST'
const VOW = 'AEIOU'
const cons = (s) => s.toUpperCase().replace(/[^A-Z]/g, '').split('').filter((c) => !VOW.includes(c))
const vows = (s) => s.toUpperCase().replace(/[^A-Z]/g, '').split('').filter((c) => VOW.includes(c))
const surnameCode = (s) => [...cons(s), ...vows(s), 'X', 'X', 'X'].slice(0, 3).join('')
function nameCode(s) { const c = cons(s); const base = c.length >= 4 ? [c[0], c[2], c[3]] : [...c, ...vows(s), 'X', 'X', 'X'].slice(0, 3); return base.join('') }

/** Codice fiscale valido per cognome, nome, data (ISO), sesso e codice catastale. */
export function makeCf(cognome, nome, birthISO, sex, belfiore) {
  const [y, m, d] = birthISO.split('-').map(Number)
  const body = `${surnameCode(cognome)}${nameCode(nome)}${String(y).slice(2)}${MONTHS[m - 1]}${String(sex === 'F' ? d + 40 : d).padStart(2, '0')}${belfiore}`
  let sum = 0
  body.split('').forEach((c, i) => { sum += i % 2 === 0 ? ODD[c] : (/[0-9]/.test(c) ? Number(c) : c.charCodeAt(0) - 65) })
  return body + String.fromCharCode(65 + (sum % 26))
}

/* ─── Lettura dei file Excel del cliente ────────────────────────────────── */

const normHead = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
const cellStr = (v) => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v)).replace(/\s+/g, ' ').trim()
const yes = (v) => /^S[IÌ]?$/i.test(cellStr(v))
const CF_RE = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/

/** Data da una cella Excel (Date, seriale o testo gg/mm/aaaa). */
export function cellDate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  if (typeof v === 'number' && isFinite(v) && v > 1 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400000))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  const s = String(v).trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return `${m[1]}-${String(+m[2]).padStart(2, '0')}-${String(+m[3]).padStart(2, '0')}`
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s)
  if (m) return `${m[3]}-${String(+m[2]).padStart(2, '0')}-${String(+m[1]).padStart(2, '0')}`
  return null
}

/** Numero da una cella (1.234,56 all'italiana o già numero). */
export function cellNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null
  const s = cellStr(v).replace(/[€\s]/g, '')
  if (!s) return null
  const n = Number(s.replace(/\./g, '').replace(',', '.'))
  return isFinite(n) ? n : null
}

const HEADS = [
  ['azienda', /^AZIENDA|^SOCIETA|^CONTRAENTE/],
  ['polizza', /^(NR|N|NUMERO) POLIZZA/],
  ['cognome', /^COGNOME/],
  ['nome', /^NOME/],
  ['cf', /^(CODICE FISCALE|C ?F)/],
  ['livello', /^LIVELLO/],
  ['nascita', /NASCITA/],
  ['inserimento', /^DATA INSERIMENTO|^DATA (DI )?ENTRATA|^DECORRENZA/],
  ['sovr', /^SOVRAPREMI/],
  ['figura', /^FIGURA CHIAVE/],
  ['visita', /^RAPPORTO DI VISITA MEDICA FORNITO/],
  ['ok', /^OK C A VITA/],
  ['note', /^NOTE/],
]

/**
 * Intestazione del foglio: riga con COGNOME e NOME e mappa colonna → campo.
 * La RAL ha una regola sua: nei file del cliente ci sono più colonne «RAL …»
 * («RAL ANNUA 2025» e «RAL 2026 FULL TIME» nel file di fine anno), e quella buona
 * è la colonna che nomina l'anno chiesto. `ralYear` la sceglie; senza anno si
 * prende l'unica, o l'ultima.
 */
export function findVitaHeader(rows, ralYear) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(normHead)
    if (!cells.includes('COGNOME') || !cells.includes('NOME')) continue
    const map = {}
    cells.forEach((h, col) => {
      for (const [key, re] of HEADS) if (!(key in map) && re.test(h)) { map[key] = col; break }
    })
    // «LIVELLO 11/2025» è lo storico, non il livello di adesso: tiene il primo «LIVELLO» puro
    const plain = cells.findIndex((h) => h === 'LIVELLO')
    if (plain >= 0) map.livello = plain
    const rals = cells.map((h, col) => ({ h, col })).filter((x) => /^RAL/.test(x.h))
    if (rals.length) {
      const byYear = ralYear ? rals.find((x) => x.h.includes(String(ralYear))) : null
      map.ral = (byYear || rals[rals.length - 1]).col
      map.ralHead = (byYear || rals[rals.length - 1]).h
    }
    return { row: i, map }
  }
  return null
}

/**
 * Assicurati da un file del cliente (sia il nostro «Elenco assicurati VITA» sia
 * l'«Anagrafiche Vita e IPT» che l'Azienda rimanda a fine anno). Un foglio per
 * contraente; il contraente si riconosce dal numero di polizza, poi dal nome
 * nella colonna AZIENDA, poi dal nome del foglio. Gli importi del file non si
 * leggono: si ricalcolano.
 */
export function parseVitaWorkbook(cfg, sheets, opts = {}) {
  const year = +String(cfg.periodStart).slice(0, 4)
  const ralYear = opts.ralYear || year
  const insured = []
  const warnings = []
  const companies = cfg.companies || []
  const byPolicy = new Map(companies.filter((c) => c.policy).map((c) => [String(c.policy).trim(), c.key]))
  const norm = (s) => normHead(s).replace(/ /g, '')
  // Il numero di polizza è il legame buono. Se non è di nessun contraente si
  // ripiega sul nome dell'azienda o del foglio, ma lo si DICE: nel file del
  // cliente compaiono numeri che non sono fra i tre (una 60036 fra le 60037).
  const findCompany = (polizza, azienda, sheet) => {
    const num = String(polizza || '').trim()
    const p = byPolicy.get(num)
    if (p) return { key: p, byPolicy: true }
    for (const c of companies) if (azienda && norm(c.name) === norm(azienda)) return { key: c.key, num }
    for (const c of companies) if (sheet && norm(c.name) === norm(sheet)) return { key: c.key, num }
    for (const c of companies) if (azienda && norm(azienda).includes(norm(c.name))) return { key: c.key, num }
    for (const c of companies) if (sheet && norm(sheet).includes(norm(c.name))) return { key: c.key, num }
    return null
  }

  // I fogli delle MOVIMENTAZIONI non sono lo stato: le entrate e le uscite si
  // registrano una per una, con la loro data. Un foglio senza nemmeno un codice
  // fiscale (TASSI, legende) non è un foglio di persone: si salta in silenzio.
  const hasCf = (rows) => rows.some((r) => (r || []).some((c) => CF_RE.test(String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''))))
  for (const name of Object.keys(sheets)) {
    if (/^(MOVIMENT|VARIAZ)/i.test(String(name).trim())) continue
    const rows = sheets[name] || []
    const h = findVitaHeader(rows, ralYear)
    if (!h) {
      if (hasCf(rows)) warnings.push(`Foglio «${name}»: intestazione non trovata (serve una riga con COGNOME e NOME); saltato.`)
      continue
    }
    if (h.map.ral == null) warnings.push(`Foglio «${name}»: nessuna colonna RAL, i capitali non si possono calcolare.`)
    else if (!String(h.map.ralHead || '').includes(String(ralYear))) warnings.push(`Foglio «${name}»: nessuna colonna «RAL ${ralYear}», ho usato «${h.map.ralHead}».`)
    const get = (r, k) => (h.map[k] == null ? null : r[h.map[k]])
    let unknown = 0, noCf = 0
    /** @type {Map<string, number>} */
    const oddPolicy = new Map()
    for (let i = h.row + 1; i < rows.length; i++) {
      const r = rows[i] || []
      const cf = cellStr(get(r, 'cf')).toUpperCase().replace(/[^A-Z0-9]/g, '')
      const cognome = cellStr(get(r, 'cognome'))
      if (!cf && !cognome) continue
      // Righe di servizio in fondo al foglio («TOTALI», «Assicurati: 308»): senza un
      // codice fiscale che regga non è una persona.
      if (!CF_RE.test(cf)) { if (cellNum(get(r, 'ral'))) noCf++; continue }
      const found = findCompany(cellStr(get(r, 'polizza')), cellStr(get(r, 'azienda')), name)
      if (!found) { unknown++; continue }
      const company = found.key
      if (!found.byPolicy && found.num) oddPolicy.set(found.num, (oddPolicy.get(found.num) || 0) + 1)
      const entry = cellDate(get(r, 'inserimento'))
      const nascita = cellDate(get(r, 'nascita'))
      const sovr = cellNum(get(r, 'sovr')) || 0
      insured.push({
        company,
        cf,
        cognome: cognome.toUpperCase(),
        nome: cellStr(get(r, 'nome')).toUpperCase(),
        birthDate: nascita,
        level: cellStr(get(r, 'livello')),
        ral: cellNum(get(r, 'ral')) || 0,
        keyFigure: yes(get(r, 'figura')),
        // Nel file la colonna SOVRAPREMI è una FRAZIONE (0,25 = +25%): qui si tiene in percentuale.
        sovrPct: Math.abs(sovr) > 0 && Math.abs(sovr) <= 1 ? sovr * 100 : sovr,
        doc: { visit: yes(get(r, 'visita')), ok: yes(get(r, 'ok')), extra: false, checkupDate: null },
        remindedOn: null,
        entryDate: entry && entry > cfg.periodStart ? entry : cfg.periodStart,
        entryKind: entry && entry > cfg.periodStart ? 'inclusione' : 'iniziale',
        communicatedDate: null,
        exitDate: null, exitKind: null, exitCommunicated: null, transferId: null, exitTransferId: null,
        nextRal: null,
        source: `${name} riga ${i + 1}`,
        note: cellStr(get(r, 'note')),
        rowNumber: i + 1,
        sheet: name,
      })
    }
    for (const [num, n] of oddPolicy) {
      const who = companies.find((c) => c.key === (insured.find((p) => p.sheet === name) || {}).company)
      warnings.push(`Foglio «${name}»: ${n} ${n === 1 ? 'riga ha' : 'righe hanno'} il numero di polizza ${num}, che non è di nessun contraente del programma; ${n === 1 ? 'assegnata' : 'assegnate'} a ${who ? who.name : name} dal nome dell'azienda.`)
    }
    if (noCf) warnings.push(`Foglio «${name}»: ${noCf} ${noCf === 1 ? 'riga ha' : 'righe hanno'} una RAL ma nessun codice fiscale valido; saltate.`)
    if (unknown) warnings.push(`Foglio «${name}»: ${unknown} righe senza un contraente riconoscibile (numero di polizza e azienda non corrispondono a nessuno dei contraenti del programma); saltate.`)
  }
  return { insured, warnings }
}

/** Solo codice fiscale → RAL dell'anno indicato, per il rinnovo. */
export function parseVitaRal(cfg, sheets, ralYear) {
  const { insured, warnings } = parseVitaWorkbook(cfg, sheets, { ralYear })
  /** @type {Record<string, number>} */
  const byCf = {}
  for (const p of insured) if (p.cf && p.ral > 0) byCf[p.cf] = p.ral
  return { byCf, n: Object.keys(byCf).length, warnings }
}

/**
 * Tassi ‰ per età dal foglio TASSI del file: la prima colonna è l'età (18-120),
 * la seconda il tasso. Riconosce il foglio dal contenuto, non dal nome, così va
 * bene anche se il cliente lo chiama in un altro modo.
 */
export function parseVitaRates(sheets) {
  /** @type {Record<string, number>} */
  let best = {}
  let from = ''
  for (const name of Object.keys(sheets || {})) {
    const rows = sheets[name] || []
    /** @type {Record<string, number>} */
    const found = {}
    for (const r of rows) {
      if (!r) continue
      const age = cellNum(r[0])
      const rate = cellNum(r[1])
      // Età intera plausibile e tasso positivo: la riga d'intestazione cade da sola.
      if (age == null || rate == null) continue
      if (!Number.isInteger(age) || age < 0 || age > 120) continue
      if (!(rate > 0) || rate > 1000) continue
      found[String(age)] = rate
    }
    if (Object.keys(found).length > Object.keys(best).length) { best = found; from = name }
  }
  const ages = Object.keys(best).map(Number).sort((a, b) => a - b)
  return { rates: best, n: ages.length, from, minAge: ages[0] ?? null, maxAge: ages[ages.length - 1] ?? null }
}
