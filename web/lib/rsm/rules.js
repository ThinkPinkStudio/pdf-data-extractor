// ANAGRAFICHE RSM (05/11/2026) — regole pure della polizza collettiva rimborso
// spese mediche: date, codice fiscale, premi, pro-rata, stato a una data,
// lettura dei file Excel del cliente, mail per i dati errati. Nessun DB, nessun
// I/O: lo usano le route, le pagine (anteprima dei conteggi) e i test
// (test/rsmRules.test.mjs).
//
// Regole confermate dal cliente il 05/11/2026 (CLAUDE.md «Anagrafiche RSM»):
//  - entrata fino al 30/06 = 100% del premio annuo, dal 01/07 = 50%;
//  - decorrenza = data richiesta se comunicata entro 30 giorni, altrimenti la
//    data della comunicazione (forzabile a mano);
//  - cessazione: nessun rimborso, copertura fino a fine periodo;
//  - promozione: uscita ed entrata in pro-rata (a giorni, configurabile),
//    rimborso al netto dell'imposta (2,5%), uno per nucleo dove il premio è a
//    nucleo, per persona dove è a persona.
// Ogni numero viene dalla configurazione del programma (tariffe e regole per
// anno), mai dal codice: «se modifichiamo la formula possiamo poi
// rimodificarla?» — sì, cambiando le impostazioni.

/* ─── Date: sempre 'YYYY-MM-DD' ─────────────────────────────────────────── */

const pad = (n) => String(n).padStart(2, '0')

export function isoOf(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * Data da qualunque forma arrivi da Excel o da un campo: Date (componenti
 * LOCALI, come le scrive SheetJS con cellDates), numero seriale Excel,
 * 'gg/mm/aaaa', 'gg.mm.aa', 'gg-mm-aaaa', 'aaaa-mm-gg'. Anno a 2 cifre:
 * > anno di riferimento + 1 → 1900.
 */
export function normDate(v, refYear = new Date().getFullYear()) {
  if (v == null || v === '') return null
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null
    return isoOf(v.getFullYear(), v.getMonth() + 1, v.getDate())
  }
  if (typeof v === 'number' && isFinite(v)) {
    if (v < 1 || v > 80000) return null
    const ms = Math.round((v - 25569) * 86400000)
    const d = new Date(ms)
    return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
  }
  const s = String(v).trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return isoOf(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(s)
  if (m) {
    let y = +m[3]
    if (m[3].length === 2) y = 2000 + y > refYear + 1 ? 1900 + y : 2000 + y
    return isoOf(y, +m[2], +m[1])
  }
  return null
}

const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000

/** Giorni da a a b (b − a). */
export function daysBetween(a, b) { return Math.round(dayNum(b) - dayNum(a)) }

export function addDays(iso, n) {
  const d = new Date((dayNum(iso) + n) * 86400000)
  return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

export function fmtDate(iso) {
  if (!iso) return ''
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

/** Giorni da a a b col metodo 30/360 americano (YEARFRAC base 0 di Excel). */
export function days360(a, b) {
  let d1 = +a.slice(8, 10), d2 = +b.slice(8, 10)
  const m1 = +a.slice(5, 7), m2 = +b.slice(5, 7), y1 = +a.slice(0, 4), y2 = +b.slice(0, 4)
  const lastFeb = (y, m, d) => m === 2 && d === new Date(Date.UTC(y, 2, 0)).getUTCDate()
  if (lastFeb(y1, m1, d1) && lastFeb(y2, m2, d2)) d2 = 30
  if (lastFeb(y1, m1, d1)) d1 = 30
  if (d2 === 31 && d1 >= 30) d2 = 30
  if (d1 === 31) d1 = 30
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1)
}

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

/* ─── Codice fiscale ────────────────────────────────────────────────────── */

const MONTHS = 'ABCDEHLMPRST'
const OMO = 'LMNPQRSTUV'
const ODD = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 }

export function cleanCf(cf) { return String(cf || '').toUpperCase().replace(/[^A-Z0-9]/g, '') }

/** Lettere di un nome o cognome: maiuscole senza accenti, apostrofi, spazi. */
function letters(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '')
}
const splitLetters = (s) => {
  const l = letters(s)
  return { cons: l.replace(/[AEIOU]/g, ''), vow: l.replace(/[^AEIOU]/g, '') }
}

export function surnameCode(s) {
  const { cons, vow } = splitLetters(s)
  return (cons + vow + 'XXX').slice(0, 3)
}

export function nameCode(s) {
  const { cons, vow } = splitLetters(s)
  if (cons.length >= 4) return cons[0] + cons[2] + cons[3]
  return (cons + vow + 'XXX').slice(0, 3)
}

