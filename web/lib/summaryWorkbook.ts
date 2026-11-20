// RIEPILOGHI GENERALI (26/09/2026) — export Excel di un riepilogo.
//
// Riceve il dettaglio già calcolato (composeDetail con values: 'all' e righe
// 'all', nessun filtro) e costruisce quattro fogli: «Per anno» (come la
// Tabella), «Polizze» (una riga per polizza, TUTTI i campi del profilo nell'ordine
// del profilo — Regola 4), «Confronto A-B» e «Info». Intestazioni tradotte lato
// server con messages[lang] (oggetto puro). Numeri veri dove leggibili; il tipo
// di un campo arriva dal server (classifyField, dalla descrizione), mai dalla label.
// Nessun database: si prova da solo (test/summaryServer.cases.mjs).

import ExcelJS from 'exceljs'
import { messages } from './i18n/messages'
import type { Lang } from './i18n/messages'
import { excelSheetName, reservedSheetNames } from './excelSheetName'
import type { AggValue, Delta, SummaryDetail, SummaryField, SummarySvc, SummaryTable, SummaryTableRow } from './summaryTypes'

/** Traduzione con sostituzione {var}, come I18nProvider.translate (ripiego sull'italiano, poi sulla chiave). */
export function tr(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = messages[lang]?.[key] ?? messages.it[key] ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}

/** Lingua dell'export: 'it' | 'en' dalla query, poi dalle impostazioni, poi 'it'. */
export function exportLang(query: string | null | undefined, setting: string | null | undefined): Lang {
  if (query === 'it' || query === 'en') return query
  return setting === 'en' ? 'en' : 'it'
}

/** riepilogo_<nome con [^a-zA-Z0-9_-] → _>_<AAAA-MM-GG>.xlsx (data di Roma). */
export function summaryFileName(name: string, when: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(when)
  return `riepilogo_${String(name || '').replace(/[^a-zA-Z0-9_-]/g, '_')}_${parts}.xlsx`
}

const FMT_AMOUNT = '#,##0.00'
const FMT_RATE = '0.00##'
const FMT_INT = '0'
const FMT_PCT = '0.0%'
const FMT_ABS = '+0;-0;0'
const FMT_PT = '+0.0" pt";-0.0" pt";0.0" pt"'
const FMT_DATE = 'dd/mm/yyyy'
const GROUP_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }

const STATUS_KEY: Record<string, string> = {
  queued: 'jobsDash.stQueued', running: 'jobsDash.stRunning', done: 'jobsDash.stDone', error: 'jobsDash.stError',
  canceled: 'jobsDash.stCanceled', mismatch: 'jobsDash.stMismatch', matched: 'jobsDash.stMatched', review: 'jobsDash.stReview',
}

const isMinMax = (v: AggValue): v is { min: number; max: number } => !!v && typeof v === 'object'

export interface WorkbookInput {
  detail: SummaryDetail
  lang: Lang
  /** Letture dei valori del modulo puro (stessa regola dei calcoli). */
  svc: Pick<SummarySvc, 'parseAmount' | 'parseRate' | 'parseDate' | 'OTHER_KEY' | 'EMPTY_KEY' | 'DOSSIER_KEY'>
  exportedAt?: Date
}

