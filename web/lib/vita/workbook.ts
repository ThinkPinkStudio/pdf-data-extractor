// POLIZZA VITA — Excel in uscita, fatto come il file del cliente («Elenco
// assicurati VITA»): un foglio per contraente con la situazione a inizio anno,
// un foglio «Movimentazioni …» con entrate e uscite dell'anno e il foglio TASSI.
// Stesse colonne e stesso ordine, perché il cliente lavora su quel file.
// Solo valori, nessuna formula (totali compresi): gli importi sono quelli di rules.js.
import ExcelJS from 'exceljs'
import { applyLabels } from '../excelLabels'
import { computeInsured, fmtDate, movementOf, prorata, vitaRenewalPlan, yearEndOf } from './rules.js'
import type { VitaInsured, VitaProgram } from './types'

const FMT_DATE = 'dd/mm/yyyy'
const FMT_EUR = '#,##0.00'
const FMT_RATE = '0.0000'

const toDate = (iso: string | null) => (iso ? new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))) : null)
const sheetName = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)

function header(ws: ExcelJS.Worksheet, cols: { h: string; w: number; fmt?: string }[]) {
  ws.columns = cols.map((c) => ({ header: c.h, width: c.w, style: c.fmt ? { numFmt: c.fmt } : {} }))
  const r = ws.getRow(1)
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1B2E' } }
  r.alignment = { wrapText: true, vertical: 'middle' }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
}

/**
 * Riga di totali in fondo, come nel file del cliente: valori già sommati, non
 * formule, così il file si legge uguale ovunque (anche fuori da Excel).
 */
function totals(ws: ExcelJS.Worksheet, rows: ExcelJS.CellValue[][], cols: number[], n: number) {
  const r = ws.addRow([])
  r.getCell(1).value = 'TOTALI'
  r.font = { bold: true }
  for (const c of cols) {
    const sum = rows.reduce((s, row) => s + (typeof row[c - 1] === 'number' ? (row[c - 1] as number) : 0), 0)
    r.getCell(c).value = Math.round(sum * 100) / 100
  }
  const info = ws.addRow([])
  info.getCell(1).value = `Assicurati: ${n}`
  info.font = { bold: true }
}