function checkChar(first15) {
  let sum = 0
  for (let i = 0; i < 15; i++) {
    const c = first15[i]
    if (i % 2 === 0) sum += ODD[c]
    else sum += /[0-9]/.test(c) ? +c : c.charCodeAt(0) - 65
  }
  return String.fromCharCode(65 + (sum % 26))
}

/**
 * Legge un codice fiscale di persona: data di nascita, sesso, codici di
 * cognome e nome, carattere di controllo (anche con omocodia).
 * `refYear`: le date a due cifre oltre quest'anno sono del secolo scorso.
 */
export function decodeCf(cfRaw, refYear = new Date().getFullYear()) {
  const cf = cleanCf(cfRaw)
  const out = { cf, valid: false, checkOk: false, birthDate: null, sex: null, surname: '', name: '' }
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return out
  out.valid = true
  out.checkOk = checkChar(cf.slice(0, 15)) === cf[15]
  out.surname = cf.slice(0, 3)
  out.name = cf.slice(3, 6)
  const digit = (c) => (/[0-9]/.test(c) ? c : String(OMO.indexOf(c)))
  const yy = +(digit(cf[6]) + digit(cf[7]))
  const mm = MONTHS.indexOf(cf[8]) + 1
  let dd = +(digit(cf[9]) + digit(cf[10]))
  out.sex = dd > 40 ? 'F' : 'M'
  if (dd > 40) dd -= 40
  const year = 2000 + yy > refYear ? 1900 + yy : 2000 + yy
  out.birthDate = isoOf(year, mm, dd)
  return out
}

/**
 * Controlli di coerenza di una persona (richiesti dal cliente): cognome e nome
 * contro il codice fiscale, data di nascita contro quella del codice fiscale.
 * Restituisce { issues: [{ code, level: 'error'|'warning'|'info', text }],
 * birthDate } — `birthDate` è quella del file o, se manca, quella ricavata.
 */
export function checkPerson({ cognome, nome, cf, birthDate }, refYear) {
  const issues = []
  const d = decodeCf(cf, refYear)
  if (!d.cf) {
    issues.push({ code: 'cf-mancante', level: 'error', text: 'Codice fiscale mancante.' })
    return { issues, birthDate: birthDate || null, decoded: d }
  }
  if (!d.valid) {
    issues.push({ code: 'cf-formato', level: 'error', text: `Codice fiscale «${d.cf}» non valido (deve avere 16 caratteri nel formato di una persona).` })
    return { issues, birthDate: birthDate || null, decoded: d }
  }
  if (!d.checkOk) issues.push({ code: 'cf-controllo', level: 'error', text: `Codice fiscale «${d.cf}»: l'ultimo carattere di controllo non torna, probabile errore di battitura.` })
  const sOk = surnameCode(cognome) === d.surname
  const nOk = nameCode(nome) === d.name
  if (!sOk || !nOk) {
    const swapped = surnameCode(nome) === d.surname && nameCode(cognome) === d.name
    if (swapped) issues.push({ code: 'cf-invertiti', level: 'error', text: `Cognome e nome sembrano invertiti rispetto al codice fiscale ${d.cf}.` })
    else {
      if (!sOk) issues.push({ code: 'cf-cognome', level: 'error', text: `Il cognome «${String(cognome || '').trim()}» non corrisponde al codice fiscale ${d.cf} (atteso «${d.surname}…»).` })
      if (!nOk) issues.push({ code: 'cf-nome', level: 'error', text: `Il nome «${String(nome || '').trim()}» non corrisponde al codice fiscale ${d.cf} (atteso «…${d.name}»).` })
    }
  }
  let bd = birthDate || null
  if (!bd && d.birthDate) {
    bd = d.birthDate
    issues.push({ code: 'nascita-ricavata', level: 'info', text: `Data di nascita ricavata dal codice fiscale: ${fmtDate(d.birthDate)}.` })
  } else if (bd && d.birthDate && bd !== d.birthDate) {
    issues.push({ code: 'nascita', level: 'error', text: `La data di nascita ${fmtDate(bd)} non corrisponde al codice fiscale ${d.cf}, che indica il ${fmtDate(d.birthDate)}.` })
  }
  return { issues, birthDate: bd, decoded: d }
}

/* ─── Configurazione del programma (una polizza collettiva per anno) ───── */

export const LEGAMI = { TI: 'Titolare', CO: 'Coniuge/convivente', FI: 'Figlio/a' }

