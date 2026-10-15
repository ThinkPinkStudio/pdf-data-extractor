'use client'
// VISTA B — TABELLA PER ANNO (mockup Tabella.dc.html): Campo · Calcolo · anni
// · «Senza anno» · Totale · «B vs A». Gruppi per classe (Portafoglio, Importi,
// Condizioni, Tassi, Verifiche, il campo «raggruppa per»). Il calcolo di ogni
// riga si sceglie dal suo chip (somma / media / minimo–massimo) e resta nel
// riepilogo. Gli anni sono le colonne: il filtro anno qui evidenzia soltanto.
import { Fragment } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { AmountOp, SummaryField, SummaryTableRow, TableGroupKey } from '@/lib/summaryTypes'
import { ActionMenu } from '@/components/jobs/ActionMenu'
import { IcCheck, IcChevDown } from '@/components/jobs/Icons'
import { apiErrorText, countSigned, deltaClass, partialTitle, pctTone, pointsSigned, pctText } from '../format'
import { EMPTY_KEY, OTHER_KEY, type ViewProps } from './types'

const AMOUNT_OPS: AmountOp[] = ['sum', 'avg', 'minmax']
const RATE_OPS: AmountOp[] = ['avg', 'minmax']

export function YearTable({ d, fmt, byId, patch, busy, onError }: ViewProps) {
  const t = useT()
  const tbl = d.table
  const cols = tbl.columns
  const colLabel = (c: (typeof cols)[number]) => (c.year == null ? t('rp.f.noYear') : c.inProgress ? t('rp.f.inProgress', { year: c.year }) : String(c.year))
  const nCols = cols.length + 4

  const groupTitle = (key: TableGroupKey, rows: SummaryTableRow[], fieldId?: string) => {
    switch (key) {
      case 'portfolio': return t('rp.tbl.portfolio')
      case 'amounts': return t('rp.tbl.grpAmounts')
      case 'conditions': return t('rp.tbl.grpConditions')
      case 'rates': return t('rp.tbl.grpRates')
      case 'checks': return t('rp.tbl.grpChecks', { answer: rows[0]?.label || '' })
      case 'group': return t('rp.tbl.grpGroup', { field: (fieldId && byId.get(fieldId)?.label) || '' })
      default: return key
    }
  }

  async function toggleOp(f: SummaryField, op: AmountOp) {
    const allowed = f.kind === 'rate' ? RATE_OPS : AMOUNT_OPS
    const cur = d.prefs.ops[f.id] || []
    const next = cur.includes(op) ? cur.filter((x) => x !== op) : allowed.filter((x) => x === op || cur.includes(x))
    if (!next.length) return
    const out = await patch({ prefs: { ops: { [f.id]: next } } })
    if (!out.ok) onError(apiErrorText(t, out.body, out.status))
  }

  const cell = (row: SummaryTableRow, v: SummaryTableRow['total'], f: SummaryField | undefined) => {
    if (row.op === 'count') return fmt.int(v as number | null)
    if (row.op === 'pct') return fmt.pct(v as number | null)
    return fmt.bare(v, f)
  }

  // Regola unica dei colori (deltaClass): aumento verde, calo o parità
  // neutri; una somma incompleta (delta.partial) neutra con «*» e tooltip.
  const deltaCell = (row: SummaryTableRow): { text: string; cls: string; title?: string } => {
    const dl = row.delta
    if (!dl || row.op === 'minmax') return { text: '—', cls: 'neu' }
    if (row.op === 'count') return { text: countSigned(dl.abs, fmt), cls: deltaClass(dl.abs) }
    if (row.op === 'pct') {
      const s = pointsSigned(dl.abs, fmt)
      return { text: s, cls: s === '=' || s === '—' ? 'neu' : deltaClass(dl.abs) }
    }
    const tone = pctTone(dl)
    const title = tbl.deltaYears ? partialTitle(t, dl, tbl.deltaYears.a, tbl.deltaYears.b) : undefined
    const text = pctText(dl, fmt)
    return { text: title && text !== '—' ? `${text} *` : text, cls: !tone || tone.tone === 'flat' ? 'neu' : deltaClass(tone.tone === 'up' ? 1 : -1, !!title), title }
  }

  // Copertura di una cella numerica: «*» se non tutte le polizze dell'anno hanno il valore.
  const partialOf = (c: { n: number; of: number } | undefined) => (c && c.n < c.of ? t('rp.tbl.partialCell', { n: c.n, of: c.of }) : undefined)
  const anyPartial = tbl.groups.some((g) => g.rows.some((r) => r.cov && Object.values(r.cov).some((c) => c.n < c.of)))
  const nYears = cols.filter((c) => c.year != null).length

  const rowLabel = (row: SummaryTableRow, groupKey: TableGroupKey, f: SummaryField | undefined) => {
    if (groupKey === 'portfolio') return t('rp.tbl.policies')
    if (groupKey === 'group') return row.key === OTHER_KEY ? t('rp.dash.others') : row.key === EMPTY_KEY ? t('rp.dash.empty') : (row.label || row.key || '')
    return f?.label || row.fieldId || ''
  }

  const chip = (row: SummaryTableRow, groupKey: TableGroupKey, f: SummaryField | undefined) => {
    if (row.op === 'count') return <span className="rp-op">{t('rp.op.count')}</span>
    if (row.op === 'pct') return <span className="rp-op">{`% ${row.label || ''}`.trim()}</span>
    if (!f || (f.kind !== 'amount' && f.kind !== 'rate') || groupKey === 'group') return <span className="rp-op">{t(`rp.op.${row.op}`)}</span>
    const allowed = f.kind === 'rate' ? RATE_OPS : AMOUNT_OPS
    const cur = d.prefs.ops[f.id] || []
    return (
      <ActionMenu
        ariaLabel={`${t('rp.tbl.opMenu')} — ${f.label}`}
        className="rp-op"
        trigger={<>{t(`rp.op.${row.op}`)}<IcChevDown /></>}
        items={allowed.map((op) => {
          const on = cur.includes(op)
          const last = on && cur.length === 1
          return {
            id: op,
            label: t(`rp.op.${op}`),
            icon: on ? <IcCheck /> : <span className="rp-noic" aria-hidden="true" />,
            onClick: () => void toggleOp(f, op),
            disabled: busy || last,
            title: last ? t('rp.tbl.opLast') : undefined,
          }
        })}
      />
    )
  }

  return (
    <div className="rp-stack">
      <div className="rp-card rp-tablecard">
        <div className="rp-scrollx">
          <table className="rp-table">
            <thead>
              <tr>
                <th className="l" style={{ minWidth: 220 }}>{t('rp.tbl.field')}</th>
                <th className="l">{t('rp.tbl.calc')}</th>
                {cols.map((c) => <th key={c.key} className={c.ref ? 'cur' : undefined}>{colLabel(c)}</th>)}
                <th>{t('rp.tbl.total')}</th>
                <th>{tbl.deltaYears ? t('rp.tbl.delta', { a: tbl.deltaYears.a, b: tbl.deltaYears.b }) : ''}</th>
              </tr>
            </thead>
            <tbody>
              {tbl.groups.map((g) => (
                <Fragment key={g.key}>
                  <tr className="grp"><td colSpan={nCols}>{groupTitle(g.key, g.rows, g.fieldId)}</td></tr>
                  {g.rows.map((row, i) => {
                    const f = row.fieldId ? byId.get(row.fieldId) : undefined
                    const dc = deltaCell(row)
                    const strong = row.strong ? { fontWeight: 600 } : undefined
                    const label = rowLabel(row, g.key, f)
                    return (
                      <tr key={`${row.fieldId || ''}|${row.op}|${row.key || ''}|${i}`}>
                        <td className="l rp-cellname" style={strong} title={label}>{label}</td>
                        <td className="l">{chip(row, g.key, f)}</td>
                        {cols.map((c) => {
                          const v = row.cells[c.key] ?? null
                          const part = v != null ? partialOf(row.cov?.[c.key]) : undefined
                          return (
                            <td key={c.key} className={c.ref ? 'cur' : undefined} style={c.ref ? strong : undefined} title={part}>
                              {cell(row, v, f)}{part && <span className="rp-part" aria-label={part}>*</span>}
                            </td>
                          )
                        })}
                        <td style={strong} title={row.total != null ? partialOf(row.totalCov) : undefined}>
                          {cell(row, row.total, f)}{row.total != null && partialOf(row.totalCov) && <span className="rp-part" aria-hidden="true">*</span>}
                        </td>
                        <td className={dc.cls} title={dc.title}>{dc.text}</td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="rp-sub">{t('rp.tbl.note')}</p>
      {anyPartial && <p className="rp-sub">{t('rp.tbl.partialNote')}</p>}
      {nYears <= 1 && <p className="rp-sub">{t('rp.tbl.oneYearNote')}</p>}
    </div>
  )
}
