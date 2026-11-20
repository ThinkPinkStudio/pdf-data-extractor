// Polizza Vita collettiva (Amundi, Crédit Agricole Vita): regole di calcolo.
// Modulo PURO (nessun DB, nessuna interfaccia): le formule del file «Elenco
// assicurati VITA 2026» riscritte come funzioni. Gli importi non si salvano mai,
// si ricalcolano dai fatti (data di nascita, RAL, figura chiave, documenti).

/** @type {any} Regole complete con i default: le funzioni accettano anche regole parziali dei programmi vecchi. */
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
  // ─ Regole componibili (18/11/2026): i default sono il comportamento di Amundi ─
  capitalMode: 'ral', // 'ral' = capitale da RAL e documenti; 'categoria' = capitale e tasso fissi per categoria (Agos)
  categories: [], // [{ key, name, capital, rate (‰), match: 'parole del livello separate da virgola' }]
  grossRounding: 'eccesso', // premio lordo annuo: 'eccesso' (ROUNDUP), 'normale' (al centesimo) o 'nessuno' (come i fogli di Agos: decimali pieni, il totale li somma)
  rightsProRata: false, // inclusione: true = (premio + diritti) in pro-rata; false = premio in pro-rata + diritti interi
  countLastDay: false, // pro-rata: true = giorni fino al 01/01 dell'anno dopo; false = fino al 31/12
  exitNextDay: true, // file mensile: il cliente indica l'ultimo giorno di lavoro, l'uscita è il giorno dopo
  yearDays: '365', // pro-rata: '365' (come i fogli del cliente), 'reali' (giorni veri dell'anno di polizza) o '360'
  ageMode: 'computabile', // 'computabile' = compiuti, +1 se dall'ultimo compleanno sono passati più di `ageHalfMonths` mesi; 'compiuti' = anni compiuti
  ageHalfMonths: 6,
  checkupExpiry: false, // true = accertamenti/check-up validi solo se fatti negli ultimi `checkupMonths` mesi
  transferDate: 'file', // file mensile, passaggi e promozioni: 'file' = data scritta; 'inizioMese' = 1° del mese di quella data; 'giornoDopo'; 'meseDopo' = 1° del mese successivo
}

/** Decorrenza di un passaggio di livello del file mensile secondo la regola del programma. */
export function transferDateOf(date, rules) {
  if (!date) return date
  const mode = rulesOf(rules).transferDate
  const y = +date.slice(0, 4), m = +date.slice(5, 7)
  if (mode === 'inizioMese') return `${date.slice(0, 7)}-01`
  if (mode === 'giornoDopo') return nextDay(date)
  if (mode === 'meseDopo') return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
  return date
}

import { evalValue } from '../configValue.js'

/** Regole del programma con i default per quello che manca (programmi vecchi). */
export const rulesOf = (rules) => ({ ...DEFAULT_RULES, ...(rules || {}) })

const normWord = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

/**
 * Categoria di una persona dal suo livello: la prima categoria che ha una delle
 * sue parole («quadro», «dirigente») dentro il livello; senza parole vale il
 * nome della categoria. Una categoria senza parole né nome che combacia prende
 * tutti solo se è l'unica (LTC: «tutti i dipendenti»). null = fuori polizza.
 */
export function categoryFor(level, rules) {
  const cats = rulesOf(rules).categories || []
  const lv = ` ${normWord(level)} `
  for (const c of cats) {
    const words = String(c.match || '').split(',').map(normWord).filter(Boolean)
    if (words.length && words.some((w) => lv.includes(` ${w}`))) return c
  }
  for (const c of cats) if (!String(c.match || '').trim() && normWord(c.name) && lv.includes(` ${normWord(c.name)} `)) return c
  const open = cats.filter((c) => !String(c.match || '').trim())
  return cats.length === 1 && open.length === 1 ? cats[0] : null
}