export function normLegame(v) {
  const s = String(v || '').trim().toUpperCase()
  if (!s) return null
  if (s === 'TI' || s.startsWith('TITOL')) return 'TI'
  if (s === 'CO' || s.startsWith('CONI') || s.startsWith('CONV')) return 'CO'
  if (s === 'FI' || s.startsWith('FIGL')) return 'FI'
  return null
}

/** Categoria dal testo ('DIRIGENTI QUIESCENTI', 'Impiegato'…) → chiave e quiescenza. */
export function normCategory(v, categories) {
  const s = String(v || '').trim().toUpperCase()
  if (!s) return { key: null, quiescente: false }
  const quiescente = /QUIESC/.test(s)
  const words = s.replace(/QUIESCENT[EI]/g, '').trim()
  for (const c of categories || []) {
    const lab = String(c.label || c.key).toUpperCase()
    // radice comune: «IMPIEGATO» = «IMPIEGATI», «DIRIGENTE» = «DIRIGENTI»
    const root = lab.slice(0, Math.max(5, lab.length - 2))
    if (words.startsWith(root) || words === String(c.key).toUpperCase()) return { key: c.key, quiescente }
  }
  return { key: null, quiescente }
}

export function defaultProgramConfig(year = new Date().getFullYear()) {
  return {
    periodStart: `${year}-01-01`,
    periodEnd: `${year + 1}-01-01`, // escluso: la copertura termina il 31/12
    categories: [
      { key: 'dirigenti', label: 'Dirigenti', policy: '', mode: 'nucleo', rank: 3, tariffs: { titolare: 0, quiescente: 0 }, quota: 10 },
      { key: 'funzionari', label: 'Funzionari', policy: '', mode: 'nucleo', rank: 2, tariffs: { titolare: 0, quiescente: 0 }, quota: 10 },
      { key: 'impiegati', label: 'Impiegati', policy: '', mode: 'persona', rank: 1, tariffs: { titolare: 0, coniuge: 0, figlio: 0 }, quota: 10 },
    ],
    rules: {
      firstSemesterEnd: '06-30', // entrata fino a questo giorno incluso = 100%
      secondSemesterPct: 50,
      prorata: 'giorni', // 'giorni' | 'mesi' (30/360)
      refundTaxPct: 2.5, // rimborso al netto dell'imposta
      notifyDays: 30, // inclusione comunicata entro N giorni: decorre dalla data richiesta
      coverUntilPeriodEnd: true, // chi cessa resta coperto fino a fine periodo
    },
    mail: { cc: '', signature: '' },
  }
}

export function categoryOf(cfg, key) { return (cfg.categories || []).find((c) => c.key === key) || null }

/** Premio annuo di una persona nella sua categoria (0 per i familiari del premio a nucleo). */
export function annualPremium(cfg, catKey, legame, quiescente) {
  const cat = categoryOf(cfg, catKey)
  if (!cat) return 0
  const t = cat.tariffs || {}
  if (cat.mode === 'nucleo') {
    if (legame !== 'TI') return 0
    return Number((quiescente && t.quiescente) ? t.quiescente : t.titolare) || 0
  }
  if (legame === 'CO') return Number(t.coniuge) || 0
  if (legame === 'FI') return Number(t.figlio) || 0
  return Number((quiescente && t.quiescente) ? t.quiescente : t.titolare) || 0
}

/** Frazione del periodo da `date` (incluso) alla fine, col metodo scelto. */
export function prorataFraction(cfg, date) {
  const start = cfg.periodStart, end = cfg.periodEnd
  if (!date || date <= start) return 1
  if (date >= end) return 0
  if ((cfg.rules || {}).prorata === 'mesi') return days360(date, end) / days360(start, end)
  return daysBetween(date, end) / daysBetween(start, end)
}

/** Ultimo giorno del 1° semestre nell'anno del periodo. */
export function firstSemesterEnd(cfg) {
  const md = (cfg.rules || {}).firstSemesterEnd || '06-30'
  return `${cfg.periodStart.slice(0, 4)}-${md}`
}

/**
 * Decorrenza di un'inclusione: la data richiesta se comunicata entro
 * `notifyDays` giorni da quella data (o prima), altrimenti la data della
 * comunicazione. Una data forzata dall'operatore vince sempre.
 */
export function decorrenza(cfg, requested, communicated, forced) {
  if (forced) return { date: forced, reason: 'forzata' }
  if (!requested) return { date: communicated || null, reason: 'comunicazione' }
  if (!communicated) return { date: requested, reason: 'richiesta' }
  const days = Number((cfg.rules || {}).notifyDays ?? 30)
  if (daysBetween(requested, communicated) <= days) return { date: requested, reason: 'richiesta' }
  return { date: communicated, reason: 'tardiva' }
}