export async function vitaWorkbook(program: VitaProgram, insured: VitaInsured[], kind: 'stato' | 'situazione' | 'rinnovo', at: string): Promise<Buffer> {
  if (program.config.rules?.capitalMode === 'categoria') return categoryWorkbook(program, insured, kind, at)
  const cfg = program.config
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CSA Suite'
  const yearEnd = yearEndOf(cfg)
  const calc = (p: VitaInsured, on: string) => computeInsured(p, cfg.rates, on, cfg.rules) as {
    age: number | null; rate: number | null; target: number; band: string; capital: number; scopertura: number
    net: number | null; gross: number | null; cover: string; rights: number | null
  }
  const companyName = (key: string) => cfg.companies.find((c) => c.key === key)?.name || key
  const policy = (key: string) => cfg.companies.find((c) => c.key === key)?.policy || ''

  const STATO_COLS = [
    { h: 'AZIENDA', w: 18 }, { h: 'NR. POLIZZA', w: 13 }, { h: 'COGNOME', w: 20 }, { h: 'NOME', w: 20 },
    { h: 'CODICE FISCALE', w: 19 }, { h: 'LIVELLO', w: 22 }, { h: 'DATA DI NASCITA', w: 14, fmt: FMT_DATE },
    { h: 'DATA INSERIMENTO', w: 15, fmt: FMT_DATE }, { h: "ETA'", w: 7 }, { h: 'TASSO ‰', w: 10, fmt: FMT_RATE },
    { h: `RAL ANNUA ${program.year}`, w: 14, fmt: FMT_EUR },
    { h: `CAPITALI ASSICURATI ${program.year}\n(${String(cfg.rules.multiplier).replace('.', ',')} VOLTE LA RAL)`, w: 16, fmt: FMT_EUR },
    { h: 'SCOPERTURA', w: 14, fmt: FMT_EUR }, { h: 'PREMIO NETTO', w: 13, fmt: FMT_EUR },
    { h: 'DIRITTI', w: 9, fmt: FMT_EUR }, { h: 'PREMIO LORDO', w: 13, fmt: FMT_EUR },
    { h: 'SOVRAPREMI\n%', w: 11 }, { h: 'FIGURA CHIAVE', w: 13 }, { h: 'RAPPORTO DI VISITA MEDICA', w: 14 },
    { h: 'RAPPORTO DI VISITA MEDICA FORNITO', w: 14 }, { h: 'ACCERTAMENTI O CHECK-UP', w: 14 },
    { h: `OK C.A. VITA\nOVER ${cfg.rules.noDocUpTo.toLocaleString('it-IT')}`, w: 14 },
    { h: 'TIPO COPERTURA', w: 18 }, { h: 'NOTE', w: 40 },
  ]

  const statoRow = (p: VitaInsured) => {
    const c = calc(p, p.entryDate || cfg.periodStart)
    const needVisit = c.band !== 'nessuna'
    return [
      companyName(p.company), policy(p.company) || null, p.cognome, p.nome, p.cf, p.level,
      toDate(p.birthDate), toDate(p.entryDate), c.age, c.rate, p.ral, c.capital, c.scopertura,
      c.net, c.gross == null ? null : c.rights, c.gross,
      p.sovrPct ? p.sovrPct / 100 : 0, p.keyFigure ? 'SI' : 'NO',
      needVisit ? 'SI' : 'NO', p.doc.visit ? 'SI' : 'NO', p.doc.extra ? 'SI' : 'NO', p.doc.ok ? 'SI' : 'NO',
      c.cover, p.note || '',
    ]
  }

  if (kind === 'situazione') {
    // Le righe come si vedono nella pagina, con lo stato alla data scelta.
    const ws = wb.addWorksheet(sheetName(`Situazione al ${fmtDate(at).replace(/\//g, '-')}`))
    header(ws, [...STATO_COLS, { h: 'STATO', w: 22 }, { h: 'DATA USCITA', w: 13, fmt: FMT_DATE }])
    const out: ExcelJS.CellValue[][] = []
    for (const p of insured) {
      const stato = p.exitDate && p.exitDate <= at ? 'Uscito' : (p.entryDate || '') > at ? 'Non ancora entrato' : 'In copertura'
      const row = [...statoRow(p), stato, toDate(p.exitDate)]
      out.push(row as ExcelJS.CellValue[])
      ws.addRow(row)
    }
    totals(ws, out, [11, 12, 13, 14, 15, 16], insured.length)
    return Buffer.from(await (applyLabels(wb, cfg.excelLabels), wb.xlsx.writeBuffer()))
  }

  if (kind === 'rinnovo') {
    // Stato di rischio «pulito» per l'anno dopo (vitaRenewalPlan): per contraente
    // chi è in copertura al primo giorno, età e garanzia a quella data, la RAL
    // dell'anno nuovo da far compilare all'Azienda (la colonna «RAL ANNUA <anno>»
    // è quella che il caricamento del rinnovo legge), gli avvisi e, in fondo, il
    // promemoria di chi decorre nell'anno nuovo.
    const plan = vitaRenewalPlan(cfg, insured) as {
      at: string
      keep: { p: VitaInsured; alerts: string[]; next: { age: number | null; cover: string } }[]
      next: { p: VitaInsured; alerts: string[] }[]
      dropped: { p: VitaInsured; reason: string }[]
    }
    const start = plan.at
    const next = +start.slice(0, 4)
    const cols = [
      { h: 'AZIENDA', w: 18 }, { h: 'NR. POLIZZA', w: 13 }, { h: 'COGNOME', w: 20 }, { h: 'NOME', w: 20 },
      { h: 'CODICE FISCALE', w: 19 }, { h: 'LIVELLO', w: 22 }, { h: 'DATA DI NASCITA', w: 14, fmt: FMT_DATE },
      { h: 'DATA INSERIMENTO', w: 15, fmt: FMT_DATE }, { h: `ETA' AL ${fmtDate(start)}`, w: 10 },
      { h: `RAL ANNUA ${program.year}`, w: 14, fmt: FMT_EUR }, { h: `RAL ANNUA ${next}`, w: 14, fmt: FMT_EUR },
      { h: 'FIGURA CHIAVE', w: 13 }, { h: `TIPO COPERTURA AL ${fmtDate(start)}`, w: 20 }, { h: 'AVVISI', w: 50 }, { h: 'NOTE', w: 40 },
    ]
    const row = (p: VitaInsured, ageNext: number | null, cover: string, alerts: string[]) => [
      companyName(p.company), policy(p.company) || null, p.cognome, p.nome, p.cf, p.level, toDate(p.birthDate), toDate(p.entryDate),
      ageNext, p.ral, p.nextRal, p.keyFigure ? 'SI' : 'NO', cover, alerts.join('; '), p.note || '',
    ]
    const byName = <T extends { p: VitaInsured }>(l: T[]) => [...l].sort((a, b) => `${a.p.cognome} ${a.p.nome}`.localeCompare(`${b.p.cognome} ${b.p.nome}`, 'it'))
    const sum = wb.addWorksheet('Riepilogo')
    header(sum, [{ h: 'AZIENDA', w: 20 }, { h: 'NR. POLIZZA', w: 13 }, { h: `IN COPERTURA AL ${fmtDate(start)}`, w: 16 },
      { h: `USCITI NEL ${program.year}`, w: 12 }, { h: `DA INSERIRE NEL ${next}`, w: 14 }, { h: 'CON AVVISI', w: 11 }])
    for (const comp of cfg.companies) {
      const keep = byName(plan.keep.filter((x) => x.p.company === comp.key))
      const nxt = byName(plan.next.filter((x) => x.p.company === comp.key))
      const out = plan.dropped.filter((x) => x.p.company === comp.key)
      if (!keep.length && !nxt.length && !out.length) continue
      const ws = wb.addWorksheet(sheetName(comp.name))
      header(ws, cols)
      for (const x of keep) {
        const r = ws.addRow(row(x.p, x.next.age, x.next.cover, x.alerts))
        if (x.alerts.length) r.getCell(14).font = { bold: true, color: { argb: 'FFB42318' } }
      }
      const tot = ws.addRow([`TOTALE ${keep.length} ASSICURATI`])
      tot.font = { bold: true }
      if (nxt.length) {
        ws.addRow([])
        const t = ws.addRow([`PROMEMORIA · COMUNICATI NEL ${program.year} CON DECORRENZA DAL ${fmtDate(start)} O DOPO (da inserire nel ${next})`])
        t.font = { bold: true }
        for (const x of nxt) {
          const c = calc(x.p, x.p.entryDate || start)
          const r = ws.addRow(row(x.p, c.age, c.cover, x.alerts))
          r.font = { italic: true }
        }
      }
      sum.addRow([comp.name, comp.policy, keep.length, out.length, nxt.length, keep.concat(nxt as typeof keep).filter((x) => x.alerts.length).length])
    }
    if (plan.dropped.length) {
      const ws = wb.addWorksheet(sheetName(`Usciti nel ${program.year}`))
      // NOMINATIVO e non COGNOME/NOME: il file torna indietro col caricamento delle
      // RAL, e questo foglio non deve sembrare un elenco di assicurati.
      header(ws, [{ h: 'AZIENDA', w: 18 }, { h: 'NOMINATIVO', w: 34 }, { h: 'C.F.', w: 19 },
        { h: 'DATA USCITA', w: 13, fmt: FMT_DATE }, { h: 'MOTIVO', w: 34 }, { h: 'NOTE', w: 40 }])
      for (const x of [...plan.dropped].sort((a, b) => String(a.p.exitDate).localeCompare(String(b.p.exitDate)))) {
        ws.addRow([companyName(x.p.company), `${x.p.cognome} ${x.p.nome}`, x.p.cf, toDate(x.p.exitDate),
          x.reason === 'passaggio' ? "passaggio all'altra polizza (è nell'altro elenco)" : 'cessazione', x.p.note || ''])
      }
    }
    sum.addRow([])
    sum.addRow([`${program.name} · stato di rischio per il ${next}: chi è in copertura al ${fmtDate(start)} · limiti d'età ${cfg.rules.ipMaxAge} (IPT) e ${cfg.rules.deathMaxAge} (caso morte): solo avviso · compilare la colonna «RAL ANNUA ${next}» · esportato il ${fmtDate(at)}`])
    return Buffer.from(await (applyLabels(wb, cfg.excelLabels), wb.xlsx.writeBuffer()))
  }

  // Un foglio per contraente: la situazione a inizio anno (chi è entrato dopo
  // compare qui con la sua decorrenza, come nel file del cliente).
  for (const comp of cfg.companies) {
    const rows = insured.filter((p) => p.company === comp.key && p.entryKind !== 'passaggio')
    const ws = wb.addWorksheet(sheetName(comp.name))
    header(ws, STATO_COLS)
    const out: ExcelJS.CellValue[][] = []
    for (const p of rows) { const row = statoRow(p) as ExcelJS.CellValue[]; out.push(row); ws.addRow(row) }
    totals(ws, out, [11, 12, 13, 14, 15, 16], rows.length)
    const note = ws.addRow([])
    note.getCell(1).value = 'LA IPT NON E\' SOSTITUTIVA AL CASO MORTE'
    const note2 = ws.addRow([])
    note2.getCell(1).value = 'IN CASO DI SINISTRO DA IPT NON ESCLUDERE IL DIPENDENTE DALLA COPERTURA'
  }

  // Movimentazioni: entrate e uscite dell'anno, col premio in pro-rata a giorni.
  const MOV_COLS = [
    { h: 'AZIENDA', w: 18 }, { h: 'NR. POLIZZA', w: 13 }, { h: 'COGNOME', w: 20 }, { h: 'NOME', w: 20 },
    { h: 'CODICE FISCALE', w: 19 }, { h: 'LIVELLO', w: 22 }, { h: 'DATA DI NASCITA', w: 14, fmt: FMT_DATE },
    { h: 'AZIONE', w: 14 }, { h: 'DATA AZIONE', w: 13, fmt: FMT_DATE }, { h: "ETA'", w: 7 },
    { h: 'TASSO ‰', w: 10, fmt: FMT_RATE }, { h: 'RAL ANNUA', w: 14, fmt: FMT_EUR },
    { h: 'CAPITALI ASSICURATI', w: 16, fmt: FMT_EUR }, { h: 'GIORNI', w: 9 },
    { h: 'PREMIO NETTO', w: 13, fmt: FMT_EUR }, { h: 'DIRITTI', w: 9, fmt: FMT_EUR },
    { h: 'PREMIO LORDO', w: 13, fmt: FMT_EUR }, { h: 'SOVRAPREMI\n%', w: 11 },
    { h: 'FIGURA CHIAVE', w: 13 }, { h: 'TIPO COPERTURA', w: 18 }, { h: 'NOTE', w: 40 },
  ]
  for (const comp of cfg.companies) {
    const mov: ExcelJS.CellValue[][] = []
    for (const p of insured.filter((x) => x.company === comp.key)) {
      const c = calc(p, p.entryDate || cfg.periodStart)
      const base = [companyName(p.company), policy(p.company) || null, p.cognome, p.nome, p.cf, p.level, toDate(p.birthDate)]
      const tail = [p.sovrPct ? p.sovrPct / 100 : 0, p.keyFigure ? 'SI' : 'NO', c.cover, p.note || '']
      if (p.entryDate && p.entryDate > cfg.periodStart) {
        const m = movementOf({ kind: 'INCLUSIONE', date: p.entryDate, capital: c.capital, rate: c.rate, sovrPct: p.sovrPct }, yearEnd, cfg.rules) as { days: number; net: number | null; gross: number | null; rights: number | null }
        mov.push([...base, p.entryKind === 'passaggio' ? 'PASSAGGIO' : 'INCLUSIONE', toDate(p.entryDate), c.age, c.rate, p.ral, c.capital, m.days, m.net, m.rights, m.gross, ...tail])
      }
      if (p.exitDate) {
        const m = movementOf({ kind: 'ESCLUSIONE', date: p.exitDate, capital: c.capital, rate: c.rate, sovrPct: p.sovrPct, paid: { capital: c.capital, rate: c.rate as number } }, yearEnd, cfg.rules) as { days: number; net: number | null; gross: number | null }
        mov.push([...base, p.exitKind === 'passaggio' ? 'PASSAGGIO' : 'ESCLUSIONE', toDate(p.exitDate), c.age, c.rate, p.ral, c.capital, m.days, m.net, 0, m.gross, ...tail])
      }
    }
    if (!mov.length) continue
    const ws = wb.addWorksheet(sheetName(`Movimentazioni ${comp.name}`))
    header(ws, MOV_COLS)
    mov.sort((a, b) => String(a[8]).localeCompare(String(b[8])))
    for (const r of mov) ws.addRow(r)
    totals(ws, mov, [12, 13, 15, 16, 17], mov.length)
    const note = ws.addRow([])
    note.getCell(1).value = 'PER LE ESCLUSIONI INDICARE IL GIORNO SUCCESSIVO A QUELLO DELLA COMUNICAZIONE'
    const note2 = ws.addRow([])
    note2.getCell(1).value = `Regolazione al ${fmtDate(yearEnd)} · pro-rata a giorni su 365`
  }

  // TASSI: la tabella per età del programma, come nel file del cliente.
  const ws = wb.addWorksheet('TASSI')
  header(ws, [{ h: 'Età', w: 8 }, { h: 'Tasso ‰', w: 22, fmt: '0.0000000000000000' }])
  for (const age of Object.keys(cfg.rates).map(Number).sort((a, b) => a - b)) ws.addRow([age, cfg.rates[String(age)]])
  void prorata
  return Buffer.from(await (applyLabels(wb, cfg.excelLabels), wb.xlsx.writeBuffer()))
}

