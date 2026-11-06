// ANAGRAFICHE RSM — Excel in uscita.
//  - 'stato': come il file del cliente, per ogni categoria un foglio con la
//    situazione a inizio periodo e uno «Variazioni …» con entrate e uscite
//    (rateo, quota associativa, rimborso), più un riepilogo per categoria;
//  - 'situazione': le righe filtrate nella pagina, con lo stato alla data.
// Solo valori, nessuna formula: gli importi sono quelli di rules.js.
import ExcelJS from 'exceljs'
import { addDays, computeMember, decodeCf, fmtDate, statusAt, round2 } from './rules.js'
import type { RsmMember, RsmProgram } from './types'

const FMT_DATE = 'dd/mm/yyyy'
const FMT_EUR = '#,##0.00'
const STATI: Record<string, string> = { attivo: 'In copertura', cessazione: 'Cessato (coperto fino a fine periodo)', uscito: 'Uscito', promosso: 'Promosso', futuro: 'Non ancora entrato' }
const LEG: Record<string, string> = { TI: 'TI', CO: 'CO', FI: 'FI' }

const toDate = (iso: string | null) => (iso ? new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))) : null)
const age = (birth: string | null, at: string) => {
  if (!birth) return null
  let a = +at.slice(0, 4) - +birth.slice(0, 4)
  if (at.slice(5) < birth.slice(5)) a--
  return a
}

function header(ws: ExcelJS.Worksheet, cols: { h: string; w: number; fmt?: string }[]) {
  ws.columns = cols.map((c) => ({ header: c.h, width: c.w, style: c.fmt ? { numFmt: c.fmt } : {} }))
  const r = ws.getRow(1)
  r.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1B2E' } }
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }
}

const sheetName = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)

