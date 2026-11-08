// Polizza Vita collettiva (Amundi, Crédit Agricole Vita): regole di calcolo.
// Modulo PURO (nessun DB, nessuna interfaccia): le formule del file «Elenco
// assicurati VITA 2026» riscritte come funzioni. Gli importi non si salvano mai,
// si ricalcolano dai fatti (data di nascita, RAL, figura chiave, documenti).

export const DEFAULT_RULES = {
  multiplier: 2.5, // capitale = 2,5 × RAL
  keyFigureCapital: 1400000, // figura chiave: capitale fisso
  noDocUpTo: 400000, // fino a qui nessun documento sanitario
  visitUpTo: 800000, // fino a qui basta il rapporto di visita medica
  checkupMonths: 6, // validità del check-up per la fascia oltre
  rights: 1.03, // diritti per assicurato
  minAge: 18,
  deathMaxAge: 80, // garanzia morte
  ipMaxAge: 70, // invalidità permanente da malattia
  trackExtra: false, // oltre visupTo: accertamenti/check-up obbligatori (il file non li segue)
  refundBasis: 'start', // esclusioni: 'start' = tasso e capitale pagati a inizio anno, 'exit' = età al giorno di uscita
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// ROUNDUP(x, 2) di Excel, senza gli errori di virgola mobile (341,03 resta 341,03).
export function roundUp2(x) {
  const v = x * 100
  const r = Math.round(v)
  return (Math.abs(v - r) < 1e-6 ? r : Math.ceil(v)) / 100
}

const DAY = 86400000
const dayNum = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY) }
export const daysBetween = (a, b) => dayNum(b) - dayNum(a)
export function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}` }

/** Età computabile come nel file: ROUND((data − nascita − 2) / 365,25). */
export function ageAt(birthISO, atISO) {
  if (!birthISO || !atISO) return null
  return Math.round((daysBetween(birthISO, atISO) - 2) / 365.25)
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
 * Capitale assicurato. `doc` = { visit: bool (rapporto fornito), ok: bool (ok C.A. Vita), extra: bool }.
 * Finché la documentazione richiesta non c'è, il capitale resta al massimo senza documenti;
 * la differenza è la scopertura (sempre positiva).
 */
export function capitalOf({ ral, keyFigure }, doc = {}, rules = DEFAULT_RULES) {
  const target = round2(keyFigure ? rules.keyFigureCapital : (ral || 0) * rules.multiplier)
  const band = medicalBand(target, rules)
  let covered = band === 'nessuna' || (doc.visit && doc.ok)
  if (covered && band === 'visita+accertamenti' && rules.trackExtra && !doc.extra) covered = false
  const capital = covered ? target : rules.noDocUpTo
  return { target, band, capital: round2(capital), scopertura: round2(target - capital) }
}

/** Premio annuo: netto = capitale × tasso ‰ × (1 + sovrappremio %); lordo = netto + diritti, per eccesso al centesimo. */
export function premiumOf(capital, rate, sovrPct = 0, rules = DEFAULT_RULES) {
  if (rate == null) return { net: null, rights: rules.rights, gross: null }
  const net = round2((capital * rate / 1000) * (1 + (sovrPct || 0) / 100))
  return { net, rights: rules.rights, gross: roundUp2(net + rules.rights) }
}

/** Frazione d'anno dal giorno del movimento al 31/12 (giorni / 365). */
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