/**
 * Conteggi di una riga di copertura (persona in una categoria): premio annuo,
 * frazione, quota associativa, dovuto, rimborso. Sempre ricalcolati dalla
 * configurazione: i fatti salvati sono solo date, legami e categoria.
 */
export function computeMember(cfg, m) {
  const r = cfg.rules || {}
  const annuo = annualPremium(cfg, m.category, m.legame, m.quiescente)
  let frazione = 1
  let calc = ''
  const entry = m.entryDate
  const cat = categoryOf(cfg, m.category)
  if (m.entryKind === 'iniziale' || !entry || entry <= cfg.periodStart) {
    calc = 'annuo intero'
  } else if (m.entryKind === 'promozione') {
    frazione = prorataFraction(cfg, entry)
    calc = r.prorata === 'mesi' ? 'pro-rata a mesi' : `pro-rata ${daysBetween(entry, cfg.periodEnd)}/${daysBetween(cfg.periodStart, cfg.periodEnd)} giorni`
  } else if (entry <= firstSemesterEnd(cfg)) {
    calc = '1° semestre: 100%'
  } else {
    frazione = Number(r.secondSemesterPct ?? 50) / 100
    calc = `2° semestre: ${r.secondSemesterPct ?? 50}%`
  }
  if (annuo === 0 && cat && cat.mode === 'nucleo' && m.legame !== 'TI') calc = 'compreso nel nucleo'
  const rateo = round2(annuo * frazione)
  const quota = m.legame === 'TI' && annuo > 0 ? Number(cat ? cat.quota : 0) || 0 : 0
  let rimborso = 0
  if (m.exitKind === 'promozione' && m.exitDate && annuo > 0) {
    const tax = Number(r.refundTaxPct ?? 0)
    rimborso = round2(annuo / (1 + tax / 100) * prorataFraction(cfg, m.exitDate))
  }
  const dovuto = round2(rateo + quota)
  return { annuo, frazione, rateo, quota, dovuto, rimborso, saldo: round2(dovuto - rimborso), calc }
}

/**
 * Stato di una riga a una data: 'futuro' (non ancora entrata), 'attivo',
 * 'cessazione' (cessata ma coperta fino a fine periodo), 'uscito' (fuori:
 * promozione o cessazione oltre la fine), 'promosso'.
 */
export function statusAt(cfg, m, date) {
  if (m.entryDate && date < m.entryDate) return 'futuro'
  if (m.exitDate && date >= m.exitDate) {
    if (m.exitKind === 'promozione') return 'promosso'
    if ((cfg.rules || {}).coverUntilPeriodEnd !== false && date < cfg.periodEnd) return 'cessazione'
    return 'uscito'
  }
  return 'attivo'
}

export const isCovered = (state) => state === 'attivo' || state === 'cessazione'

/* ─── Promozione ────────────────────────────────────────────────────────── */

/**
 * Anteprima di una promozione: il titolare e i familiari del nucleo (righe
 * della categoria di partenza attive alla data) escono dalla categoria
 * `from` ed entrano in `to` dal giorno della promozione.
 */
export function previewPromotion(cfg, nucleus, toKey, date) {
  const exits = nucleus.map((m) => {
    const after = { ...m, exitDate: date, exitKind: 'promozione' }
    return { member: m, calc: computeMember(cfg, after) }
  })
  const entries = nucleus.map((m) => {
    const neu = { ...m, id: undefined, category: toKey, entryDate: date, entryKind: 'promozione', exitDate: null, exitKind: null }
    return { member: neu, calc: computeMember(cfg, neu) }
  })
  const rimborso = round2(exits.reduce((s, e) => s + e.calc.rimborso, 0))
  const dovuto = round2(entries.reduce((s, e) => s + e.calc.dovuto, 0))
  return { exits, entries, rimborso, dovuto, saldo: round2(dovuto - rimborso) }
}

/* ─── Lettura dei file Excel del cliente ────────────────────────────────── */

const normHead = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

const HEADS = [
  ['cfAss', /^(C ?F ?(ASSICURATO|FAMILIARE)|CODICE FISCALE( ASSICURATO)?)$/],
  ['cfTit', /^(C ?F ?(TITOLARE|CAPO NUCLEO)|CODICE FISCALE TITOLARE)$/],
  ['societa', /^SOCIETA/],
  ['categoria', /^CATEGORIA/],
  ['azione', /^AZIONE/],
  ['polizza', /^(N(UMERO)? ?POL|NR POLIZZA)/],
  ['cognome', /^COGNOME/],
  ['nome', /^NOME/],
  ['nascita', /NASCITA/],
  ['legame', /^LEGAME/],
  ['entrata', /^(DATA (DI )?ENTRATA|DECORRENZA)/],
  ['uscita', /^DATA (DI )?USCITA/],
  ['promozione', /^PROMOZIONE/],
  ['quiescente', /^QUIESCENTE/],
  ['note', /^NOTE/],
]

