// ANAGRAFICHE RSM — Excel in uscita.
//  - 'stato': come il file del cliente, per ogni categoria un foglio con la
//    situazione a inizio periodo e uno «Variazioni …» con entrate e uscite
//    (rateo, quota associativa, rimborso), più un riepilogo per categoria;
//  - 'situazione': le righe filtrate nella pagina, con lo stato alla data;
//  - 'rinnovo': lo stato di rischio «pulito» per l'anno dopo (renewalPlan):
//    per categoria chi è in copertura al primo giorno, gli avvisi (età, nucleo)
//    e in fondo il promemoria di chi decorre nell'anno nuovo; un foglio con chi
//    esce, perché il cliente controlli anche quelli.
// Solo valori, nessuna formula: gli importi sono quelli di rules.js.
import ExcelJS from 'exceljs'
import { describeValue } from '../configValue.js'
import { quotaOf, refundTaxOf } from './rules.js'
import { addDays, annualPremium, categoryOf, computeMember, decodeCf, fmtDate, layoutCode, memberAge, renewalPlan, statusAt, round2 } from './rules.js'
import type { RsmMember, RsmProgram } from './types'

const FMT_DATE = 'dd/mm/yyyy'
const FMT_EUR = '#,##0.00'
const STATI: Record<string, string> = { attivo: 'In copertura', cessazione: 'Cessato (coperto fino a fine periodo)', uscito: 'Uscito', promosso: 'Promosso', futuro: 'Non ancora entrato' }
const LEG: Record<string, string> = { TI: 'TI', CO: 'CO', FI: 'FI', FA: 'FA' }

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

const eur = (n: number) => n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const sheetName = (s: string) => s.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)