/** Ultimo giorno contato dal pro-rata: il 31/12 o il 01/01 dell'anno dopo. */
export function yearEndOf(cfg) {
  const r = rulesOf(cfg.rules)
  if (r.countLastDay) return cfg.periodEnd
  const t = new Date(`${cfg.periodEnd}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() - 1)
  return t.toISOString().slice(0, 10)
}

/** Giorno dopo (uscita dal giorno successivo all'ultimo di lavoro). */
export function nextDay(iso) {
  const t = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
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
export function ageAt(birthISO, atISO, rules) {
  if (!birthISO || !atISO) return null
  const [by, bm, bd] = String(birthISO).slice(0, 10).split('-').map(Number)
  const [ay, am, ad] = String(atISO).slice(0, 10).split('-').map(Number)
  let years = ay - by
  if (am < bm || (am === bm && ad < bd)) years--
  // ultimo compleanno e sei mesi dopo (il 29/02 cade il 28/02 negli anni non bisestili)
  const R = rules ? rulesOf(rules) : null
  if (R && R.ageMode === 'compiuti') return years
  const half = R ? Math.max(0, Math.min(12, Number(R.ageHalfMonths ?? 6))) : 6
  const ly = by + years
  const mm = bm + half
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
  return bandOf(target, rules).band
}

/**
 * FASCE SANITARIE come elenco (19/11/2026, «ogni lista deve potersi
 * aggiungere elementi»): fino a quale capitale (null = oltre l'ultima) e quali
 * documenti servono — nessuno, il rapporto di visita, visita + accertamenti o
 * check-up. I programmi vecchi: fino a noDocUpTo nessuno, fino a visitUpTo la
 * visita, oltre visita + accertamenti.
 */
export function medicalBandsOf(rules) {
  const r = rulesOf(rules)
  const list = Array.isArray(r.medicalBands) && r.medicalBands.length ? r.medicalBands : [
    { upTo: r.noDocUpTo, needs: [] },
    { upTo: r.visitUpTo, needs: ['visita'] },
    { upTo: null, needs: ['visita', 'accertamenti'] },
  ]
  return list.map((b) => {
    const needs = (Array.isArray(b.needs) ? b.needs : []).filter((n) => n === 'visita' || n === 'accertamenti')
    // gli accertamenti si aggiungono alla visita, non la sostituiscono
    if (needs.includes('accertamenti') && !needs.includes('visita')) needs.unshift('visita')
    return { upTo: b.upTo == null || b.upTo === '' ? null : Number(b.upTo) || 0, needs }
  }).sort((a, b) => (a.upTo == null ? Infinity : a.upTo) - (b.upTo == null ? Infinity : b.upTo))
}
const bandName = (needs) => (needs.includes('accertamenti') ? 'visita+accertamenti' : needs.includes('visita') ? 'visita' : 'nessuna')
/** Fascia di un capitale: { band, needs, upTo, index }. */
export function bandOf(target, rules) {
  const bands = medicalBandsOf(rules)
  const i = bands.findIndex((b) => b.upTo == null || target <= b.upTo)
  const k = i < 0 ? bands.length - 1 : i
  return { band: bandName(bands[k].needs), needs: bands[k].needs, upTo: bands[k].upTo, index: k }
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
  const bands = medicalBandsOf(rules)
  const own = bandOf(target, rules)
  let needs = own.needs
  if (keyFigure && !needs.length) needs = ['visita']
  const band = bandName(needs)
  const visitOk = !!(doc.visit && doc.ok)
  const has = (ns) => ns.every((n) => (n === 'visita' ? visitOk : visitOk && !!doc.extra))
  let capital = target
  if (needs.length && !has(needs)) {
    // senza i documenti della sua fascia il capitale scende al tetto più alto
    // di una fascia più bassa i cui documenti ci sono (mai sopra il previsto)
    const ok = bands.slice(0, own.index).filter((b) => b.upTo != null && has(b.needs))
    capital = ok.length ? Math.min(target, ok[ok.length - 1].upTo) : Math.min(target, bands[0].upTo ?? target)
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
/**
 * Diritti di un assicurato: importo fisso (di sempre) o percentuale / per mille
 * del premio netto o del capitale (web/lib/configValue.js).
 */
export function rightsOf(rules, ctx = {}) {
  return evalValue(rulesOf(rules).rights, { premio: Number(ctx.premio) || 0, capitale: Number(ctx.capitale) || 0 })
}

export function premiumOf(capital, rate, sovrPct = 0, rules = DEFAULT_RULES) {
  const r = rulesOf(rules)
  if (rate == null) return { net: null, rights: rightsOf(r, { capitale: capital }), gross: null }
  const raw = (capital * rate / 1000) * (1 + (sovrPct || 0) / 100)
  const rights = r.grossRounding === 'nessuno' ? rightsOf(r, { premio: raw, capitale: capital }) : round2(rightsOf(r, { premio: raw, capitale: capital }))
  if (r.grossRounding === 'nessuno') return { net: raw, rights, gross: raw + rights }
  const net = round2(raw)
  return { net, rights, gross: r.grossRounding === 'normale' ? round2(net + rights) : roundUp2(net + rights) }
}

/**
 * Frazione d'anno dal giorno del movimento al 31/12 (giorni / 365), come YEARFRAC
 * base 3 del file del cliente: il 31/12 non è contato, quindi un movimento del 01/01
 * vale 364/365 e uno del 31/12 vale 0. Chi è in copertura dal primo giorno dell'anno
 * non è un movimento: sta nello stato di rischio e paga il premio annuo pieno.
 * Una data fuori dall'anno va rifiutata prima di arrivare qui (`days` resterebbe
 * negativo o sopra 365, mentre la frazione è limitata a 0..1).
 */
export function prorata(dateISO, yearEndISO, rules) {
  const f = daysBetween(dateISO, yearEndISO) / yearDaysOf(yearEndISO, rules)
  return Math.max(0, Math.min(1, f))
}

/** Giorni dell'anno per il pro-rata: 365 (di sempre), i giorni veri dell'anno che finisce a `yearEndISO`, o 360. */
export function yearDaysOf(yearEndISO, rules) {
  const mode = rules ? String(rulesOf(rules).yearDays || '365') : '365'
  if (mode === '360') return 360
  if (mode === 'reali' && yearEndISO) {
    const [y, m, d] = String(yearEndISO).slice(0, 10).split('-').map(Number)
    const prev = new Date(Date.UTC(y - 1, m - 1, d)).toISOString().slice(0, 10)
    return daysBetween(prev, yearEndISO) || 365
  }
  return 365
}

/**
 * Riga di movimento. Inclusione: premio pieno sulla frazione + diritti.
 * Esclusione: rimborso sulla frazione, niente diritti. Con refundBasis 'start'
 * l'esclusione usa tasso e capitale già pagati (`paid` = { capital, rate }).
 */
export function movementOf({ kind, date, capital, rate, sovrPct = 0, paid = /** @type {{ capital: number, rate: number } | null} */ (null) }, yearEndISO, rules = DEFAULT_RULES) {
  rules = rulesOf(rules)
  const frac = prorata(date, yearEndISO, rules)
  const days = daysBetween(date, yearEndISO)
  const useCap = kind === 'ESCLUSIONE' && rules.refundBasis === 'start' && paid ? paid.capital : capital
  const useRate = kind === 'ESCLUSIONE' && rules.refundBasis === 'start' && paid ? paid.rate : rate
  if (useRate == null) return { days, frac, net: null, rights: 0, gross: null }
  const base = (useCap * useRate / 1000) * (1 + (sovrPct || 0) / 100) * frac
  // senza arrotondamento (fogli di Agos) gli importi restano coi decimali pieni
  const rnd = rules.grossRounding === 'nessuno' ? (x) => x : round2
  if (kind === 'INCLUSIONE') {
    if (rules.rightsProRata) {
      // Agos: il premio annuo lordo (diritti compresi) in pro-rata, come nei loro file
      const annual = premiumOf(useCap, useRate, sovrPct, rules).gross || 0
      const gross = rnd(annual * frac)
      const net = rnd(base)
      return { days, frac, net, rights: rnd(gross - net), gross }
    }
    const net = rnd(base)
    const rights = rnd(rightsOf(rules, { premio: (useCap * useRate / 1000) * (1 + (sovrPct || 0) / 100), capitale: useCap }))
    return { days, frac, net, rights, gross: rnd(net + rights) }
  }
  const net = -rnd(base)
  return { days, frac, net, rights: 0, gross: net }
}

/** Calcolo completo di un assicurato a una data di decorrenza. */
export function computeInsured(p, rates, atISO, rules = DEFAULT_RULES) {
  rules = rulesOf(rules)
  if (rules.capitalMode === 'categoria') {
    // Capitale e tasso fissi per categoria: niente RAL, niente documenti sanitari.
    const age = ageAt(p.birthDate, atISO, rules)
    const cat = categoryFor(p.level, rules)
    const capital = cat ? round2(Number(cat.capital) || 0) : 0
    // premio annuo fisso della categoria (Agos Vita: 110,41) o tasso ‰ sul capitale (LTC: 1,96)
    const rate = !cat ? null : Number(cat.premium) > 0 && capital > 0 ? Number(cat.premium) / capital * 1000 : Number(cat.rate) > 0 ? Number(cat.rate) : null
    const prem = premiumOf(capital, rate, p.sovrPct, rules)
    return { age, rate, target: capital, band: 'nessuna', capital, scopertura: 0, ...prem, cover: coverage(age, rules), category: cat ? cat.name : null }
  }
  const age = ageAt(p.birthDate, atISO, rules)
  const rate = rateFor(age, rates)
  // check-up scaduto (opzione): gli accertamenti valgono solo entro `checkupMonths` mesi
  let doc = p.doc
  if (rules.checkupExpiry && doc && doc.extra && doc.checkupDate && atISO) {
    const lim = new Date(`${String(atISO).slice(0, 10)}T12:00:00Z`)
    lim.setUTCMonth(lim.getUTCMonth() - (Number(rules.checkupMonths) || 0))
    if (String(doc.checkupDate).slice(0, 10) < lim.toISOString().slice(0, 10)) doc = { ...doc, extra: false }
  }
  const cap = capitalOf({ ral: p.ral, keyFigure: p.keyFigure }, doc, rules)
  const prem = premiumOf(cap.capital, rate, p.sovrPct, rules)
  return { age, rate, ...cap, ...prem, cover: coverage(age, rules) }
}

/**
 * Stato di rischio «pulito» per l'anno dopo (regole di CSA, 17/11/2026): chi è
 * in copertura al primo giorno del nuovo periodo (`cfg.periodEnd`). Fuori chi
 * esce entro quel giorno (anche per passaggio: c'è già la riga nell'altra
 * polizza); chi ha la decorrenza nel nuovo anno va nel PROMEMORIA. Oltre i
 * limiti d'età nessuna esclusione, solo un avviso (decisione del cliente).
 * → { keep: [{ p, alerts, now, next }], next: [{ p, alerts }], dropped: [{ p, reason }], at }
 */
export function vitaRenewalPlan(cfg, insured) {
  const at = cfg.periodEnd
  const rules = cfg.rules || DEFAULT_RULES
  const keep = [], next = [], dropped = []
  for (const p of insured) {
    if (p.entryDate && p.entryDate >= at) { next.push({ p, alerts: [] }); continue }
    if (p.exitDate && p.exitDate <= at) { dropped.push({ p, reason: p.exitKind || 'cessazione' }); continue }
    const now = computeInsured(p, cfg.rates, p.entryDate && p.entryDate > cfg.periodStart ? p.entryDate : cfg.periodStart, rules)
    const nx = computeInsured(p, cfg.rates, at, rules)
    const alerts = []
    if (nx.cover === 'FUORI COPERTURA') alerts.push(`${nx.age} anni al ${fmtDate(at)}: oltre il limite di ${rules.deathMaxAge} per il caso morte, da verificare con la compagnia`)
    else if (nx.cover !== now.cover) alerts.push(`${nx.age} anni al ${fmtDate(at)}: oltre ${rules.ipMaxAge} anni, solo caso morte (niente IPT)`)
    if (p.exitDate) alerts.push(`uscita comunicata dal ${fmtDate(p.exitDate)}`)
    keep.push({ p, alerts, now, next: nx })
  }
  for (const x of next) {
    const nx = computeInsured(x.p, cfg.rates, x.p.entryDate, rules)
    if (nx.cover === 'FUORI COPERTURA') x.alerts.push(`${nx.age} anni alla decorrenza: oltre il limite di ${rules.deathMaxAge}, da verificare con la compagnia`)
  }
  return { keep, next, dropped, at }
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
  ['matricola', /^MATRICOLA/],
  ['cognome', /^COGNOME/],
  ['nome', /^NOME/],
  ['cf', /^(CODICE FISCALE|C ?F)/],
  ['livello', /^LIVELLO/],
  ['nascita', /^DATA (DI )?NASCITA|^NASCITA|^DATANASCITA/],
  ['inserimento', /^DATA INSERIMENTO|^DATA (DI )?ENTRATA|^DECORRENZA/],
  ['uscita', /^DATA (DI )?USCITA|^DATA (DI )?ESCLUSIONE|^DATA (DI )?CESSAZIONE/],
  ['azione', /^AZIONE/],
  ['dataAzione', /^DATA AZIONE/],
  ['sovr', /^SOVRAPREMI/],
  ['figura', /^FIGURA CHIAVE/],
  ['visita', /^RAPPORTO DI VISITA MEDICA FORNITO/],
  ['ok', /^OK C A VITA/],
  ['note', /^NOTE/],
  // Agos: la categoria o la descrizione del livello fanno da livello
  ['livello', /^CATEGORIA|^DESCRIZIONE LIVELLO|^QUALIFICA/],
]

// Colonne che il programma ricalcola: non si conservano come dati aggiuntivi.
const COMPUTED = /^(ETA|CAPITAL|TASSO|DIRITTI|PREMIO|SCADENZA|GIORNI|SCOPERTURA|TIPO COPERTURA|RAL|TOTAL|STATO|AVVISI|AZIONE)/

/**
 * Intestazione del foglio: riga con COGNOME e NOME e mappa colonna → campo.
 * La RAL ha una regola sua: nei file del cliente ci sono più colonne «RAL …»
 * («RAL ANNUA 2025» e «RAL 2026 FULL TIME» nel file di fine anno), e quella buona
 * è la colonna che nomina l'anno chiesto. `ralYear` la sceglie; senza anno si
 * prende l'unica, o l'ultima.
 */
export function findVitaHeader(rows, ralYear, extraHeads) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = vitaHeaderAt(rows[i], ralYear, extraHeads)
    if (h) return { row: i, ...h }
  }
  return null
}

/**
 * Mappa colonna → campo di UNA riga, se è un'intestazione (ha COGNOME e NOME).
 * `heads` = testi originali delle colonne (per rifare l'Excel con le colonne del
 * cliente), `extras` = colonne che non sono né campi né importi ricalcolati
 * (matricola, provincia, comune, modulo…): si conservano così come sono.
 */
export function vitaHeaderAt(row, ralYear, extraHeads) {
  const cells = (row || []).map(normHead)
  // intestazioni in più del programma (cfg.words.heads: campo → parole), prima di quelle di sempre
  const extra = Object.entries(extraHeads || {}).map(([k, w]) => [k, String(w || '').split(',').map((x) => normHead(x)).filter(Boolean)])
  const syn = (f) => (extra.find(([k]) => k === f) || [null, []])[1]
  if (!(cells.includes('COGNOME') || syn('cognome').some((w) => cells.includes(w))) || !(cells.includes('NOME') || syn('nome').some((w) => cells.includes(w)))) return null
  const map = {}
  cells.forEach((h, col) => {
    if (!h) return
    for (const [key, ws] of extra) if (!(key in map) && ws.some((w) => h === w || h.startsWith(`${w} `))) { map[key] = col; return }
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
  const used = new Set(Object.entries(map).filter(([k]) => k !== 'ralHead').map(([, v]) => v))
  const heads = (row || []).map((c) => cellStr(c))
  const extras = []
  cells.forEach((h, col) => { if (h && !used.has(col) && !COMPUTED.test(h)) extras.push({ col, key: heads[col].toUpperCase() }) })
  // le colonne ricalcolate restano nel tracciato (per rifare il file), non nei dati
  while (heads.length && !heads[heads.length - 1]) heads.pop()
  return { map, heads, extras }
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
  const rules = rulesOf(cfg.rules)
  const catMode = rules.capitalMode === 'categoria'
  const insured = []
  const warnings = []
  const layout = { stato: /** @type {string[]|null} */ (null), mov: /** @type {string[]|null} */ (null) }
  let unknown = 0, unknownMov = 0
  const companies = cfg.companies || []
  /** @type {Map<string, string[]>} */
  const byPolicy = new Map()
  for (const c of companies) {
    const k = String(c.policy || '').trim()
    if (k) byPolicy.set(k, [...(byPolicy.get(k) || []), c.key])
  }
  const norm = (s) => normHead(s).replace(/ /g, '')
  const nameHit = (c, s) => !!s && !!norm(c.name) && (norm(s).includes(norm(c.name)) || norm(c.name).includes(norm(s)))
  // Il numero di polizza è il legame buono (se più contraenti hanno la stessa
  // polizza decide il nome dell'azienda). Se non è di nessun contraente si
  // ripiega sul nome dell'azienda o del foglio, ma lo si DICE: nel file del
  // cliente compaiono numeri che non sono fra i loro (60036 fra le 60037, celle
  // trascinate 60021, 60022…).
  const findCompany = (polizza, azienda, sheet) => {
    const num = String(polizza || '').trim()
    const keys = byPolicy.get(num)
    if (keys && keys.length === 1) return { key: keys[0], byPolicy: true }
    if (keys && keys.length > 1) {
      const pick = companies.find((c) => keys.includes(c.key) && norm(c.name) === norm(azienda)) || companies.find((c) => keys.includes(c.key) && nameHit(c, azienda))
      return { key: pick ? pick.key : keys[0], byPolicy: true }
    }
    for (const c of companies) if (azienda && norm(c.name) === norm(azienda)) return { key: c.key, num }
    for (const c of companies) if (sheet && norm(c.name) === norm(sheet)) return { key: c.key, num }
    for (const c of companies) if (nameHit(c, azienda)) return { key: c.key, num }
    for (const c of companies) if (nameHit(c, sheet)) return { key: c.key, num }
    // un solo contraente: è lui (file senza colonna AZIENDA, come la LTC di Agos)
    if (companies.length === 1 && !azienda) return { key: companies[0].key, num }
    return null
  }
  const extrasOf = (h, r) => {
    if (!catMode) return undefined
    const out = {}
    for (const x of h.extras) { const v = r[x.col]; const t = v instanceof Date || typeof v === 'number' && /DATA/.test(x.key) ? fmtDate(cellDate(v)) : cellStr(v); if (t) out[x.key] = t }
    return out
  }

  // Un foglio senza nemmeno un codice fiscale (TASSI, legende, comuni) non è un
  // foglio di persone: si salta in silenzio.
  const hasCf = (rows) => rows.some((r) => (r || []).some((c) => CF_RE.test(String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''))))
  const isMov = (n) => /^(MOVIMENT|VARIAZ)/i.test(String(n).trim())
  for (const name of Object.keys(sheets)) {
    if (isMov(name)) continue
    const rows = sheets[name] || []
    const h = findVitaHeader(rows, ralYear, cfg && cfg.words && cfg.words.heads)
    if (!h) {
      if (hasCf(rows)) warnings.push(`Foglio «${name}»: intestazione non trovata (serve una riga con COGNOME e NOME); saltato.`)
      continue
    }
    if (!layout.stato) layout.stato = h.heads
    if (!catMode) {
      if (h.map.ral == null) warnings.push(`Foglio «${name}»: nessuna colonna RAL, i capitali non si possono calcolare.`)
      else if (!String(h.map.ralHead || '').includes(String(ralYear))) warnings.push(`Foglio «${name}»: nessuna colonna «RAL ${ralYear}», ho usato «${h.map.ralHead}».`)
    }
    const get = (r, k) => (h.map[k] == null ? null : r[h.map[k]])
    let noCf = 0
    unknown = 0
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
      const extra = extrasOf(h, r)
      if (extra && get(r, 'matricola') != null && cellStr(get(r, 'matricola'))) extra.MATRICOLA = cellStr(get(r, 'matricola'))
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
        extra,
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

  // 2) FOGLI DELLE MOVIMENTAZIONI: entrate e uscite dell'anno. Erano saltati e le
  // uscite sparivano (segnalato dal cliente l'11/11/2026). Un foglio può avere
  // la colonna AZIONE (una tabella sola) oppure due SEZIONI, «INSERIMENTI» ed
  // «ESCLUSIONI», ognuna con la sua intestazione (LTC di Agos).
  const moves = []
  for (const name of Object.keys(sheets)) {
    if (!isMov(name)) continue
    const rows = sheets[name] || []
    let h = null
    let section = null
    let senzaAzione = 0
    /** @type {Map<string, number>} */
    const oddPolicy = new Map()
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || []
      const first = normHead((r.find((c) => cellStr(c)) ?? ''))
      const filled = r.filter((c) => cellStr(c)).length
      if (filled === 1 && /^(INSERIMENTI|INCLUSIONI|ENTRATE|INGRESSI)$/.test(first)) { section = 'entrata'; continue }
      if (filled === 1 && /^(ESCLUSIONI|USCITE|CESSAZIONI)$/.test(first)) { section = 'uscita'; continue }
      const hh = vitaHeaderAt(r, ralYear)
      if (hh) { h = hh; if (!layout.mov) layout.mov = hh.heads; continue }
      if (!h) continue
      const get = (rr, k) => (h.map[k] == null ? null : rr[h.map[k]])
      const cf = cellStr(get(r, 'cf')).toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (!CF_RE.test(cf)) continue
      const found = findCompany(cellStr(get(r, 'polizza')), cellStr(get(r, 'azienda')), name)
      if (!found) { unknownMov++; continue }
      if (!found.byPolicy && found.num) oddPolicy.set(found.num, (oddPolicy.get(found.num) || 0) + 1)
      const azione = normHead(get(r, 'azione'))
      const kind = /ESCL|USCIT|CESSA/.test(azione) ? 'uscita' : /INCL|ENTRAT|INSERI/.test(azione) ? 'entrata' : h.map.azione == null ? section : null
      const date = cellDate(get(r, 'dataAzione')) || (kind === 'uscita' ? cellDate(get(r, 'uscita')) : null) || cellDate(get(r, 'inserimento')) || cellDate(get(r, 'uscita'))
      if (!kind || !date) { senzaAzione++; continue }
      const sovr = cellNum(get(r, 'sovr')) || 0
      const extra = extrasOf(h, r)
      if (extra && cellStr(get(r, 'matricola'))) extra.MATRICOLA = cellStr(get(r, 'matricola'))
      moves.push({
        kind, date, cf, company: found.key, sheet: name, rowNumber: i + 1,
        cognome: cellStr(get(r, 'cognome')).toUpperCase(), nome: cellStr(get(r, 'nome')).toUpperCase(),
        birthDate: cellDate(get(r, 'nascita')), level: cellStr(get(r, 'livello')),
        ral: cellNum(get(r, 'ral')) || 0, keyFigure: yes(get(r, 'figura')),
        sovrPct: Math.abs(sovr) > 0 && Math.abs(sovr) <= 1 ? sovr * 100 : sovr,
        doc: { visit: yes(get(r, 'visita')), ok: yes(get(r, 'ok')), extra: false, checkupDate: null },
        note: cellStr(get(r, 'note')), extra,
      })
    }
    if (!h && hasCf(rows)) warnings.push(`Foglio «${name}»: intestazione non trovata; entrate e uscite non lette.`)
    for (const [num, n] of oddPolicy) warnings.push(`Foglio «${name}»: ${n} ${n === 1 ? 'riga ha' : 'righe hanno'} il numero di polizza ${num}, che non è di nessun contraente del programma; ${n === 1 ? 'assegnata' : 'assegnate'} dal nome dell'azienda.`)
    if (senzaAzione) warnings.push(`Foglio «${name}»: ${senzaAzione} ${senzaAzione === 1 ? 'riga senza' : 'righe senza'} azione o data; saltate.`)
  }
  if (unknownMov) warnings.push(`Movimentazioni: ${unknownMov} righe senza un contraente riconoscibile; saltate.`)

  // Passaggio: la stessa persona esce ed entra lo stesso giorno, fra due
  // contraenti (Amundi SGR → RE) o, con le categorie, fra due categorie della
  // stessa polizza (Agos: da quadro a dirigente). Le due righe si legano.
  const catKey = (lv) => { const c = categoryFor(lv, rules); return c ? c.key : '' }
  const transferOf = new Map()
  for (const m of moves.filter((x) => x.kind === 'uscita')) {
    const inn = moves.find((x) => x.kind === 'entrata' && x.cf === m.cf && x.date === m.date && (x.company !== m.company || (catMode && catKey(x.level) !== catKey(m.level))))
    if (inn) { const id = `tr-${m.cf}-${m.date}`; transferOf.set(m, id); transferOf.set(inn, id) }
  }

  // In ordine di data (a pari data prima le uscite): chi esce e rientra, o passa
  // di categoria, ha una riga NUOVA; chi è già nello stato di rischio e compare
  // fra le entrate aggiorna la sua riga.
  const open = (company, cf) => insured.filter((p) => p.company === company && p.cf === cf && !p.exitDate).pop()
  const ordered = [...moves].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'uscita' ? -1 : 1))
  for (const m of ordered) {
    const tr = transferOf.get(m) || null
    if (m.kind === 'entrata') {
      const exist = open(m.company, m.cf)
      if (exist && (!catMode || catKey(exist.level) === catKey(m.level) || !m.level)) {
        exist.entryDate = m.date
        exist.entryKind = tr ? 'passaggio' : m.date > cfg.periodStart ? 'inclusione' : 'iniziale'
        exist.transferId = tr
        if (m.ral > 0) exist.ral = m.ral
        if (m.extra) exist.extra = { ...(m.extra || {}), ...(exist.extra || {}) }
        exist.source = `${exist.source} · ${m.sheet} riga ${m.rowNumber}`
        continue
      }
      insured.push({
        company: m.company, cf: m.cf, cognome: m.cognome, nome: m.nome, birthDate: m.birthDate,
        level: m.level, ral: m.ral, keyFigure: m.keyFigure, sovrPct: m.sovrPct, doc: m.doc,
        remindedOn: null, entryDate: m.date,
        entryKind: tr ? 'passaggio' : m.date > cfg.periodStart ? 'inclusione' : 'iniziale',
        communicatedDate: null, exitDate: null, exitKind: null, exitCommunicated: null,
        transferId: tr, exitTransferId: null, nextRal: null,
        source: `${m.sheet} riga ${m.rowNumber}`, note: m.note, extra: m.extra, rowNumber: m.rowNumber, sheet: m.sheet,
      })
      continue
    }
    const cands = insured.filter((p) => p.company === m.company && p.cf === m.cf && !p.exitDate && (p.entryDate || '') <= m.date)
    const p = (catMode && m.level ? cands.find((x) => catKey(x.level) === catKey(m.level)) : null) || cands.pop()
    if (!p) { warnings.push(`«${m.sheet}» riga ${m.rowNumber}: ${m.cognome} ${m.nome} esce il ${fmtDate(m.date)} ma non è fra gli assicurati di quella polizza; uscita non registrata.`); continue }
    p.exitDate = m.date
    p.exitKind = tr ? 'passaggio' : 'cessazione'
    p.exitTransferId = tr
    if (m.note && !p.note) p.note = m.note
  }

  return { insured, warnings, moves: moves.length, layout }
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