/** Riga d'intestazione (quella con COGNOME e NOME) e mappa colonna → campo. */
export function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = (rows[i] || []).map(normHead)
    if (cells.includes('COGNOME') && cells.includes('NOME')) {
      const map = {}
      cells.forEach((h, col) => {
        for (const [key, re] of HEADS) if (!(key in map) && re.test(h)) { map[key] = col; break }
      })
      return { row: i, map }
    }
  }
  return null
}

const cellStr = (v) => (v == null ? '' : v instanceof Date ? v.toISOString() : String(v)).replace(/\s+/g, ' ').trim()

/**
 * Righe di un file di comunicazione («File per comunicazioni teste»):
 * intestazione cercata per nome, righe senza cognome né codice fiscale
 * saltate (legenda in fondo). Valori grezzi, normalizzati ma non controllati.
 */
export function parseCommunicationRows(rows, refYear) {
  const h = findHeader(rows)
  if (!h) return { error: 'Intestazione non trovata: serve una riga con COGNOME e NOME.', rows: [] }
  const get = (r, k) => (h.map[k] == null ? null : r[h.map[k]])
  const out = []
  for (let i = h.row + 1; i < rows.length; i++) {
    const r = rows[i] || []
    const cognome = cellStr(get(r, 'cognome'))
    const cfAss = cleanCf(get(r, 'cfAss'))
    const cfTit = cleanCf(get(r, 'cfTit'))
    if (!cognome && !cfAss) continue
    out.push({
      rowNumber: i + 1,
      societa: cellStr(get(r, 'societa')),
      categoria: cellStr(get(r, 'categoria')),
      azione: cellStr(get(r, 'azione')).toUpperCase(),
      polizza: cellStr(get(r, 'polizza')),
      cognome,
      nome: cellStr(get(r, 'nome')),
      birthDate: normDate(get(r, 'nascita'), refYear),
      cf: cfAss,
      cfTitolare: cfTit,
      legame: normLegame(get(r, 'legame')),
      legameRaw: cellStr(get(r, 'legame')),
      entryDate: normDate(get(r, 'entrata'), refYear),
      exitDate: normDate(get(r, 'uscita'), refYear),
      note: cellStr(get(r, 'note')),
    })
  }
  return { rows: out, header: h }
}

/**
 * Prepara le righe di un file di comunicazione per la registrazione: eredità
 * di categoria/data dal titolare, controlli, decorrenza e premio.
 * `existing`: righe già registrate nel programma (per trovare il titolare e i
 * doppioni). `communicated`: data di ricezione del file.
 */