export async function rsmWorkbook(program: RsmProgram, members: RsmMember[], kind: 'stato' | 'situazione' | 'rinnovo', at: string): Promise<Buffer> {
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

  if (kind === 'rinnovo') {
    const plan = renewalPlan(cfg, members)
    const start = plan.at
    const nextYear = +start.slice(0, 4)
    const cols = [
      { h: 'CATEGORIA', w: 14 }, { h: 'NR. POLIZZA', w: 12 }, { h: 'COGNOME', w: 18 }, { h: 'NOME', w: 16 }, { h: 'DATA DI NASCITA', w: 13, fmt: FMT_DATE },
      { h: `ETA' AL ${fmtDate(start)}`, w: 9 }, { h: 'SESSO', w: 6 }, { h: 'C.F. FAMILIARE', w: 19 }, { h: 'C.F. CAPO NUCLEO', w: 19 }, { h: 'TITOLARE NUCLEO', w: 24 },
      { h: 'LEGAME', w: 8 }, { h: 'DATA ENTRATA', w: 13, fmt: FMT_DATE }, { h: `PREMIO ANNUO (TARIFFE ${program.year})`, w: 14, fmt: FMT_EUR },
      { h: 'QUIESCENTE', w: 10 }, { h: 'AVVISI', w: 50 }, { h: 'NOTE', w: 40 },
    ]
    const premium = (m: RsmMember) => annualPremium(cfg, m.category, m.legame, m.quiescente, categoryOf(cfg, m.category)?.tariffBy === 'eta' ? memberAge(cfg, m) : null) || null
    const row = (m: RsmMember, alerts: string[], first: boolean) => [
      m.legame === 'TI' && first ? label(m.category).toUpperCase() : '', policy(m.category), m.cognome, m.nome, toDate(m.birthDate),
      age(m.birthDate, start), decodeCf(m.cf).sex || '', m.cf, m.cfTitolare || '', titName(m), m.legame, toDate(m.entryDate),
      premium(m), m.quiescente ? 'SI' : 'NO', alerts.join('; '), m.note || '',
    ]
    // Titolare e poi il suo nucleo, come nel file del cliente.
    const byNucleus = <T extends { m: RsmMember }>(list: T[]) => [...list].sort((a, b) => {
      const ka = a.m.legame === 'TI' ? a.m.cf : a.m.cfTitolare || a.m.cf
      const kb = b.m.legame === 'TI' ? b.m.cf : b.m.cfTitolare || b.m.cf
      const na = nameOf.get(`${a.m.category}|${ka}`) || `${a.m.cognome} ${a.m.nome}`
      const nb = nameOf.get(`${b.m.category}|${kb}`) || `${b.m.cognome} ${b.m.nome}`
      return na.localeCompare(nb, 'it') || ka.localeCompare(kb) || (a.m.legame === 'TI' ? -1 : 0) - (b.m.legame === 'TI' ? -1 : 0)
    })
    // File della società col suo tracciato: stesse colonne, stesso ordine, stessi
    // codici; come il file del cliente, UN foglio per categoria con chi è in
    // copertura al primo giorno e, se ci sono, un foglio «Variazioni …» per
    // categoria con le entrate che decorrono nell'anno nuovo (le prime
    // movimentazioni). La colonna categoria resta compilata su ogni riga: il file
    // torna indietro e si ricarica con l'import senza domande. Le colonne che il
    // programma non legge (età, sesso, titolare del nucleo, premio, quota,
    // totale, azienda) si compilano dai dati: premi con le tariffe dell'anno in
    // corso, finché il programma dell'anno nuovo non ha le sue.
    const layout = cfg.fileLayout
    if (layout && layout.order && layout.order.length) {
      const norm = (h: string) => h.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()
      const heads = [...layout.order]
      if (!heads.some((h) => norm(h) === 'AVVISI')) heads.push('AVVISI')
      const quota = (m: RsmMember) => {
        const annuo = premium(m) || 0
        return m.legame === 'TI' && annuo > 0 ? quotaOf(categoryOf(cfg, m.category), annuo) : 0
      }
      // Colonne calcolate, riconosciute dall'intestazione (solo se il tracciato non dà già il dato).
      const derived = (m: RsmMember, h: string): ExcelJS.CellValue | undefined => {
        if (/^(AZIENDA|SOCIETA|CONTRAENTE)\b/.test(h)) return cfg.fileCompany || program.company
        if (/^ETA\b/.test(h)) return age(m.birthDate, start)
        if (/^SESSO\b/.test(h)) return decodeCf(m.cf).sex || ''
        if (/^(TITOLARE( DEL)? NUCLEO|NUCLEO|NOMINATIVO TITOLARE)$/.test(h)) return titName(m)
        if (/^(PREMIO|IMPORTO PREMIO)/.test(h)) return premium(m)
        if (/^(Q A|QUOTA( ASSOCIATIVA)?)$/.test(h)) return quota(m) || null
        if (/^TOTALE( PREMIO)?$/.test(h)) return round2((premium(m) || 0) + quota(m)) || null
        return undefined
      }
      const value = (m: RsmMember, head: string, alerts: string[]): ExcelJS.CellValue => {
        const h = norm(head)
        const f = layout.columns[h]
        if (h === 'AVVISI' && !f) return alerts.join('; ')
        switch (f) {
          case 'cognome': return m.cognome
          case 'nome': return m.nome
          case 'cfAss': return m.cf
          case 'cfTit': return m.cfTitolare || ''
          case 'legame': return layoutCode(layout, 'legame', m.legame) || m.legame
          // su ogni riga, anche dei familiari: con un foglio per categoria è la chiave della riga all'import
          case 'categoria': return layoutCode(layout, 'categoria', m.quiescente ? `${m.category}|Q` : m.category) || layoutCode(layout, 'categoria', m.category) || label(m.category).toUpperCase()
          case 'nascita': return toDate(m.birthDate)
          case 'entrata': return toDate(m.entryDate)
          case 'polizza': return policy(m.category) || ''
          case 'quiescente': return m.quiescente ? 'SI' : 'NO'
          case 'note': return m.note || ''
          case 'societa': return cfg.fileCompany || program.company
          case 'extra': {
            const v = m.extra && m.extra[head]
            if (v != null && v !== '') return v
            return derived(m, h) ?? ''
          }
          case 'uscita': case 'azione': case 'promozione': return ''
          default: return derived(m, h) ?? ''
        }
      }
      const dateCols = new Set(heads.map((h, i) => (['nascita', 'entrata'].includes(layout.columns[norm(h)]) ? i + 1 : 0)).filter(Boolean))
      const free = (h: string) => { const f = layout.columns[norm(h)]; return !f || f === 'skip' || f === 'extra' }
      const eurCols = new Set(heads.map((h, i) => (free(h) && /^(PREMIO|IMPORTO PREMIO|Q A$|QUOTA|TOTALE)/.test(norm(h)) ? i + 1 : 0)).filter(Boolean))
      const cols = heads.map((h, i) => ({ h, w: Math.max(10, Math.min(30, h.length + 4)), fmt: dateCols.has(i + 1) ? FMT_DATE : eurCols.has(i + 1) ? FMT_EUR : undefined }))
      const sum = wb.addWorksheet('Riepilogo')
      header(sum, [{ h: 'CATEGORIA', w: 16 }, { h: 'NR. POLIZZA', w: 12 }, { h: `IN COPERTURA AL ${fmtDate(start)}`, w: 16 }, { h: 'DI CUI TITOLARI', w: 12 },
        { h: `PREMIO ANNUO (TARIFFE ${program.year})`, w: 16, fmt: FMT_EUR }, { h: `USCITI NEL ${program.year}`, w: 12 }, { h: `ENTRATE DAL ${fmtDate(start)} (VARIAZIONI)`, w: 16 }, { h: 'CON AVVISI', w: 11 }])
      for (const cat of cfg.categories) {
        const keep = byNucleus(plan.keep.filter((x) => x.m.category === cat.key))
        const nxt = byNucleus(plan.next.filter((x) => x.m.category === cat.key))
        const out = plan.dropped.filter((x) => x.m.category === cat.key)
        if (!keep.length && !nxt.length && !out.length) continue
        const ws = wb.addWorksheet(sheetName(cat.label.toUpperCase()))
        header(ws, cols)
        for (const x of keep) {
          const r = ws.addRow(heads.map((h) => value(x.m, h, x.alerts)))
          if (x.alerts.length) r.getCell(heads.length).font = { bold: true, color: { argb: 'FFB42318' } }
        }
        const total = round2(keep.reduce((s, x) => s + (premium(x.m) || 0) + quota(x.m), 0))
        // Tutto nella prima cella: una riga col testo sotto COGNOME sembrerebbe una persona all'import.
        ws.addRow([`TOTALE ${keep.length} ASSICURATI · PREMIO ${eur(total)} (TARIFFE ${program.year})`]).font = { bold: true }
        if (nxt.length) {
          const vs = wb.addWorksheet(sheetName(`Variazioni ${cat.label.toUpperCase()}`))
          header(vs, cols)
          for (const x of nxt) {
            const r = vs.addRow(heads.map((h) => value(x.m, h, x.alerts)))
            if (x.alerts.length) r.getCell(heads.length).font = { bold: true, color: { argb: 'FFB42318' } }
          }
          vs.addRow([`TOTALE ${nxt.length} ENTRATE CON DECORRENZA DAL ${fmtDate(start)} O DOPO`]).font = { bold: true }
        }
        sum.addRow([cat.label, cat.policy, keep.length, keep.filter((x) => x.m.legame === 'TI').length, total, out.length, nxt.length, keep.concat(nxt).filter((x) => x.alerts.length).length])
      }
      if (plan.dropped.length) {
        const ws = wb.addWorksheet(sheetName(`Usciti nel ${program.year}`))
        header(ws, [{ h: 'CATEGORIA', w: 14 }, { h: 'NOMINATIVO', w: 30 }, { h: 'C.F.', w: 19 }, { h: 'LEGAME', w: 8 }, { h: 'DATA USCITA', w: 13, fmt: FMT_DATE }, { h: 'MOTIVO', w: 30 }, { h: 'NOTE', w: 40 }])
        for (const x of [...plan.dropped].sort((a, b) => String(a.m.exitDate).localeCompare(String(b.m.exitDate)))) {
          ws.addRow([label(x.m.category), `${x.m.cognome} ${x.m.nome}`, x.m.cf, x.m.legame, toDate(x.m.exitDate), x.reason === 'promozione' ? 'promozione (è nella categoria nuova)' : 'cessazione', x.m.note || ''])
        }
      }
      sum.addRow([])
      sum.addRow([`${program.name} · stato di rischio per il ${nextYear}: chi è in copertura al ${fmtDate(start)} · colonne del file della società · premi con le tariffe ${program.year} (da aggiornare se cambiano nel ${nextYear}) · limite d'età ${Number(cfg.rules.maxAge) || 80} anni (solo avviso) · esportato il ${fmtDate(at)}`])
      return Buffer.from(await wb.xlsx.writeBuffer())
    }
    const sum = wb.addWorksheet('Riepilogo')
    header(sum, [{ h: 'CATEGORIA', w: 16 }, { h: 'NR. POLIZZA', w: 12 }, { h: `IN COPERTURA AL ${fmtDate(start)}`, w: 16 }, { h: 'DI CUI TITOLARI', w: 12 },
      { h: `USCITI NEL ${program.year}`, w: 12 }, { h: `DA INSERIRE NEL ${nextYear}`, w: 14 }, { h: 'CON AVVISI', w: 11 }])
    for (const cat of cfg.categories) {
      const keep = byNucleus(plan.keep.filter((x) => x.m.category === cat.key))
      const nxt = byNucleus(plan.next.filter((x) => x.m.category === cat.key))
      const out = plan.dropped.filter((x) => x.m.category === cat.key)
      if (!keep.length && !nxt.length && !out.length) continue
      const ws = wb.addWorksheet(sheetName(cat.label.toUpperCase()))
      header(ws, cols)
      for (const x of keep) {
        const r = ws.addRow(row(x.m, x.alerts, true))
        if (x.alerts.length) r.getCell(15).font = { bold: true, color: { argb: 'FFB42318' } }
      }
      // Tutto nella prima cella: una riga col testo sotto COGNOME sembrerebbe una persona all'import.
      const tot = ws.addRow([`TOTALE ${keep.length} ASSICURATI`])
      tot.font = { bold: true }
      if (nxt.length) {
        ws.addRow([])
        const t = ws.addRow([`PROMEMORIA · COMUNICATI ENTRO IL ${fmtDate(addDays(start, -1))} CON DECORRENZA DAL ${fmtDate(start)} O DOPO (da inserire nel ${nextYear})`])
        t.font = { bold: true }
        for (const x of nxt) {
          const r = ws.addRow(row(x.m, x.alerts, true))
          r.font = { italic: true }
        }
      }
      sum.addRow([cat.label, cat.policy, keep.length, keep.filter((x) => x.m.legame === 'TI').length, out.length, nxt.length, keep.concat(nxt).filter((x) => x.alerts.length).length])
    }
    if (plan.dropped.length) {
      const ws = wb.addWorksheet(sheetName(`Usciti nel ${program.year}`))
      // NOMINATIVO e non COGNOME/NOME: se il file torna indietro, questo foglio
      // non deve sembrare un elenco di assicurati.
      header(ws, [{ h: 'CATEGORIA', w: 14 }, { h: 'NOMINATIVO', w: 30 }, { h: 'C.F.', w: 19 }, { h: 'LEGAME', w: 8 },
        { h: 'DATA USCITA', w: 13, fmt: FMT_DATE }, { h: 'MOTIVO', w: 30 }, { h: 'NOTE', w: 40 }])
      for (const x of [...plan.dropped].sort((a, b) => String(a.m.exitDate).localeCompare(String(b.m.exitDate)))) {
        ws.addRow([label(x.m.category), `${x.m.cognome} ${x.m.nome}`, x.m.cf, x.m.legame, toDate(x.m.exitDate),
          x.reason === 'promozione' ? 'promozione (è nella categoria nuova)' : 'cessazione', x.m.note || ''])
      }
    }
    sum.addRow([])
    sum.addRow([`${program.name} · stato di rischio per il ${nextYear}: chi è in copertura al ${fmtDate(start)} · limite d'età ${Number(cfg.rules.maxAge) || 80} anni (solo avviso) · esportato il ${fmtDate(at)}`])
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
  summary.addRow([`${program.name} · copertura dal ${fmtDate(cfg.periodStart)} al ${fmtDate(addDays(cfg.periodEnd, -1))} · pro-rata a ${cfg.rules.prorata} · trattenuta sul rimborso ${describeValue(refundTaxOf(cfg), { rimborso: 'rimborso' })} · esportato il ${fmtDate(at)}`])
  return Buffer.from(await wb.xlsx.writeBuffer())
}