/* ─── File mensile delle risorse umane (Agos, 18/11/2026) ───────────────── */

// Titoli delle sezioni del file mensile: si riconoscono dalle parole, non dalla
// posizione, così vale anche se il cliente le chiama in un altro modo.
const HR_SECTIONS = [
  ['proroga', /PROROG/],
  ['livello', /PASSAGG|PROMOZ|CAMBI\w* (DI )?LIVELL|VARIAZ\w* (DI )?LIVELL/],
  ['uscita', /CESSA|USCIT|DIMISS|LICENZ/],
  ['entrata', /ASSUN|INSERIM|INGRESS|ENTRAT/],
]
const HR_HEADS = [
  ['soc', /^(SOC|SOCIETA|AZIENDA|CODSOC)/],
  ['matricola', /^MATRICOLA/],
  ['cognome', /^COGNOME$/],
  ['nome', /^NOME$/],
  ['cf', /^(CODFISCALE|CODICEFISCALE|CF)/],
  ['nascita', /^DATA(DI)?NASCITA|^NASCITA/],
  ['luogo', /^(LOCALITA|COMUNE|LUOGO)(DI)?NASCITA/],
  ['prov', /^PROVINCIA/],
  ['livello', /^(NUOVO)?LIVELLO|^QUALIFICA|^CATEGORIA/],
  ['sesso', /^SESSO/],
  ['data', /^DATA(DI)?(ASSUNZIONE|CESSAZIONE|DECORRENZA|USCITA|INGRESSO|INIZIO|VARIAZIONE)|^PROROGADAL/],
]