export function prepareCommunication(cfg, parsed, existing, communicated) {
  const refYear = +cfg.periodStart.slice(0, 4)
  const byCfFile = new Map()
  for (const r of parsed) {
    if (r.legame === 'TI' && !r.cf && r.cfTitolare) r.cf = r.cfTitolare
    if (r.legame === 'TI' && !r.cfTitolare && r.cf) r.cfTitolare = r.cf
    if (r.legame === 'TI' && r.cf && !byCfFile.has(r.cf)) byCfFile.set(r.cf, r)
  }
  // Familiare col PROPRIO codice fiscale nella colonna del titolare e quella
  // dell'assicurato vuota (CAV(12) del cliente): se il codice è suo per
  // cognome e nome lo si sposta, e il titolare è l'unico del file.
  const tis = parsed.filter((r) => r.legame === 'TI' && r.cf)
  for (const r of parsed) {
    if (r.cf || !r.cfTitolare || r.legame === 'TI') continue
    const d = decodeCf(r.cfTitolare, refYear)
    if (d.valid && surnameCode(r.cognome) === d.surname && nameCode(r.nome) === d.name) {
      r.cf = r.cfTitolare
      r.cfTitolare = tis.length === 1 ? tis[0].cf : ''
      r.cfMoved = true
    }
  }
  const cfCount = new Map()
  for (const r of parsed) if (r.cf) cfCount.set(r.cf, (cfCount.get(r.cf) || 0) + 1)
  const active = (existing || []).filter((m) => isCovered(statusAt(cfg, m, communicated || cfg.periodStart)) || statusAt(cfg, m, communicated || cfg.periodStart) === 'futuro')
  return parsed.map((r) => {
    const issues = []
    const exit = r.azione === 'U' || r.azione.startsWith('USC') || (!!r.exitDate && !r.entryDate)
    const tit = r.legame === 'TI' ? r : (byCfFile.get(r.cfTitolare) || null)
    const titExisting = r.cfTitolare ? (existing || []).find((m) => m.cf === r.cfTitolare && m.legame === 'TI') : null
    let { key: category, quiescente } = normCategory(r.categoria, cfg.categories)
    if (!category && tit && tit !== r) ({ key: category, quiescente } = normCategory(tit.categoria, cfg.categories))
    if (!category && titExisting) { category = titExisting.category; quiescente = !!titExisting.quiescente }
    if (!category && exit && r.cf) {
      const found = active.find((m) => m.cf === r.cf)
      if (found) category = found.category
    }
    if (!r.legame) issues.push({ code: 'legame', level: 'error', text: `Legame «${r.legameRaw || 'vuoto'}» non riconosciuto (TI, CO o FI).` })
    if (!category) issues.push({ code: 'categoria', level: 'error', text: 'Categoria mancante (Dirigente, Funzionario o Impiegato).' })
    const person = checkPerson({ cognome: r.cognome, nome: r.nome, cf: r.cf, birthDate: r.birthDate }, refYear)
    issues.push(...person.issues)
    if (r.cfMoved) issues.push({ code: 'cf-colonna', level: 'warning', text: `Il codice fiscale ${r.cf} era nella colonna del titolare: è di questa persona${r.cfTitolare ? `, titolare ${r.cfTitolare}` : ''}.` })
    if (r.cf && cfCount.get(r.cf) > 1) issues.push({ code: 'doppione-file', level: 'error', text: `Lo stesso codice fiscale ${r.cf} compare su più righe del file.` })
    const entryDate = r.entryDate || (tit && tit !== r ? tit.entryDate : null)
    if (!exit && !entryDate) issues.push({ code: 'entrata', level: 'error', text: 'Data di entrata mancante.' })
    if (r.legame && r.legame !== 'TI') {
      if (!r.cfTitolare) issues.push({ code: 'titolare', level: 'error', text: 'Codice fiscale del titolare mancante.' })
      else if (!tit && !titExisting) issues.push({ code: 'titolare-assente', level: 'warning', text: `Il titolare ${r.cfTitolare} non è né nel file né tra gli assicurati.` })
    }
    const dup = r.cf ? active.find((m) => m.cf === r.cf && m.category === category) : null
    if (!exit && dup) issues.push({ code: 'doppione', level: 'warning', text: 'Persona già assicurata in questa categoria.' })
    if (exit && r.cf && !active.find((m) => m.cf === r.cf)) issues.push({ code: 'non-trovato', level: 'error', text: 'Uscita di una persona che non risulta tra gli assicurati.' })
    if (r.polizza && category) {
      const pol = (categoryOf(cfg, category) || {}).policy
      if (pol && cleanCf(pol) !== cleanCf(r.polizza)) issues.push({ code: 'polizza', level: 'warning', text: `Numero di polizza ${r.polizza} diverso da quello della categoria (${pol}).` })
    }
    const dec = exit ? null : decorrenza(cfg, entryDate, communicated, null)
    if (dec && dec.reason === 'tardiva') issues.push({ code: 'tardiva', level: 'warning', text: `Comunicata oltre ${cfg.rules.notifyDays} giorni: decorre dal ${fmtDate(dec.date)} invece che dal ${fmtDate(entryDate)}.` })
    if (dec && dec.date && (dec.date < cfg.periodStart || dec.date >= cfg.periodEnd)) issues.push({ code: 'periodo', level: 'error', text: `Data ${fmtDate(dec.date)} fuori dal periodo di polizza.` })
    const member = {
      category, quiescente: !!quiescente, cf: r.cf, cognome: r.cognome.toUpperCase(), nome: r.nome.toUpperCase(),
      birthDate: person.birthDate, legame: r.legame, cfTitolare: r.legame === 'TI' ? r.cf : r.cfTitolare,
      requestedDate: exit ? null : entryDate, communicatedDate: communicated || null,
      entryDate: dec ? dec.date : null, entryKind: 'inclusione',
      exitDate: exit ? (r.exitDate || entryDate) : null, exitKind: exit ? 'cessazione' : null,
    }
    const calc = !exit && category && member.entryDate ? computeMember(cfg, member) : null
    return { ...r, action: exit ? 'uscita' : 'entrata', member, calc, issues, hasError: issues.some((i) => i.level === 'error') }
  })
}

/* ─── Mail per i dati errati ────────────────────────────────────────────── */