/** Il workbook del riepilogo (4 fogli). */
export function buildSummaryWorkbook({ detail, lang, svc, exportedAt = new Date() }: WorkbookInput): ExcelJS.Workbook {
  const t = (key: string, vars?: Record<string, string | number>) => tr(lang, key, vars)
  const locale = lang === 'en' ? 'en-GB' : 'it-IT'
  const numText = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n)
  const dateText = (secs: number | null | undefined, withTime = false) => (secs == null
    ? ''
    : new Intl.DateTimeFormat(locale, { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) }).format(new Date(secs * 1000)))
  const fieldById = new Map<string, SummaryField>([...detail.fields, ...(detail.removedFields || [])].map((f) => [f.id, f]))
  const labelOf = (id: string | null | undefined) => (id === svc.DOSSIER_KEY ? t('rp.cmp.dossier') : (id && fieldById.get(id)?.label) || id || '')

  const wb = new ExcelJS.Workbook()
  wb.creator = 'PDF Data Extractor'
  wb.created = exportedAt
  const used = reservedSheetNames()

  // ── Per anno
  byYearSheet(wb.addWorksheet(excelSheetName(t('rp.xls.byYear'), used, 'Per anno')), detail.table)

  function numFmtFor(row: SummaryTableRow, groupKey: string): string {
    if (row.op === 'count') return FMT_INT
    if (row.op === 'pct') return FMT_PCT
    const f = row.fieldId ? fieldById.get(row.fieldId) : null
    return f?.kind === 'rate' || groupKey === 'rates' ? FMT_RATE : FMT_AMOUNT
  }

  function byYearSheet(ws: ExcelJS.Worksheet, table: SummaryTable) {
    const cols = table.columns
    const dy = table.deltaYears
    const header = [
      t('rp.tbl.field'),
      t('rp.tbl.calc'),
      ...cols.map((c) => (c.year == null ? t('rp.f.noYear') : c.inProgress ? t('rp.f.inProgress', { year: c.year }) : String(c.year))),
      t('rp.tbl.total'),
      dy ? t('rp.tbl.delta', { a: dy.a, b: dy.b }) : '',
    ]
    const width = header.length
    ws.columns = header.map((_, i) => ({ width: i === 0 ? 38 : i === 1 ? 16 : 15 }))
    const h = ws.addRow(header)
    h.font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }]

    for (const g of table.groups) {
      const title = g.key === 'portfolio' ? t('rp.tbl.portfolio')
        : g.key === 'amounts' ? t('rp.tbl.grpAmounts')
          : g.key === 'conditions' ? t('rp.tbl.grpConditions')
            : g.key === 'rates' ? t('rp.tbl.grpRates')
              : g.key === 'checks' ? t('rp.tbl.grpChecks', { answer: g.rows[0]?.label ?? '' })
                : t('rp.tbl.grpGroup', { field: labelOf(g.fieldId) })
      const gr = ws.addRow([title])
      gr.font = { bold: true }
      for (let i = 1; i <= width; i++) gr.getCell(i).fill = GROUP_FILL

      g.rows.forEach((row, idx) => {
        const label = g.key === 'portfolio' ? t('rp.tbl.policies')
          : g.key === 'group' ? (row.key === svc.OTHER_KEY ? t('rp.dash.others') : row.key === svc.EMPTY_KEY ? t('rp.dash.empty') : row.label ?? '')
            : labelOf(row.fieldId)
        const calc = row.op === 'pct' ? `${t('rp.op.pct')} ${row.label ?? ''}`.trim() : t(`rp.op.${row.op}`)
        const fmt = numFmtFor(row, g.key)
        const cellOf = (v: AggValue) => (v == null ? null : isMinMax(v) ? `${numText(v.min)}–${numText(v.max)}` : v)
        const d = deltaCell(row, g.key)
        const r = ws.addRow([label, calc, ...cols.map((c) => cellOf(row.cells[c.key] ?? null)), cellOf(row.total), d.value])
        for (let i = 3; i <= 3 + cols.length; i++) {
          const cell = r.getCell(i)
          if (typeof cell.value === 'number') cell.numFmt = fmt
          else if (typeof cell.value === 'string') cell.alignment = { horizontal: 'right' }
        }
        if (d.value != null) r.getCell(width).numFmt = d.fmt
        if (row.strong) r.getCell(3 + cols.length).font = { bold: true }
        // Copertura: dopo le righe di un campo, «valorizzate» (polizze con un
        // valore numerico per anno) se in qualche anno manca un valore — una
        // somma con premi vuoti non è un calo.
        const nextRow = g.rows[idx + 1]
        const cov = row.cov
        if (cov && row.totalCov && (!nextRow || nextRow.fieldId !== row.fieldId)) {
          const incomplete = cols.some((c) => cov[c.key] && cov[c.key].n < cov[c.key].of) || row.totalCov.n < row.totalCov.of
          if (incomplete) {
            const cr = ws.addRow([label, t('rp.xls.filled'), ...cols.map((c) => cov[c.key]?.n ?? null), row.totalCov.n, null])
            cr.font = { italic: true, color: { argb: 'FF6B7280' } }
            for (let i = 3; i <= 3 + cols.length; i++) cr.getCell(i).numFmt = FMT_INT
            if (d.value != null && row.delta?.partial) cr.getCell(width).value = t('rp.xls.partialDelta')
          }
        }
      })
    }
  }

  /** «B vs A»: percentuale per Polizze, somme e medie; assoluto per i conteggi del gruppo; punti per le verifiche. */
  function deltaCell(row: SummaryTableRow, groupKey: string): { value: number | null; fmt: string } {
    const d: Delta | null = row.delta
    if (!d || row.op === 'minmax') return { value: null, fmt: '' }
    if (row.op === 'pct') return { value: d.abs == null ? null : d.abs * 100, fmt: FMT_PT }
    if (row.op === 'count' && groupKey !== 'portfolio') return { value: d.abs, fmt: FMT_ABS }
    return { value: d.pct, fmt: FMT_PCT }
  }

  // ── Polizze
  {
    const ws = wb.addWorksheet(excelSheetName(t('rp.xls.policies'), used, 'Polizze'))
    const memberOf = new Map(detail.members.map((m) => [m.jobId, m]))
    const allFields = [...detail.fields, ...(detail.removedFields || [])]
    const header = [t('rp.cmp.policy'), t('rp.xls.path'), t('rp.xls.batch'), t('rp.xls.year'), t('rp.xls.state'), ...allFields.map((f) => f.label)]
    ws.columns = header.map((_, i) => ({ width: i === 0 ? 36 : i === 1 ? 30 : i === 4 ? 26 : i < 5 ? 14 : 20 }))
    ws.addRow(header).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1, xSplit: 1 }]
    for (const p of detail.policies) {
      const m = memberOf.get(p.jobId)
      const state = p.state === 'stale'
        ? t('rp.mem.state.stale', { date: dateText(p.valuesAt), status: m?.status ? t(STATUS_KEY[m.status] || m.status) : '' })
        : t('rp.mem.state.ok')
      const r = ws.addRow([p.name, p.path, m?.batchLabel ?? '', p.year ?? t('rp.f.noYear'), state])
      allFields.forEach((f, i) => {
        const raw = p.values?.[f.id]
        const cell = r.getCell(6 + i)
        if (raw == null || String(raw).trim() === '') return
        if ((f.kind === 'amount' || f.kind === 'rate') && !f.textLike) {
          const n = f.kind === 'rate' ? svc.parseRate(raw) : svc.parseAmount(raw)
          if (n != null) { cell.value = n; cell.numFmt = f.kind === 'rate' ? FMT_RATE : FMT_AMOUNT; return }
        } else if (f.kind === 'date') {
          const d = svc.parseDate(raw)
          if (d) { cell.value = new Date(Date.UTC(d.y, d.m - 1, d.d)); cell.numFmt = FMT_DATE; return }
        }
        cell.value = String(raw)
      })
    }
  }

  // ── Confronto A-B
  {
    const cmp = detail.compare
    const ok = !('error' in cmp)
    const ws = wb.addWorksheet(excelSheetName(t('rp.xls.compare', ok ? { a: cmp.yearA, b: cmp.yearB } : { a: 'A', b: 'B' }), used, 'Confronto'))
    if (!ok) {
      ws.columns = [{ width: 60 }]
      ws.addRow([t(cmp.error === 'same-year' ? 'rp.cmp.sameYear' : 'rp.cmp.needTwo')])
    } else {
      const groupFd = detail.prefs.groupFieldId ? fieldById.get(detail.prefs.groupFieldId) : null
      const amountIds = cmp.rows[0]?.amounts.map((x) => x.fieldId) ?? [...new Set(detail.prefs.highlights.map((h) => h.fieldId))].slice(0, 2)
      const keys = cmp.matchFieldIds.map((k) => labelOf(k))
      ws.addRow([t('rp.cmp.renewed', { year: cmp.yearB }), cmp.continuity.renewed])
      ws.addRow([t('rp.cmp.added', { year: cmp.yearB }), cmp.continuity.added])
      ws.addRow([t('rp.cmp.lost'), cmp.continuity.lost])
      ws.addRow([t('rp.cmp.matchedBy', { list: keys.join(` ${t('rp.cmp.thenBy')} `) })])
      for (const k of cmp.matchFieldIds) {
        const n = cmp.continuity.matchedBy[k] || 0
        if (n) ws.addRow([`  ${labelOf(k)}`, n])
      }
      ws.addRow([])
      const header = [
        t('rp.cmp.policy'),
        ...(groupFd ? [groupFd.label] : []),
        ...amountIds.flatMap((id) => [t('rp.cmp.colYear', { field: labelOf(id), year: cmp.yearA }), t('rp.cmp.colYear', { field: labelOf(id), year: cmp.yearB }), t('rp.cmp.diff')]),
        t('rp.cmp.note'),
      ]
      const headRow = ws.addRow(header)
      headRow.font = { bold: true }
      ws.columns = header.map((_, i) => ({ width: i === 0 ? 36 : i === header.length - 1 ? 44 : 18 }))
      for (const row of cmp.rows) {
        const g = row.group
        // cambio per chiave (il server confronta textKey): «DAS» e «D.A.S.» sono la stessa compagnia
        const groupText = g.changed && g.a && g.b ? `${g.a} → ${g.b}` : (g.b ?? g.a ?? '')
        const notes: string[] = []
        if (row.kind === 'added') notes.push(t('rp.cmp.tagNew'))
        if (row.kind === 'lost') notes.push(t('rp.cmp.tagLost'))
        for (const f of row.changed) notes.push(t('rp.cmp.tagChanged', { field: labelOf(f) }))
        if (row.kind === 'renewed' && row.matchedBy) notes.push(t('rp.cmp.matchedTitle', { field: labelOf(row.matchedBy) }))
        const amountCells = amountIds.flatMap((id) => {
          const a = row.amounts.find((x) => x.fieldId === id)
          return [a?.a ?? null, a?.b ?? null, a?.diff ?? null]
        })
        const r = ws.addRow([row.name, ...(groupFd ? [groupText] : []), ...amountCells, notes.join(' · ')])
        const first = 2 + (groupFd ? 1 : 0)
        amountIds.forEach((id, i) => {
          const f = fieldById.get(id)
          for (let k = 0; k < 3; k++) {
            const c = r.getCell(first + i * 3 + k)
            if (typeof c.value === 'number') c.numFmt = f?.kind === 'rate' ? FMT_RATE : FMT_AMOUNT
          }
        })
      }
    }
  }

  // ── Info
  {
    const ws = wb.addWorksheet(excelSheetName(t('rp.xls.info'), used, 'Info'))
    ws.columns = [{ width: 34 }, { width: 70 }]
    const s = detail.summary
    const c = detail.dashboard.completeness
    const yearField = s.yearFieldId ? labelOf(s.yearFieldId) : '—'
    const rows: [string, string | number][] = [
      [t('rp.xls.name'), s.name],
      [t('rp.xls.profile'), s.profileName || t('rp.profileFromFields', { n: s.fieldCount })],
      [t('rp.xls.mode'), s.mode === 'snapshot' ? t('rp.mode.snapshot', { date: dateText(s.snapshotAt) }) : t('rp.mode.live')],
      [t('rp.xls.yearField'), yearField],
      [t('rp.xls.members'), s.jobCount],
      [t('rp.xls.policiesIn'), detail.policies.length],
      [t('rp.xls.completeness'), `${t('rp.dash.completenessOf', { filled: c.filled, total: c.total })}${c.pct != null ? ` (${Math.round(c.pct * 100)}%)` : ''}`],
      [t('rp.xls.exportedAt'), dateText(Math.floor(exportedAt.getTime() / 1000), true)],
    ]
    for (const [k, v] of rows) ws.addRow([k, v]).getCell(1).font = { bold: true }
    if (detail.warnings.length) {
      ws.addRow([])
      ws.addRow([t('rp.xls.warnings')]).font = { bold: true }
      for (const w of detail.warnings) ws.addRow([t(`rp.warn.${w.code}`, { n: w.jobIds.length })])
    }
  }

  return wb
}

/** Il file xlsx del riepilogo. */
export async function summaryWorkbookBuffer(input: WorkbookInput): Promise<Buffer> {
  return Buffer.from(await buildSummaryWorkbook(input).xlsx.writeBuffer())
}