/**
 * Eventi del file mensile del cliente: un foglio per mese, sezioni ASSUNTI,
 * CESSATI, PROROGHE, PASSAGGI DI LIVELLO, PROMOZIONI, ognuna con la sua
 * intestazione. → { events: [{ sheet, row, kind, soc, matricola, cognome, nome,
 * cf, birthDate, luogo, prov, level, sesso, date }], months, warnings }
 * kind: 'entrata' | 'uscita' | 'livello' | 'proroga'. La data è quella del file:
 * per le uscite è l'ultimo giorno di lavoro (il giorno dopo lo fa il piano).
 */
export function parseHrMonthly(sheets, cfg) {
  // parole in più del programma per i titoli delle sezioni (si aggiungono a quelle di sempre)
  const W = (cfg && cfg.words) || {}
  const extra = [['proroga', W.hrExtension], ['livello', W.hrLevel], ['uscita', W.hrExit], ['entrata', W.hrEntry]]
    .map(([k, w]) => [k, String(w || '').split(',').map((x) => normHead(x)).filter(Boolean)])
  const events = []
  const months = []
  const warnings = []
  for (const name of Object.keys(sheets || {})) {
    const rows = sheets[name] || []
    let section = null
    let h = null
    let n = 0
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || []
      const filled = r.filter((c) => cellStr(c)).length
      if (!filled) continue
      const first = normHead(r.find((c) => cellStr(c)))
      if (filled <= 2) {
        const own = extra.find(([, ws]) => ws.some((w) => first.startsWith(w) || first.includes(` ${w}`)))
        const sec = own || HR_SECTIONS.find(([, re]) => re.test(first))
        if (sec) { section = sec[0]; h = null; continue }
      }
      const cells = r.map((c) => normHead(c).replace(/ /g, ''))
      if (cells.includes('COGNOME') && cells.includes('NOME')) {
        h = {}
        cells.forEach((c, col) => { for (const [k, re] of HR_HEADS) if (!(k in h) && re.test(c)) { h[k] = col; break } })
        continue
      }
      if (!h || !section) continue
      const get = (k) => (h[k] == null ? null : r[h[k]])
      const cf = cellStr(get('cf')).toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (!CF_RE.test(cf)) continue
      n++
      events.push({
        sheet: name, row: i + 1, kind: section,
        soc: cellStr(get('soc')), matricola: cellStr(get('matricola')),
        cognome: cellStr(get('cognome')).toUpperCase(), nome: cellStr(get('nome')).toUpperCase(), cf,
        birthDate: cellDate(get('nascita')), luogo: cellStr(get('luogo')).toUpperCase(), prov: cellStr(get('prov')).toUpperCase(),
        level: cellStr(get('livello')), sesso: cellStr(get('sesso')), date: cellDate(get('data')),
      })
    }
    if (n) months.push(name)
  }
  if (!events.length) warnings.push('Nel file non ci sono assunti, cessati o passaggi di livello riconoscibili (servono le sezioni con le loro intestazioni: COGNOME, NOME, codice fiscale, data).')
  return { events, months, warnings }
}