/**
 * Mail pronta da inviare a chi ha trasmesso il file, con le righe che hanno
 * errori. Solo gli errori: gli avvisi restano a chi registra.
 */
export function buildErrorMail({ fileName, receivedOn, rows, to, cc, signature }) {
  const bad = rows.filter((r) => r.hasError)
  const lines = bad.map((r) => {
    const who = `${String(r.cognome || '').toUpperCase()} ${String(r.nome || '').toUpperCase()}`.trim() || '(senza nome)'
    const errs = r.issues.filter((i) => i.level === 'error').map((i) => `   - ${i.text}`).join('\n')
    return `• ${who} (riga ${r.rowNumber})\n${errs}`
  })
  const subject = `Verifica dati – ${fileName || 'comunicazione inclusioni'}`
  const ok = rows.length - bad.length
  const body = [
    'Buongiorno,',
    '',
    `nel file «${fileName || ''}»${receivedOn ? ` ricevuto il ${fmtDate(receivedOn)}` : ''} abbiamo riscontrato i seguenti dati da verificare:`,
    '',
    ...lines,
    '',
    bad.length === rows.length
      ? 'Vi chiediamo di controllarli e di inviarci il file corretto.'
      : `Vi chiediamo di controllarli e di inviarci il file corretto per queste righe. ${ok === 1 ? 'L\'altra riga del file è stata registrata' : `Le altre ${ok} righe del file sono state registrate`} regolarmente.`,
    '',
    'Grazie, cordiali saluti',
    ...(signature ? ['', signature] : []),
  ].join('\n')
  return { to: to || '', cc: cc || '', subject, body, count: bad.length }
}

/** File .eml (bozza da aprire nel programma di posta). */
const base64Utf8 = (s) => (typeof Buffer !== 'undefined'
  ? Buffer.from(s, 'utf8').toString('base64')
  : btoa(Array.from(new TextEncoder().encode(s), (b) => String.fromCharCode(b)).join('')))

export function buildEml({ to, cc, subject, body }) {
  const enc = (s) => `=?UTF-8?B?${base64Utf8(s)}?=`
  const b64 = base64Utf8(body.replace(/\n/g, '\r\n')).replace(/.{76}/g, '$&\r\n')
  return [
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${enc(subject)}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64,
    '',
  ].join('\r\n')
}

/* ─── Import dello stato di rischio (il loro Excel) ─────────────────────── */

const yes = (v) => /^S[IÌ]$/i.test(String(v ?? '').trim())

/**
 * Stato di rischio del cliente: un foglio per categoria (situazione al 01/01)
 * e «Variazioni <CATEGORIA>» (entrate e uscite dell'anno). Restituisce le
 * righe di copertura da registrare e gli avvisi. Le promozioni si legano per
 * codice fiscale e data tra l'uscita di una categoria e l'entrata in un'altra.
 */