/* ─── Polizze per categoria (Agos): l'Excel con le colonne del file del cliente ─── */

const DEFAULT_CAT_HEADS = ['AZIENDA', 'NR. POLIZZA', 'MATRICOLA', 'COGNOME', 'NOME', 'C.F.', 'DATA DI NASCITA', "ETA'", 'SESSO', 'CATEGORIA', 'CAPITALE', 'TASSO', 'DIRITTI', 'PREMIO', 'DECORRENZA', 'SCADENZA', 'NOTE']
const nh = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

interface Ctx { date: string | null; scad: string; prem: number | null; azione?: string; age: number | null; capital: number; rate: number | null; category: string | null; rights?: number | null }

/** Valore e formato di una colonna del cliente, dal testo della sua intestazione. */
function cellFor(head: string, p: VitaInsured, x: Ctx, cfg: VitaProgram['config']): { v: ExcelJS.CellValue; fmt?: string } {
  const h = nh(head)
  const company = cfg.companies.find((c) => c.key === p.company)
  const ex = p.extra || {}
  if (/^(AZIENDA|SOCIETA|CONTRAENTE)/.test(h)) return { v: company?.name || p.company }
  if (/POLIZZA/.test(h)) return { v: company?.policy ? (/^\d+$/.test(company.policy) ? Number(company.policy) : company.policy) : null }
  if (/^MATRICOLA/.test(h)) return { v: ex.MATRICOLA || ex[head.toUpperCase()] || null }
  if (/^COGNOME/.test(h)) return { v: p.cognome }
  if (/^NOME$/.test(h)) return { v: p.nome }
  if (/^(C F|CODICE FISCALE|CF)/.test(h)) return { v: p.cf }
  if (/^DATA/.test(h) && /NASCITA/.test(h)) return { v: toDate(p.birthDate), fmt: FMT_DATE }
  if (/^(PROVINCIA|COMUNE)/.test(h)) return { v: ex[head.toUpperCase()] || ex[/^PROVINCIA/.test(h) ? 'PROVINCIA DI NASCITA' : 'COMUNE DI NASCITA'] || null }
  if (/^ETA/.test(h)) return { v: x.age }
  if (/^SESSO/.test(h)) { const d = Number(String(p.cf).slice(9, 11).replace(/[LMNPQRSTUV]/g, (c) => String('LMNPQRSTUV'.indexOf(c)))); return { v: ex.SESSO || (isFinite(d) && p.cf.length === 16 ? (d > 40 ? 'F' : 'M') : null) } }
  if (/^(CATEGORIA|DESCRIZIONE LIVELLO|QUALIFICA)/.test(h)) return { v: x.category || p.level }
  if (/^LIVELLO/.test(h)) return { v: p.level }
  if (/^CAPITAL/.test(h)) return { v: x.capital, fmt: FMT_EUR }
  if (/^TASSO/.test(h)) return { v: x.rate == null ? null : x.rate / 1000, fmt: '0.000%' }
  if (/^DIRITTI/.test(h)) return { v: x.rights ?? null, fmt: FMT_EUR }
  if (/^PREMIO/.test(h)) return { v: x.prem, fmt: FMT_EUR }
  if (/^(DECORRENZA|DATA (DI )?ENTRATA|DATA INSERIMENTO|DATA (DI )?USCITA|DATA AZIONE|DATA (DI )?ESCLUSIONE)/.test(h)) return { v: toDate(x.date), fmt: FMT_DATE }
  if (/^SCADENZA/.test(h)) return { v: toDate(x.scad), fmt: FMT_DATE }
  if (/^AZIONE/.test(h)) return { v: x.azione || null }
  if (/^NOTE/.test(h)) return { v: p.note || '' }
  return { v: ex[head.toUpperCase()] ?? null }
}