/**
 * Che cosa cambia in UN programma con gli eventi del file mensile. Simula gli
 * eventi in ordine di data sulle righe del programma (così un assunto e poi
 * cessato nello stesso file entra ed esce) e restituisce:
 * - `inserts`: righe nuove; `updates`: { id, set } sulle righe esistenti;
 * - `changes`: l'elenco leggibile, una voce per movimento;
 * - `diffs`: movimenti GIÀ registrati ma con un'altra data (si correggono solo
 *   se l'operatore li sceglie: `opts.fix` = chiavi `${id}:${campo}`);
 * - `skipped`: quanti eventi non toccano questo programma e perché.
 * Le regole vengono dal programma: categorie (chi è dentro: tutti, o solo
 * quadri e dirigenti), uscita dal giorno dopo l'ultimo di lavoro, contraente
 * dal codice società. Ricaricare lo stesso file non registra nulla due volte.
 */
export function planHrEvents(cfg, insured, events, opts = {}) {
  const rules = rulesOf(cfg.rules)
  const fix = new Set(opts.fix || [])
  const companies = cfg.companies || []
  const withCodes = companies.filter((c) => String(c.hrCode || '').trim())
  const normName = (v) => normWord(v)
  const forced = opts.company ? companies.find((c) => normName(c.name) === normName(opts.company)) || null : undefined
  const companyFor = (soc) => {
    // file mensile di UN contraente (es. Agos Renting a parte): tutte le righe sono sue
    if (forced !== undefined) return forced
    if (!withCodes.length) return companies[0] || null
    const s = String(soc || '').trim()
    return withCodes.find((c) => String(c.hrCode).split(',').map((x) => x.trim()).includes(s)) || null
  }
  const catOf = (lv) => { const c = categoryFor(lv, rules); return c ? c.key : null }
  const catName = (lv) => { const c = categoryFor(lv, rules); return c ? c.name : '' }
  const rows = insured.map((p) => ({ ...p }))
  const byId = new Map(rows.map((p) => [p.id, p]))
  const inserts = []
  const updates = new Map()
  const changes = []
  const diffs = []
  const warnings = []
  const skipped = { proroghe: 0, fuoriPolizza: 0, nonAssicurati: 0, giaRegistrati: 0, altraSocieta: 0, senzaData: 0 }
  let tmp = 0
  const who = (e) => `${e.cognome} ${e.nome}`
  const setRow = (p, set) => {
    Object.assign(p, set)
    if (String(p.id).startsWith('new:')) return
    updates.set(p.id, { ...(updates.get(p.id) || {}), ...set })
  }
  const addRow = (e, company, date, kind, extraNote, transferId) => {
    const extra = {}
    if (e.matricola) extra.MATRICOLA = e.matricola
    if (e.prov) extra['PROVINCIA DI NASCITA'] = e.prov
    if (e.luogo) extra['COMUNE DI NASCITA'] = e.luogo
    const p = {
      id: `new:${++tmp}`, company: company.key, cf: e.cf, cognome: e.cognome, nome: e.nome, birthDate: e.birthDate,
      level: e.level, ral: 0, keyFigure: false, sovrPct: 0, doc: { visit: false, extra: false, ok: false, checkupDate: null },
      remindedOn: null, entryDate: date, entryKind: kind, communicatedDate: null, exitDate: null, exitKind: null,
      exitCommunicated: null, transferId: transferId || null, exitTransferId: null, nextRal: null,
      source: `File mensile, foglio «${e.sheet}» riga ${e.row}`, note: extraNote || null, extra,
    }
    rows.push(p)
    inserts.push(p)
    return p
  }
  const diff = (p, field, expected, e, text) => {
    const key = `${p.id}:${field}`
    const d = { key, id: p.id, field, current: p[field], expected, who: who(e), cf: e.cf, sheet: e.sheet, row: e.row, text }
    diffs.push(d)
    if (fix.has(key)) { setRow(p, { [field]: expected }); changes.push({ kind: 'correzione', date: expected, who: d.who, cf: e.cf, sheet: e.sheet, id: p.id, text: `Data corretta: ${text}` }) }
  }
  // un'entrata è «spiegata» da un evento del file con la sua stessa data
  const explained = (e, date) => events.some((x) => x !== e && x.cf === e.cf && x.date === date && (x.kind === 'entrata' || x.kind === 'livello'))

  // passaggi e promozioni alla decorrenza voluta dal programma (data del file, 1° del mese…)
  events = events.map((e) => (e.kind === 'livello' && e.date ? { ...e, fileDate: e.date, date: transferDateOf(e.date, rules) } : e))
  const order = { uscita: 0, livello: 1, entrata: 2, proroga: 3 }
  const sorted = [...events].sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')) || order[a.kind] - order[b.kind])
  for (const e of sorted) {
    if (e.kind === 'proroga') { skipped.proroghe++; continue }
    const company = companyFor(e.soc)
    if (!company) { skipped.altraSocieta++; continue }
    const mine = () => rows.filter((p) => p.company === company.key && p.cf === e.cf)
    const cat = categoryFor(e.level, rules)

    if (!e.date) {
      // senza data non si registra nulla: lo si dice solo se riguarda questo programma
      const openNow = mine().find((p) => !p.exitDate)
      const matters = e.kind === 'uscita' ? !!openNow
        : e.kind === 'entrata' ? !!cat && !openNow
        : openNow ? catOf(openNow.level) !== (cat ? cat.key : null) : !!cat
      if (matters) {
        skipped.senzaData++
        warnings.push(`«${e.sheet}» riga ${e.row}: ${who(e)} (${e.kind === 'livello' ? 'passaggio di livello' : e.kind}) senza data nel file: non registrato, va chiesta al cliente.`)
      }
      continue
    }

    if (e.kind === 'entrata') {
      if (!cat) { skipped.fuoriPolizza++; continue }
      const sameCat = mine().filter((p) => catOf(p.level) === cat.key)
      if (sameCat.some((p) => p.entryDate === e.date)) { skipped.giaRegistrati++; continue }
      const open = sameCat.find((p) => !p.exitDate)
      if (open) {
        if (open.entryKind !== 'iniziale' && !explained(e, open.entryDate)) diff(open, 'entryDate', e.date, e, `${who(e)}: assunto il ${fmtDate(e.date)}, nel programma entra il ${fmtDate(open.entryDate)}`)
        else skipped.giaRegistrati++
        continue
      }
      const p = addRow(e, company, e.date, 'inclusione', null, null)
      changes.push({ kind: 'entrata', date: e.date, who: who(e), cf: e.cf, sheet: e.sheet, id: p.id, text: `Entra dal ${fmtDate(e.date)}${cat.name ? ` come ${cat.name}` : ''}${e.level ? ` (${e.level})` : ''}` })
      continue
    }

    if (e.kind === 'uscita') {
      const exitD = rules.exitNextDay ? nextDay(e.date) : e.date
      const open = mine().filter((p) => !p.exitDate && (p.entryDate || cfg.periodStart) < exitD).pop()
      if (open) {
        setRow(open, { exitDate: exitD, exitKind: 'cessazione', exitCommunicated: null })
        changes.push({ kind: 'uscita', date: exitD, who: who(e), cf: e.cf, sheet: e.sheet, id: open.id, text: `Esce dal ${fmtDate(exitD)}${rules.exitNextDay ? ` (ultimo giorno ${fmtDate(e.date)})` : ''}` })
        continue
      }
      const done = mine().filter((p) => p.exitDate).sort((a, b) => String(b.exitDate).localeCompare(String(a.exitDate)))[0]
      if (!done) { skipped.nonAssicurati++; continue }
      if (done.exitDate === exitD || done.exitKind !== 'cessazione') { skipped.giaRegistrati++; continue }
      diff(done, 'exitDate', exitD, e, `${who(e)}: ultimo giorno ${fmtDate(e.date)}, l'uscita va dal ${fmtDate(exitD)}; nel programma è dal ${fmtDate(done.exitDate)}`)
      continue
    }

    // passaggio di livello o promozione
    const open = mine().find((p) => !p.exitDate || p.exitDate > e.date)
    if (open) {
      const oc = catOf(open.level)
      if (cat && oc === cat.key) {
        if (open.entryKind !== 'iniziale' && open.entryDate !== e.date && !explained(e, open.entryDate)) diff(open, 'entryDate', e.date, e, `${who(e)}: passaggio a ${cat.name} dal ${fmtDate(e.date)}, nel programma entra il ${fmtDate(open.entryDate)}`)
        else skipped.giaRegistrati++
        continue
      }
      if (!cat) {
        if ((open.entryDate || '') >= e.date) { skipped.giaRegistrati++; continue }
        setRow(open, { exitDate: e.date, exitKind: 'cessazione', note: open.note || `Passaggio a ${e.level}: fuori da questa polizza` })
        changes.push({ kind: 'uscita', date: e.date, who: who(e), cf: e.cf, sheet: e.sheet, id: open.id, text: `Esce dal ${fmtDate(e.date)}: passa a ${e.level}, livello che questa polizza non copre` })
        continue
      }
      const tr = `tr-${e.cf}-${e.date}`
      setRow(open, { exitDate: e.date, exitKind: 'passaggio', exitTransferId: tr })
      const p = addRow(e, company, e.date, 'passaggio', null, tr)
      changes.push({ kind: 'passaggio', date: e.date, who: who(e), cf: e.cf, sheet: e.sheet, id: p.id, text: `Passa da ${catName(open.level) || open.level} a ${cat.name} dal ${fmtDate(e.date)}${e.fileDate && e.fileDate !== e.date ? ` (nel file ${fmtDate(e.fileDate)})` : ''}: esce da una categoria ed entra nell'altra` })
      continue
    }
    if (!cat) { skipped.fuoriPolizza++; continue }
    if (mine().some((p) => catOf(p.level) === cat.key && p.entryDate === e.date)) { skipped.giaRegistrati++; continue }
    const p = addRow(e, company, e.date, 'inclusione', `Passaggio di livello: ${e.level}`, null)
    changes.push({ kind: 'entrata', date: e.date, who: who(e), cf: e.cf, sheet: e.sheet, id: p.id, text: `Entra dal ${fmtDate(e.date)} come ${cat.name}: passaggio di livello (${e.level})` })
  }
  void byId
  return {
    inserts, updates: [...updates.entries()].map(([id, set]) => ({ id, set })),
    changes: changes.sort((a, b) => a.date.localeCompare(b.date)), diffs, skipped, warnings,
  }
}