export async function rsmWorkbook(program: RsmProgram, members: RsmMember[], kind: 'stato' | 'situazione', at: string): Promise<Buffer> {
  const cfg = program.config
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CSA Suite'
  const nameOf = new Map(members.filter((m) => m.legame === 'TI').map((m) => [`${m.category}|${m.cf}`, `${m.cognome} ${m.nome}`]))
  const titName = (m: RsmMember) => (m.legame === 'TI' ? '' : nameOf.get(`${m.category}|${m.cfTitolare}`) || '')
  const label = (key: string) => cfg.categories.find((c) => c.key === key)?.label || key
  const policy = (key: string) => cfg.categories.find((c) => c.key === key)?.policy || ''

  if (kind === 'situazione') {
    const ws = wb.addWorksheet(sheetName(`Situazione al ${fmtDate(at).replace(/\//g, '-')}`))
    header(ws, [
      { h: 'CATEGORIA', w: 14 }, { h: 'NR. POLIZZA', w: 12 }, { h: 'COGNOME', w: 18 }, { h: 'NOME', w: 16 },
      { h: 'DATA DI NASCITA', w: 13, fmt: FMT_DATE }, { h: "ETA'", w: 6 }, { h: 'SESSO', w: 6 }, { h: 'C.F. ASSICURATO', w: 19 },
      { h: 'C.F. TITOLARE', w: 19 }, { h: 'TITOLARE NUCLEO', w: 24 }, { h: 'LEGAME', w: 8 }, { h: 'QUIESCENTE', w: 10 },
      { h: 'DATA ENTRATA', w: 13, fmt: FMT_DATE }, { h: 'DATA USCITA', w: 13, fmt: FMT_DATE }, { h: 'TIPO USCITA', w: 12 },
      { h: 'STATO', w: 30 }, { h: 'PREMIO ANNUO', w: 13, fmt: FMT_EUR }, { h: 'DOVUTO', w: 12, fmt: FMT_EUR },
      { h: 'RIMBORSO', w: 12, fmt: FMT_EUR }, { h: 'CALCOLO', w: 24 }, { h: 'NOTE', w: 40 },
    ])
    for (const m of members) {
      const c = computeMember(cfg, m)
      ws.addRow([
        label(m.category), policy(m.category), m.cognome, m.nome, toDate(m.birthDate), age(m.birthDate, at), decodeCf(m.cf).sex || '',
        m.cf, m.cfTitolare || '', titName(m), LEG[m.legame], m.quiescente ? 'SI' : 'NO', toDate(m.entryDate), toDate(m.exitDate),
        m.exitKind || '', STATI[statusAt(cfg, m, at)], c.annuo, c.dovuto, c.rimborso, c.calc, m.note || '',
      ])
    }
    return Buffer.from(await wb.xlsx.writeBuffer())
  }

  const summary = wb.addWorksheet('Riepilogo')
  header(summary, [
    { h: 'CATEGORIA', w: 16 }, { h: 'NR. POLIZZA', w: 12 }, { h: 'TESTE A INIZIO PERIODO', w: 14 }, { h: 'TITOLARI A INIZIO PERIODO', w: 14 },
    { h: 'PREMIO INIZIO PERIODO', w: 16, fmt: FMT_EUR }, { h: 'ENTRATE (TESTE)', w: 12 }, { h: 'USCITE (TESTE)', w: 12 },
    { h: 'RATEI ENTRATE', w: 14, fmt: FMT_EUR }, { h: 'RIMBORSI', w: 12, fmt: FMT_EUR }, { h: 'REGOLAZIONE', w: 14, fmt: FMT_EUR },
  ])
  for (const cat of cfg.categories) {
    const rows = members.filter((m) => m.category === cat.key)
    const initial = rows.filter((m) => m.entryKind === 'iniziale')
    const entries = rows.filter((m) => m.entryKind !== 'iniziale')
    const exits = rows.filter((m) => m.exitDate)

    const ws = wb.addWorksheet(sheetName(cat.label.toUpperCase()))
    header(ws, [
      { h: 'CATEGORIA', w: 14 }, { h: 'NR. POLIZZA', w: 12 }, { h: 'COGNOME', w: 18 }, { h: 'NOME', w: 16 }, { h: 'DATA DI NASCITA', w: 13, fmt: FMT_DATE },
      { h: "ETA'", w: 6 }, { h: 'SESSO', w: 6 }, { h: 'C.F. FAMILIARE', w: 19 }, { h: 'C.F. CAPO NUCLEO', w: 19 }, { h: 'TITOLARE NUCLEO', w: 24 },
      { h: 'LEGAME', w: 8 }, { h: 'DATA ENTRATA', w: 13, fmt: FMT_DATE }, { h: 'PREMIO ANNUO', w: 13, fmt: FMT_EUR }, { h: 'Q. A.', w: 8, fmt: FMT_EUR },
      { h: 'TOTALE', w: 12, fmt: FMT_EUR }, { h: 'QUIESCENTE', w: 10 }, { h: 'NOTE', w: 40 },
    ])
    let premio = 0
    for (const m of initial) {
      const c = computeMember(cfg, m)
      premio += c.dovuto
      ws.addRow([
        m.legame === 'TI' ? (m.quiescente ? `${cat.label.toUpperCase()} QUIESCENTI` : cat.label.toUpperCase()) : '', cat.policy, m.cognome, m.nome,
        toDate(m.birthDate), age(m.birthDate, cfg.periodStart), decodeCf(m.cf).sex || '', m.cf, m.cfTitolare || '', titName(m), m.legame,
        toDate(m.entryDate), c.annuo, c.quota, c.dovuto, m.quiescente ? 'SI' : 'NO', m.note || '',
      ])
    }
    const tot = ws.addRow(['TOTALE', '', '', '', null, null, '', '', '', '', '', null, null, null, round2(premio)])
    tot.font = { bold: true }

    const vs = wb.addWorksheet(sheetName(`Variazioni ${cat.label.toUpperCase()}`))
    header(vs, [
      { h: 'CATEGORIA', w: 14 }, { h: 'NR. POLIZZA', w: 12 }, { h: 'COGNOME', w: 18 }, { h: 'NOME', w: 16 }, { h: 'DATA DI NASCITA', w: 13, fmt: FMT_DATE },
      { h: 'C.F. ASSICURATO', w: 19 }, { h: 'C.F. TITOLARE', w: 19 }, { h: 'NUCLEO', w: 24 }, { h: 'LEGAME', w: 8 },
      { h: 'DATA ENTRATA', w: 13, fmt: FMT_DATE }, { h: 'DATA USCITA', w: 13, fmt: FMT_DATE }, { h: 'RATEO LORDO', w: 12, fmt: FMT_EUR },
      { h: 'QUOTA ASSOCIATIVA', w: 12, fmt: FMT_EUR }, { h: 'RATEO COMPLESSIVO', w: 13, fmt: FMT_EUR }, { h: 'RIMBORSO', w: 12, fmt: FMT_EUR },
      { h: 'AZIONE', w: 10 }, { h: 'PROMOZIONE', w: 11 }, { h: 'NOTE', w: 40 },
    ])
    let ratei = 0, rimborsi = 0
    const events = [
      ...entries.map((m) => ({ m, kind: 'ENTRATA' as const, date: m.entryDate || '' })),
      ...exits.map((m) => ({ m, kind: 'USCITA' as const, date: m.exitDate || '' })),
    ].sort((a, b) => a.date.localeCompare(b.date))
    for (const e of events) {
      const c = computeMember(cfg, e.m)
      const isIn = e.kind === 'ENTRATA'
      if (isIn) ratei += c.dovuto
      else rimborsi += c.rimborso
      const promo = isIn ? e.m.entryKind === 'promozione' : e.m.exitKind === 'promozione'
      vs.addRow([
        e.m.legame === 'TI' ? cat.label.toUpperCase() : '', cat.policy, e.m.cognome, e.m.nome, toDate(e.m.birthDate), e.m.cf, e.m.cfTitolare || '',
        titName(e.m), e.m.legame, isIn ? toDate(e.m.entryDate) : null, isIn ? null : toDate(e.m.exitDate),
        isIn ? c.rateo : 0, isIn ? c.quota : 0, isIn ? c.dovuto : 0, isIn ? 0 : c.rimborso, e.kind, promo ? 'SI' : 'NO', e.m.note || '',
      ])
    }
    const vt = vs.addRow(['TOTALE', '', '', '', null, '', '', '', '', null, null, null, null, round2(ratei), round2(rimborsi), '', '', `Regolazione: ${round2(ratei - rimborsi).toFixed(2).replace('.', ',')}`])
    vt.font = { bold: true }

    summary.addRow([
      cat.label, cat.policy, initial.length, initial.filter((m) => m.legame === 'TI').length, round2(premio),
      entries.length, exits.length, round2(ratei), round2(rimborsi), round2(ratei - rimborsi),
    ])
  }
  summary.addRow([])
  summary.addRow([`${program.name} · copertura dal ${fmtDate(cfg.periodStart)} al ${fmtDate(addDays(cfg.periodEnd, -1))} · pro-rata a ${cfg.rules.prorata} · rimborso al netto del ${String(cfg.rules.refundTaxPct).replace('.', ',')}% · esportato il ${fmtDate(at)}`])
  return Buffer.from(await wb.xlsx.writeBuffer())
}