function catSheet(wb: ExcelJS.Workbook, name: string, heads: string[], rows: { p: VitaInsured; x: Ctx; alerts?: string[] }[], cfg: VitaProgram['config'], opts: { alerts?: boolean; italic?: boolean; noCapTotal?: boolean } = {}) {
  const ws = wb.addWorksheet(sheetName(name))
  const all = opts.alerts ? [...heads, 'AVVISI'] : heads
  header(ws, all.map((h) => ({ h, w: Math.max(9, Math.min(28, h.length + 4)) })))
  let tot = 0, cap = 0
  const premCol = heads.findIndex((h) => /^PREMIO/.test(nh(h)))
  const capCol = heads.findIndex((h) => /^CAPITAL/.test(nh(h)))
  for (const { p, x, alerts } of rows) {
    const cells = heads.map((h) => cellFor(h, p, x, cfg))
    const r = ws.addRow([...cells.map((c) => c.v), ...(opts.alerts ? [(alerts || []).join('; ')] : [])])
    cells.forEach((c, i) => { if (c.fmt) r.getCell(i + 1).numFmt = c.fmt })
    if (opts.italic) r.font = { italic: true }
    tot += x.prem || 0
    cap += x.capital || 0
  }
  // Totale in fondo, come nei loro fogli: valori già sommati, prima cella col testo.
  const t = ws.addRow([`TOTALE ${rows.length} ASSICURATI`])
  t.font = { bold: true }
  if (premCol > 0) { t.getCell(premCol + 1).value = Math.round(tot * 100) / 100; t.getCell(premCol + 1).numFmt = FMT_EUR }
  if (capCol > 0 && !opts.noCapTotal) { t.getCell(capCol + 1).value = Math.round(cap * 100) / 100; t.getCell(capCol + 1).numFmt = FMT_EUR }
  return ws
}