/**
 * Categorie e regole proposte da un file del cliente (stato di rischio con
 * CAPITALE, TASSO, DIRITTI, PREMIO, SCADENZA): per ogni livello o categoria del
 * foglio i valori più frequenti. Così un programma «per categoria» nasce con i
 * numeri del cliente senza scriverli a mano. → { categories, rights, countLastDay, from }
 */
export function categoriesFromWorkbook(sheets, periodEnd) {
  const isMov = (n) => /^(MOVIMENT|VARIAZ)/i.test(String(n).trim())
  const top = (arr) => { const f = new Map(); for (const v of arr) if (v != null) f.set(v, (f.get(v) || 0) + 1); return [...f.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null }
  for (const name of Object.keys(sheets || {})) {
    if (isMov(name)) continue
    const rows = sheets[name] || []
    const h = findVitaHeader(rows)
    if (!h) continue
    const cells = (rows[h.row] || []).map(normHead)
    const col = (re) => cells.findIndex((c) => re.test(c))
    const cCap = col(/^CAPITAL/), cTasso = col(/^TASSO/), cDir = col(/^DIRITTI/), cPrem = col(/^PREMIO( LORDO)?$|^PREMIO/), cScad = col(/^SCADENZA/)
    if (cCap < 0) continue
    const groups = new Map()
    const scad = []
    for (const r of rows.slice(h.row + 1)) {
      const cf = cellStr(r?.[h.map.cf]).toUpperCase().replace(/[^A-Z0-9]/g, '')
      if (!CF_RE.test(cf)) continue
      const lv = h.map.livello != null ? cellStr(r[h.map.livello]).toUpperCase() : ''
      if (!groups.has(lv)) groups.set(lv, { cap: [], tasso: [], dir: [], prem: [] })
      const g = groups.get(lv)
      g.cap.push(cellNum(r[cCap]))
      if (cTasso >= 0) g.tasso.push(cellNum(r[cTasso]))
      if (cDir >= 0) g.dir.push(cellNum(r[cDir]))
      if (cPrem >= 0) g.prem.push(cellNum(r[cPrem]))
      if (cScad >= 0) scad.push(cellDate(r[cScad]))
    }
    if (!groups.size) continue
    let rights = 0
    const categories = [...groups.entries()].map(([lv, g], i) => {
      const capital = top(g.cap) || 0
      const dir = top(g.dir) || 0
      rights = Math.max(rights, dir)
      let t = top(g.tasso)
      // tasso scritto come frazione (0,00196 = 0,196%) o come percentuale: sempre in ‰
      const rate = t == null ? 0 : t < 0.1 ? t * 1000 : t < 10 ? t * 10 : t
      const prem = top(g.prem)
      const premium = !rate && prem ? prem - dir : 0
      const label = lv || 'DIPENDENTI'
      return { key: `c${i + 1}`, name: label, capital, rate: Math.round(rate * 1e6) / 1e6, premium: Math.round(premium * 100) / 100, match: lv ? lv.toLowerCase() : '' }
    })
    const s = top(scad)
    return { categories, rights, countLastDay: s ? s === periodEnd : null, from: name }
  }
  return { categories: [], rights: 0, countLastDay: null, from: '' }
}
