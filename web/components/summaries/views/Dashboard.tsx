'use client'
// VISTA A — CRUSCOTTO (mockup Cruscotto.dc.html): carte KPI, colonne per anno
// del primo campo in evidenza, carta del gruppo, scadenze, distribuzione,
// completezza. I campi (in evidenza, «raggruppa per», distribuzione,
// scadenza) sono SCELTE del riepilogo (default dai dati e dalla descrizione,
// mai dalla label): qui si mostrano soltanto.
import Link from 'next/link'
import { useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { SummaryField } from '@/lib/summaryTypes'
import { bucketLabel, deltaClass, lcFirst, opWord, partialTitle, pctTone, policyHref, tn } from '../format'
import { YearBars } from '../charts'
import { BarRow, CardHead } from '../ui'
import type { ViewProps } from './types'

const DUE_ROWS = 5

export function Dashboard({ d, fmt, byId, q, setQ }: ViewProps) {
  const t = useT()
  const dash = d.dashboard
  const yearField = d.summary.yearFieldId ? byId.get(d.summary.yearFieldId) : undefined
  const yf = yearField ? lcFirst(yearField.label) : ''
  const nPol = (n: number) => tn(t, 'rp.dash.nPolicies', n)
  const [dueAll, setDueAll] = useState(false)

  // ── Riga 1: carte KPI
  // Colore dello scarto con la regola unica (deltaClass): aumento verde, calo
  // o parità neutri; una somma con polizze senza valore in uno dei due anni
  // (delta.partial) resta neutra e dice quante polizze hanno il valore.
  const kpis = dash.kpis.map((k) => {
    const f = byId.get(k.fieldId)
    const label = t('rp.kpi.label', { field: f?.label || k.fieldId, op: opWord(t, k.op) })
    let sub: { text: string; cls: string; title?: string } | null = null
    let partial: string | null = null
    const tone = pctTone(k.delta)
    if (k.delta && tone) {
      const vars = { pct: fmt.pct(tone.pct), a: k.delta.yearA, b: k.delta.yearB }
      const text = tone.tone === 'up' ? t('rp.kpi.up', vars) : tone.tone === 'down' ? t('rp.kpi.down', vars) : t('rp.kpi.flat', vars)
      const title = partialTitle(t, k.delta, k.delta.yearA, k.delta.yearB)
      sub = { text: title ? `${text} *` : text, cls: deltaClass(tone.tone === 'up' ? 1 : 0, !!title) === 'jb-c-ok' ? 'jb-c-ok' : 'rp-muted', title }
      partial = title || null
    } else if (k.range) {
      sub = { text: t('rp.kpi.range', { min: fmt.agg(k.range.min, f), max: fmt.agg(k.range.max, f) }), cls: 'rp-muted' }
    } else if (!k.n) {
      sub = { text: t('rp.kpi.noValues'), cls: 'rp-muted' }
    }
    return { key: `${k.fieldId}|${k.op}`, value: fmt.agg(k.value, f), label, sub, partial, nonNumeric: k.nonNumeric, empty: k.n > 0 ? k.empty : 0 }
  })

  // ── Riga 2: colonne per anno + gruppo
  const by = dash.byYear
  const h0 = by ? byId.get(by.fieldId) : undefined
  const group = dash.group
  const groupField = group ? byId.get(group.fieldId) : undefined
  const amountField = group?.amountFieldId ? byId.get(group.amountFieldId) : undefined
  const gTotal = Math.max(1, group?.total || 0)

  // ── Riga 3
  const due = dash.due
  const dueShown = dueAll ? due.items : due.items.slice(0, DUE_ROWS)
  const dist = dash.distribution
  const distField = dist ? byId.get(dist.fieldId) : undefined
  const distTotal = Math.max(1, dash.total)
  const comp = dash.completeness

  return (
    <div className="rp-stack">
      <section className="rp-kpis">
        <div className="rp-card">
          <div className="rp-kv">{fmt.int(dash.total)}</div>
          <div className="rp-kl">{t('rp.kpi.policies')}</div>
          {dash.focusYear != null && dash.focusYearCount != null && yearField && (
            <div className="rp-up rp-muted">{t('rp.kpi.policiesYear', { n: fmt.int(dash.focusYearCount), field: yf, year: dash.focusYear })}</div>
          )}
          {q.anno === 'none' && <div className="rp-up rp-muted">{t('rp.f.noYear')}</div>}
        </div>
        {kpis.map((k) => (
          <div key={k.key} className="rp-card">
            <div className="rp-kv" title={k.value}>{k.value}</div>
            <div className="rp-kl">{k.label}</div>
            {k.sub && <div className={`rp-up ${k.sub.cls}`} title={k.sub.title}>{k.sub.text}</div>}
            {k.partial && <div className="rp-up rp-muted" style={{ marginTop: 2 }}>{k.partial}</div>}
            {!k.partial && k.empty > 0 && <div className="rp-up rp-muted" style={{ marginTop: 2 }}>{tn(t, 'rp.kpi.empty', k.empty)}</div>}
            {k.nonNumeric > 0 && <div className="rp-up rp-muted" style={{ marginTop: 2 }}>{tn(t, 'rp.kpi.nonNumeric', k.nonNumeric)}</div>}
          </div>
        ))}
        {kpis.length === 0 && (
          <div className="rp-card rp-empty" style={{ gridColumn: 'span 2' }}>{t('rp.dash.noAmounts')}</div>
        )}
      </section>

      <section className="rp-g2">
        <div className="rp-card">
          <CardHead
            title={by && h0 ? t('rp.dash.byYear', { field: h0.label, yearField: yf || t('rp.f.noYear') }) : t('rp.dash.trend')}
            sub={by ? t('rp.dash.byYearSub', { op: opWord(t, by.op) }) : undefined}
          />
          {!by || !h0 ? (
            <p className="rp-empty">{t('rp.dash.noAmounts')}</p>
          ) : by.bars.length === 0 ? (
            <p className="rp-empty">{yearField ? t('rp.dash.noYears') : t('rp.dash.noYearField')}</p>
          ) : (
            <YearBars
              bars={by.bars}
              field={h0}
              fmt={fmt}
              ariaLabel={`${t('rp.dash.byYear', { field: h0.label, yearField: yf })}: ${by.bars.map((b) => `${b.year}${b.inProgress ? ` (${t('rp.f.inProgressShort')})` : ''} ${fmt.agg(b.value, h0)}, ${nPol(b.count)}`).join('; ')}`}
              yearLabel={(b, compact) => (b.inProgress && !compact ? t('rp.f.inProgress', { year: b.year }) : String(b.year))}
              countLabel={nPol}
              partialLabel={(b) => (b.n < b.count ? t('rp.tbl.partialCell', { n: fmt.int(b.n), of: fmt.int(b.count) }) : null)}
            />
          )}
        </div>
        <div className="rp-card">
          {group && groupField ? (
            <>
              <CardHead
                title={groupField.label}
                sub={amountField ? t('rp.dash.groupSub', { field: lcFirst(amountField.label) }) : t('rp.dash.groupSubCount')}
              />
              {group.rows.map((r) => (
                <BarRow key={r.key} label={r.label ?? r.key} share={r.count / gTotal} count={fmt.int(r.count)}
                  extra={amountField && r.amount != null ? fmt.agg(r.amount, amountField) : undefined}
                  active={q.gruppo === r.key} onClick={() => setQ({ gruppo: q.gruppo === r.key ? null : r.key })}
                  title={q.gruppo === r.key ? t('rp.dash.groupClear') : t('rp.dash.groupFilter', { value: r.label ?? r.key })} />
              ))}
              {group.other.count > 0 && (
                <BarRow label={t('rp.dash.others')} share={group.other.count / gTotal} count={fmt.int(group.other.count)} fill="muted"
                  extra={amountField && group.other.amount != null ? fmt.agg(group.other.amount, amountField) : undefined}
                  title={tn(t, 'rp.dash.otherDistinct', group.other.distinct)} />
              )}
              {group.empty.count > 0 && (
                <BarRow label={t('rp.dash.empty')} muted share={group.empty.count / gTotal} count={fmt.int(group.empty.count)} fill="muted"
                  extra={amountField && group.empty.amount != null ? fmt.agg(group.empty.amount, amountField) : undefined} />
              )}
              {group.rows.length === 0 && group.other.count === 0 && group.empty.count === 0 && <p className="rp-empty">{t('rp.dash.noPolicies')}</p>}
            </>
          ) : (
            <>
              <CardHead title={t('rp.cfg.groupBy')} />
              <p className="rp-empty">{t('rp.dash.noGroup')}</p>
            </>
          )}
        </div>
      </section>

      <section className="rp-g3">
        <div className="rp-card">
          <CardHead title={t('rp.dash.due', { days: due.days })} sub={due.fieldId ? nPol(due.items.length) : undefined} mb={4} />
          {!due.fieldId ? (
            <p className="rp-empty">{t('rp.dash.dueNoField')}</p>
          ) : due.items.length === 0 ? (
            <p className="rp-empty">{t('rp.dash.dueNone')}</p>
          ) : (
            <>
              {dueShown.map((it) => (
                <div key={it.jobId} className="rp-row">
                  <Link href={policyHref(it.jobId, it.batchId)} className="rp-grow rp-link" title={t('rp.fld.openPolicy')}>{it.name}</Link>
                  {it.group && <span className="rp-sub rp-ell" style={{ maxWidth: 110 }} title={it.group}>{it.group}</span>}
                  <span className="rp-date" title={tn(t, 'rp.dash.inDays', it.days)}>{it.date}</span>
                </div>
              ))}
              {due.items.length > DUE_ROWS && (
                <button type="button" className="rp-linkbtn" onClick={() => setDueAll(!dueAll)}>
                  {dueAll ? t('rp.fld.lessSorted') : `+${due.items.length - DUE_ROWS}`}
                </button>
              )}
            </>
          )}
        </div>
        <div className="rp-card">
          {dist && distField ? (
            <>
              <CardHead title={distField.label} sub={dist.mode === 'values' ? t('rp.dash.byValue') : t('rp.dash.byBand')} mb={4} />
              {dist.items.map((it, i) => (
                <BarRow key={i} label={bucketLabel(it, dist.mode, distField, fmt, true)} share={it.count / distTotal} count={fmt.int(it.count)} fill="info" labelWidth={96} />
              ))}
              {dist.other > 0 && <BarRow label={t('rp.dash.others')} share={dist.other / distTotal} count={fmt.int(dist.other)} fill="muted" labelWidth={96} />}
              {dist.empty > 0 && <BarRow label={t('rp.dash.empty')} muted share={dist.empty / distTotal} count={fmt.int(dist.empty)} fill="muted" labelWidth={96} />}
              {dist.nonNumeric > 0 && <p className="rp-note">{tn(t, 'rp.kpi.nonNumeric', dist.nonNumeric)}</p>}
            </>
          ) : (
            <>
              <CardHead title={t('rp.fld.distribution')} />
              <p className="rp-empty">{t('rp.dash.noAmounts')}</p>
            </>
          )}
        </div>
        <div className="rp-card">
          <CardHead title={t('rp.dash.completeness')} sub={t('rp.dash.completenessSub')} mb={10} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span className="rp-kv">{fmt.pct(comp.pct)}</span>
            <span className="rp-sub">{t('rp.dash.completenessOf', { filled: fmt.int(comp.filled), total: fmt.int(comp.total) })}</span>
          </div>
          <div className="rp-meter" style={{ margin: '10px 0 12px', flex: 'none' }}><span className="rp-fill ok" style={{ width: `${(comp.pct || 0) * 100}%` }} /></div>
          {comp.mostEmpty.length > 0 && (
            <>
              <div className="rp-sub" style={{ marginBottom: 4 }}>{t('rp.dash.mostEmpty')}</div>
              {comp.mostEmpty.map((m) => (
                <div key={m.fieldId} className="rp-row">
                  <span className="rp-grow rp-ell" title={fieldLabel(byId, m.fieldId)}>{fieldLabel(byId, m.fieldId)}</span>
                  <span className="rp-sub">{t('rp.dash.emptyOf', { n: fmt.int(m.empty), of: fmt.int(m.of) })}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  )
}

function fieldLabel(byId: Map<string, SummaryField>, id: string): string {
  return byId.get(id)?.label || id
}