export function parseStatoWorkbook(cfg, sheets) {
  const refYear = +cfg.periodStart.slice(0, 4)
  const members = []
  const warnings = []
  const catOfSheet = (name) => normCategory(String(name).replace(/^VARIAZIONI\s*/i, ''), cfg.categories).key
  const names = Object.keys(sheets)
  // 1) fogli di stato al 01/01
  for (const name of names.filter((n) => !/^VARIAZ/i.test(n.trim()))) {
    const key = catOfSheet(name)
    if (!key) continue
    const p = parseCommunicationRows(sheets[name], refYear)
    if (p.error) { warnings.push(`Foglio «${name}»: ${p.error}`); continue }
    const quiescTit = new Map()
    for (const r of p.rows) {
      if (r.legame === 'TI') quiescTit.set(r.cf, normCategory(r.categoria, cfg.categories).quiescente || yes(sheets[name][r.rowNumber - 1]?.[p.header.map.quiescente]))
    }
    for (const r of p.rows) {
      if (!r.legame) { warnings.push(`«${name}» riga ${r.rowNumber}: legame non riconosciuto, riga saltata.`); continue }
      const cfTit = r.legame === 'TI' ? r.cf : r.cfTitolare
      const entry = r.entryDate && r.entryDate > cfg.periodStart ? r.entryDate : cfg.periodStart
      const person = checkPerson({ cognome: r.cognome, nome: r.nome, cf: r.cf, birthDate: r.birthDate }, refYear)
      for (const i of person.issues.filter((x) => x.level === 'error')) warnings.push(`«${name}» riga ${r.rowNumber} ${r.cognome} ${r.nome}: ${i.text}`)
      members.push({
        category: key, quiescente: !!quiescTit.get(cfTit), cf: r.cf, cognome: r.cognome.toUpperCase(), nome: r.nome.toUpperCase(),
        birthDate: person.birthDate, legame: r.legame, cfTitolare: cfTit,
        entryDate: entry, entryKind: entry > cfg.periodStart ? 'inclusione' : 'iniziale', requestedDate: entry,
        exitDate: null, exitKind: null, source: `Stato di rischio, foglio «${name}» riga ${r.rowNumber}`, note: r.note || '',
      })
    }
  }
  // 2) variazioni: prima le entrate, poi le uscite (chi esce può essere entrato in corso d'anno)
  const varRows = []
  for (const name of names.filter((n) => /^VARIAZ/i.test(n.trim()))) {
    const key = catOfSheet(name)
    if (!key) continue
    const p = parseCommunicationRows(sheets[name], refYear)
    if (p.error) { warnings.push(`Foglio «${name}»: ${p.error}`); continue }
    const promoCol = p.header.map.promozione
    for (const r of p.rows) varRows.push({ ...r, key, sheet: name, promo: promoCol != null && yes(sheets[name][r.rowNumber - 1]?.[promoCol]) })
  }
  const isExit = (r) => /USC/.test(r.azione) || r.azione === 'U' || (!!r.exitDate && !r.entryDate)
  for (const r of varRows.filter((x) => !isExit(x))) {
    if (!r.legame) { warnings.push(`«${r.sheet}» riga ${r.rowNumber}: legame non riconosciuto, riga saltata.`); continue }
    const cfTit = r.legame === 'TI' ? r.cf : r.cfTitolare
    const titQ = members.find((m) => m.category === r.key && m.cf === cfTit && m.legame === 'TI')
    const person = checkPerson({ cognome: r.cognome, nome: r.nome, cf: r.cf, birthDate: r.birthDate }, refYear)
    for (const i of person.issues.filter((x) => x.level === 'error')) warnings.push(`«${r.sheet}» riga ${r.rowNumber} ${r.cognome} ${r.nome}: ${i.text}`)
    members.push({
      category: r.key, quiescente: normCategory(r.categoria, cfg.categories).quiescente || !!(titQ && titQ.quiescente),
      cf: r.cf, cognome: r.cognome.toUpperCase(), nome: r.nome.toUpperCase(), birthDate: person.birthDate,
      legame: r.legame, cfTitolare: cfTit, entryDate: r.entryDate, requestedDate: r.entryDate,
      entryKind: r.promo ? 'promozione' : 'inclusione', exitDate: null, exitKind: null,
      source: `Stato di rischio, foglio «${r.sheet}» riga ${r.rowNumber}`, note: r.note || '',
    })
  }
  for (const r of varRows.filter(isExit)) {
    const date = r.exitDate
    const target = members.filter((m) => m.category === r.key && m.cf === r.cf && !m.exitDate && (!date || !m.entryDate || m.entryDate <= date))
      .sort((a, b) => (b.entryDate || '').localeCompare(a.entryDate || ''))[0]
    if (!target) { warnings.push(`«${r.sheet}» riga ${r.rowNumber} ${r.cognome} ${r.nome}: uscita di una persona non presente in ${r.key}, riga saltata.`); continue }
    target.exitDate = date
    target.exitKind = r.promo ? 'promozione' : 'cessazione'
    if (r.note) target.note = [target.note, r.note].filter(Boolean).join(' · ')
  }
  // 3) legame delle promozioni: stessa persona, uscita da una categoria ed entrata in un'altra lo stesso giorno
  // Una promozione per NUCLEO: titolare e familiari che escono lo stesso giorno
  // dalla stessa categoria condividono l'id (si annullano insieme).
  const promoIds = new Map()
  for (const out of members.filter((m) => m.exitKind === 'promozione')) {
    const inn = members.find((m) => m.entryKind === 'promozione' && m.cf === out.cf && m.entryDate === out.exitDate && m.category !== out.category && !m.promotionId)
    const key = `${out.category}|${out.cfTitolare || out.cf}|${out.exitDate}`
    if (!promoIds.has(key)) promoIds.set(key, `promo-${promoIds.size + 1}`)
    const id = promoIds.get(key)
    out.promotionId = id
    if (inn) inn.promotionId = id
    else warnings.push(`${out.cognome} ${out.nome}: uscita per promozione dal ${fmtDate(out.exitDate)} senza l'entrata corrispondente in un'altra categoria.`)
  }
  for (const inn of members.filter((m) => m.entryKind === 'promozione' && !m.promotionId)) {
    warnings.push(`${inn.cognome} ${inn.nome}: entrata per promozione dal ${fmtDate(inn.entryDate)} senza l'uscita corrispondente; registrata come promozione.`)
  }
  return { members, warnings }
}