async function categoryWorkbook(program: VitaProgram, insured: VitaInsured[], kind: 'stato' | 'situazione' | 'rinnovo', at: string): Promise<Buffer> {
  const cfg = program.config
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CSA Suite'
  const scad = yearEndOf(cfg)
  const statoHeads = cfg.fileLayout?.stato?.length ? cfg.fileLayout.stato.filter(Boolean) : DEFAULT_CAT_HEADS
  const movBase = cfg.fileLayout?.mov?.length ? cfg.fileLayout.mov.filter(Boolean) : statoHeads
  const movHeads = movBase.some((h) => /^AZIONE/.test(nh(h))) ? movBase : ['AZIONE', ...movBase]
  const calc = (p: VitaInsured, on: string) => computeInsured(p, cfg.rates, on, cfg.rules) as { age: number | null; capital: number; rate: number | null; gross: number | null; category?: string | null; rights?: number | null }
  const ctx = (p: VitaInsured, on: string, date: string | null, prem: number | null, azione?: string): Ctx => {
    const c = calc(p, on)
    return { date, scad, prem, azione, age: c.age, capital: c.capital, rate: c.rate, category: c.category || null, rights: c.rights ?? null }
  }
  const byName = (a: VitaInsured, b: VitaInsured) => `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`, 'it')

  if (kind === 'rinnovo') {
    const plan = vitaRenewalPlan(cfg, insured) as { at: string; keep: { p: VitaInsured; alerts: string[] }[]; next: { p: VitaInsured; alerts: string[] }[]; dropped: { p: VitaInsured; reason: string }[] }
    const next = +plan.at.slice(0, 4)
    // fine del periodo nuovo: un anno dopo la fine di questo (anche se il periodo non è l'anno solare)
    const shiftYear = (iso: string) => `${+iso.slice(0, 4) + 1}${iso.slice(4, 10)}`
    const endNew = shiftYear(cfg.periodEnd)
    const lastDay = (() => { const d = new Date(`${endNew}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) })()
    const nextEnd = cfg.rules.countLastDay ? endNew : lastDay
    void next
    const keep = [...plan.keep].sort((a, b) => byName(a.p, b.p)).map((k) => {
      const c = calc(k.p, plan.at)
      return { p: k.p, alerts: k.alerts, x: { ...ctx(k.p, plan.at, plan.at, c.gross), scad: nextEnd } }
    })
    const ws = catSheet(wb, `Rinnovo ${next}`, statoHeads, keep, cfg, { alerts: true })
    if (plan.next.length) {
      ws.addRow([])
      const t = ws.addRow([`PROMEMORIA · COMUNICATI NEL ${program.year} CON DECORRENZA DAL ${fmtDate(plan.at)} O DOPO`])
      t.font = { bold: true }
      for (const x of plan.next) {
        const c = calc(x.p, x.p.entryDate || plan.at)
        const cells = statoHeads.map((h) => cellFor(h, x.p, { ...ctx(x.p, x.p.entryDate || plan.at, x.p.entryDate, c.gross), scad: nextEnd }, cfg))
        const r = ws.addRow(cells.map((q) => q.v))
        cells.forEach((q, i) => { if (q.fmt) r.getCell(i + 1).numFmt = q.fmt })
        r.font = { italic: true }
      }
    }
    if (plan.dropped.length) {
      const out = wb.addWorksheet(sheetName(`Usciti nel ${program.year}`))
      header(out, [{ h: 'NOMINATIVO', w: 34 }, { h: 'C.F.', w: 19 }, { h: 'CATEGORIA', w: 14 }, { h: 'DATA USCITA', w: 13, fmt: FMT_DATE }, { h: 'MOTIVO', w: 30 }])
      for (const x of [...plan.dropped].sort((a, b) => String(a.p.exitDate).localeCompare(String(b.p.exitDate)))) {
        out.addRow([`${x.p.cognome} ${x.p.nome}`, x.p.cf, calc(x.p, x.p.entryDate || cfg.periodStart).category || x.p.level, toDate(x.p.exitDate), x.reason === 'passaggio' ? 'passaggio ad altra categoria (è nell\'elenco)' : 'cessazione'])
      }
    }
    return Buffer.from(await (applyLabels(wb, cfg.excelLabels), wb.xlsx.writeBuffer()))
  }

  if (kind === 'situazione') {
    const ws = catSheet(wb, `Situazione al ${fmtDate(at).replace(/\//g, '-')}`, [...statoHeads, 'STATO', 'DATA USCITA'].filter((h, i, a) => a.indexOf(h) === i), [], cfg)
    ws.spliceRows(2, 1)
    let n = 0, tot = 0
    for (const p of [...insured].sort(byName)) {
      const c = calc(p, p.entryDate || cfg.periodStart)
      const stato = p.exitDate && p.exitDate <= at ? 'Uscito' : (p.entryDate || '') > at ? 'Non ancora entrato' : 'In copertura'
      const x = ctx(p, p.entryDate || cfg.periodStart, p.entryDate, c.gross)
      const cells = statoHeads.map((h) => cellFor(h, p, x, cfg))
      const r = ws.addRow([...cells.map((q) => q.v), stato, toDate(p.exitDate)])
      cells.forEach((q, i) => { if (q.fmt) r.getCell(i + 1).numFmt = q.fmt })
      r.getCell(statoHeads.length + 2).numFmt = FMT_DATE
      n++; tot += stato === 'In copertura' ? c.gross || 0 : 0
    }
    const t = ws.addRow([`TOTALE ${n} RIGHE · premio annuo di chi è in copertura ${tot.toFixed(2).replace('.', ',')}`])
    t.font = { bold: true }
    return Buffer.from(await (applyLabels(wb, cfg.excelLabels), wb.xlsx.writeBuffer()))
  }

  // Stato di rischio a inizio anno + variazioni dell'anno, come i loro due fogli.
  const start = insured.filter((p) => p.entryKind === 'iniziale').sort(byName)
    .map((p) => { const c = calc(p, cfg.periodStart); return { p, x: ctx(p, cfg.periodStart, cfg.periodStart, c.gross) } })
  catSheet(wb, `Rinnovo ${program.year}`, statoHeads, start, cfg)
  const ye = yearEndOf(cfg)
  const mov: { p: VitaInsured; x: Ctx }[] = []
  for (const p of insured) {
    const c = calc(p, p.entryDate || cfg.periodStart)
    if (p.entryKind !== 'iniziale' && p.entryDate) {
      const m = movementOf({ kind: 'INCLUSIONE', date: p.entryDate, capital: c.capital, rate: c.rate }, ye, cfg.rules) as { gross: number | null }
      mov.push({ p, x: ctx(p, p.entryDate, p.entryDate, m.gross, 'INCLUSIONE') })
    }
    if (p.exitDate) {
      const m = movementOf({ kind: 'ESCLUSIONE', date: p.exitDate, capital: c.capital, rate: c.rate, paid: { capital: c.capital, rate: c.rate as number } }, ye, cfg.rules) as { gross: number | null }
      mov.push({ p, x: ctx(p, p.entryDate || cfg.periodStart, p.exitDate, m.gross, 'ESCLUSIONE') })
    }
  }
  mov.sort((a, b) => String(a.x.date).localeCompare(String(b.x.date)) || (a.x.azione === 'ESCLUSIONE' ? -1 : 1))
  const ws = catSheet(wb, `Variazioni ${program.year}`, movHeads, mov, cfg, { noCapTotal: true })
  const last = ws.lastRow
  if (last) last.getCell(1).value = `TOTALE ${mov.length} VARIAZIONI`
  ws.addRow([])
  ws.addRow([cfg.rules.exitNextDay !== false ? "Le esclusioni decorrono dal giorno successivo all'ultimo giorno di lavoro indicato dal cliente." : ''])
  ws.addRow([`Pro-rata a giorni su 365 fino al ${fmtDate(ye)}.`])
  void prorata
  return Buffer.from(await (applyLabels(wb, cfg.excelLabels), wb.xlsx.writeBuffer()))
}
