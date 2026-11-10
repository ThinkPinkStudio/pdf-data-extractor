// POLIZZA VITA — Excel in uscita, fatto come il file del cliente («Elenco
// assicurati VITA»): un foglio per contraente con la situazione a inizio anno,
// un foglio «Movimentazioni …» con entrate e uscite dell'anno e il foglio TASSI.
// Stesse colonne e stesso ordine, perché il cliente lavora su quel file.
// Solo valori, nessuna formula (totali compresi): gli importi sono quelli di rules.js.
import ExcelJS from 'exceljs'
import { computeInsured, fmtDate, movementOf, prorata } from './rules.js'
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

export async function vitaWorkbook(program: VitaProgram, insured: VitaInsured[], kind: 'stato' | 'situazione', at: string): Promise<Buffer> {
  const cfg = program.config
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CSA Suite'
  const yearEnd = `${program.year}-12-31`
  const calc = (p: VitaInsured, on: string) => computeInsured(p, cfg.rates, on, cfg.rules) as {
    age: number | null; rate: number | null; target: number; band: string; capital: number; scopertura: number
    net: number | null; gross: number | null; cover: string
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
      c.net, c.gross == null ? null : cfg.rules.rights, c.gross,
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
    return Buffer.from(await wb.xlsx.writeBuffer())
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
        const m = movementOf({ kind: 'INCLUSIONE', date: p.entryDate, capital: c.capital, rate: c.rate, sovrPct: p.sovrPct }, yearEnd, cfg.rules) as { days: number; net: number | null; gross: number | null }
        mov.push([...base, p.entryKind === 'passaggio' ? 'PASSAGGIO' : 'INCLUSIONE', toDate(p.entryDate), c.age, c.rate, p.ral, c.capital, m.days, m.net, cfg.rules.rights, m.gross, ...tail])
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
  return Buffer.from(await wb.xlsx.writeBuffer())
}
