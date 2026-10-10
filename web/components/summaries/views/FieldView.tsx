'use client'
// VISTA C — PER CAMPO (mockup Campo.dc.html): elenco dei campi a sinistra,
// raggruppati per TIPO (letto dal server dalla descrizione del campo), e a
// destra le statistiche del campo scelto: importi e tassi (somma, media,
// mediana, minimo, massimo, vuoti, distribuzione, per anno, valori più alti),
// date, verifiche, testi; gli identificativi solo polizza per polizza.
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type {
  CheckFieldStats, DateFieldStats, NumericFieldStats, SummaryField, SummaryFieldStats, SummaryPolicy, TextFieldStats,
} from '@/lib/summaryTypes'
import { bucketLabel, lcFirst, policyHref, tn, type Fmt } from '../format'
import { Histogram, type HistItem } from '../charts'
import { BarRow, CardHead } from '../ui'
import type { ViewProps } from './types'

const GROUP_ORDER = ['amount', 'rate', 'date', 'check', 'text'] as const
const TOP_ROWS = 4

export function FieldView({ d, fmt, byId, q, setQ, busy }: Pick<ViewProps, 'd' | 'fmt' | 'byId' | 'q' | 'setQ' | 'busy'>) {
  const t = useT()
  const fields = d.fields
  const removed = d.removedFields || []
  const perPolicy = fields.filter((f) => f.group === 'identifier')
  const selectedId = (q.campo && byId.has(q.campo) ? q.campo : null) || d.view.field || fields.find((f) => f.group === 'amount')?.id || fields[0]?.id || null
  const f = selectedId ? byId.get(selectedId) : undefined
  const fs = selectedId ? d.fieldStats[selectedId] : undefined

  const tagOf = (x: SummaryField): string => {
    if (x.group === 'amount') return x.unit === 'num' ? t('rp.fld.tag.num') : '€'
    if (x.group === 'rate') return t('rp.fld.tag.rate')
    if (x.group === 'date') return t('rp.fld.tag.year')
    if (x.group === 'check') return '%'
    if (x.group === 'text') return t('rp.fld.tag.counts')
    return ''
  }
  const item = (x: SummaryField, tag = tagOf(x)) => (
    <button key={x.id} type="button" className={`rp-fi${x.id === selectedId ? ' on' : ''}`} aria-pressed={x.id === selectedId}
      onClick={() => setQ({ campo: x.id })} title={x.label}>
      <span className="lb">{x.label}</span>{tag && <span className="rp-k">{tag}</span>}
    </button>
  )

  return (
    <div className="rp-fv">
      <nav className="rp-card rp-fl" aria-label={t('rp.view.field')}>
        {GROUP_ORDER.map((g) => {
          const list = fields.filter((x) => x.group === g)
          if (!list.length) return null
          return (
            <div key={g} className="rp-flg">
              <div className="rp-gt">{t(`rp.fld.grp.${g}`, { n: list.length })}</div>
              {list.map((x) => item(x))}
            </div>
          )
        })}
        {perPolicy.length > 0 && (
          <div className="rp-flg">
            <div className="rp-gt">{t('rp.fld.grp.identifier')}</div>
            {perPolicy.map((x) => item(x, ''))}
            <div className="rp-sub" style={{ padding: '2px 10px 4px' }}>{t('rp.fld.identifierHint')}</div>
          </div>
        )}
        {removed.length > 0 && (
          <div className="rp-flg">
            <div className="rp-gt">{t('rp.fld.grp.removed', { n: removed.length })}</div>
            {removed.map((x) => item(x, ''))}
          </div>
        )}
      </nav>
      <div className="rp-fc">
        {!f || !fs ? (
          <div className="rp-card rp-empty">{t('rp.fld.none')}</div>
        ) : (
          <FieldDetail f={f} fs={fs} d={d} fmt={fmt} busy={busy} />
        )}
      </div>
    </div>
  )
}

function kindKey(f: SummaryField): string {
  if (f.group === 'identifier' && f.kind === 'text') return 'text'
  return f.kind
}

interface DetailProps { f: SummaryField; fs: SummaryFieldStats; d: ViewProps['d']; fmt: Fmt; busy: boolean }

function FieldDetail({ f, fs, d, fmt, busy }: DetailProps) {
  const t = useT()
  const N = d.dashboard.total
  const inProgress = useMemo(() => new Set(d.view.years.filter((y) => y.inProgress && y.year != null).map((y) => y.year as number)), [d.view.years])
  const yearName = (y: number | null) => (y == null ? t('rp.f.noYear') : inProgress.has(y) ? t('rp.f.inProgressShortYear', { year: y }) : String(y))
  const head = (
    <div className="rp-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{f.label}</h2>
        <span className="rp-chip">{t('rp.fld.kindChip', { kind: t(`rp.fld.kind.${kindKey(f)}`) })}</span>
        {f.unique && <span className="rp-chip">{t('rp.fld.uniqueHint')}</span>}
        {f.group === 'removed' && <span className="rp-chip">{t('rp.fld.removedHint')}</span>}
      </div>
      <StatsGrid f={f} fs={fs} N={N} fmt={fmt} />
    </div>
  )

  // Identificativi e testi «per polizza»: solo l'elenco.
  if (f.group === 'identifier') {
    return (
      <div className="rp-stack">
        {head}
        <PerPolicy f={f} policies={d.policies} />
      </div>
    )
  }

  if ((f.kind === 'amount' || f.kind === 'rate') && !f.textLike && 'buckets' in fs) {
    const ns = fs as NumericFieldStats
    const hist: HistItem[] = [
      ...ns.buckets.items.map((it, i) => ({ key: String(i), label: bucketLabel(it, ns.buckets.mode, f, fmt, false), count: it.count })),
      ...(ns.buckets.other > 0 ? [{ key: 'other', label: t('rp.dash.others'), count: ns.buckets.other, muted: true }] : []),
    ]
    return (
      <div className="rp-stack">
        {head}
        <div className="rp-g13">
          <div className="rp-card">
            <CardHead title={t('rp.fld.distribution')} sub={ns.buckets.mode === 'values' ? t('rp.dash.byValue') : t('rp.dash.byBand')} />
            {ns.n > 0 ? (
              <Histogram items={hist} ariaLabel={`${t('rp.fld.distribution')} — ${f.label}: ${hist.map((h) => `${h.label} ${h.count}`).join(', ')}`} />
            ) : <p className="rp-empty">{t('rp.kpi.noValues')}</p>}
          </div>
          <div className="rp-card">
            <CardHead title={t('rp.fld.byYear', { field: yearFieldLabel(d) })} sub={f.kind === 'amount' ? t('rp.fld.byYearSub') : t('rp.op.avgWord')} mb={6} />
            {ns.byYear.map((r) => {
              // copertura: quante polizze dell'anno hanno il valore (una somma su 6 di 10 non è un calo)
              const part = r.n < r.of ? t('rp.tbl.partialCell', { n: fmt.int(r.n), of: fmt.int(r.of) }) : undefined
              return (
                <div key={String(r.year)} className="rp-row">
                  <span style={{ width: 110, fontWeight: r.ref ? 600 : undefined }} className={r.year != null && inProgress.has(r.year) ? 'rp-muted' : undefined}>{yearName(r.year)}</span>
                  <span className="rp-grow" style={{ fontWeight: r.ref ? 600 : undefined }} title={part}>
                    {f.kind === 'amount' ? fmt.agg(r.sum ?? null, f) : fmt.agg(r.avg, f)}{part && <span className="rp-part" aria-hidden="true">*</span>}
                  </span>
                  {f.kind === 'amount' && <span className="rp-sub">⌀ {fmt.agg(r.avg, f)}</span>}
                  {part && <span className="rp-sub" style={{ width: 64, textAlign: 'right' }} title={part}>{t('rp.fld.filledOf', { n: fmt.int(r.n), of: fmt.int(r.of) })}</span>}
                </div>
              )
            })}
            {!ns.byYear.length && <p className="rp-empty">{t('rp.dash.noYears')}</p>}
          </div>
        </div>
        <TopValues f={f} ns={ns} d={d} fmt={fmt} busy={busy} />
      </div>
    )
  }

  if (f.kind === 'date' && 'first' in fs && !('answers' in fs)) {
    const ds = fs as DateFieldStats
    const hist: HistItem[] = ds.byYear.map((r) => ({ key: String(r.year), label: String(r.year), count: r.n }))
    return (
      <div className="rp-stack">
        {head}
        <div className="rp-g13">
          <div className="rp-card">
            <CardHead title={t('rp.fld.perYear')} sub={t('rp.fld.policiesPerYear')} />
            {hist.length ? <Histogram items={hist} ariaLabel={`${f.label}: ${hist.map((h) => `${h.label} ${h.count}`).join(', ')}`} /> : <p className="rp-empty">{t('rp.kpi.noValues')}</p>}
          </div>
          <div className="rp-card">
            <CardHead title={t('rp.fld.perYear')} mb={6} />
            {ds.byYear.map((r) => (
              <div key={r.year} className="rp-row">
                <span className="rp-grow">{yearName(r.year)}</span>
                <span className="rp-sub">{tn(t, 'rp.dash.nPolicies', r.n)}</span>
              </div>
            ))}
            {ds.invalid > 0 && <p className="rp-note">{tn(t, 'rp.fld.invalidDates', ds.invalid)}</p>}
          </div>
        </div>
      </div>
    )
  }

  if (f.kind === 'check' && 'answers' in fs && Array.isArray((fs as CheckFieldStats).answers) && (fs as CheckFieldStats).answers.length && typeof (fs as CheckFieldStats).other === 'number') {
    const cs = fs as CheckFieldStats
    const total = Math.max(1, N)
    return (
      <div className="rp-stack">
        {head}
        <div className="rp-g13">
          <div className="rp-card">
            <CardHead title={t('rp.fld.answers')} sub={tn(t, 'rp.dash.nPolicies', N)} mb={4} />
            {cs.answers.map((a) => (
              <BarRow key={a.answer} label={a.answer} share={a.count / total} count={fmt.int(a.count)} extra={fmt.pct(a.pct)} labelWidth={96} />
            ))}
            {cs.other > 0 && <BarRow label={t('rp.fld.otherAnswers')} share={cs.other / total} count={fmt.int(cs.other)} fill="muted" labelWidth={96} />}
            {cs.empty > 0 && <BarRow label={t('rp.dash.empty')} muted share={cs.empty / total} count={fmt.int(cs.empty)} fill="muted" labelWidth={96} />}
          </div>
          <div className="rp-card">
            <CardHead title={t('rp.fld.byYear', { field: yearFieldLabel(d) })} sub={t('rp.fld.pctOf', { answer: cs.first })} mb={6} />
            {cs.byYear.map((r) => (
              <div key={String(r.year)} className="rp-row">
                <span className="rp-grow" style={{ fontWeight: r.ref ? 600 : undefined }}>{yearName(r.year)}</span>
                <span style={{ fontWeight: r.ref ? 600 : undefined }}>{fmt.pct(r.pctFirst)}</span>
                <span className="rp-sub" style={{ width: 90, textAlign: 'right' }}>{tn(t, 'rp.dash.nPolicies', r.n)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Testi (e importi senza numeri, verifiche senza risposte citate).
  const ts = fs as TextFieldStats
  const total = Math.max(1, N)
  return (
    <div className="rp-stack">
      {head}
      <div className="rp-card">
        <CardHead title={t('rp.fld.frequent')} sub={tn(t, 'rp.dash.nPolicies', N)} mb={4} />
        {(ts.values || []).map((v) => (
          <BarRow key={v.key} label={v.label} share={v.count / total} count={fmt.int(v.count)} labelWidth={220} />
        ))}
        {ts.other && ts.other.count > 0 && (
          <BarRow label={t('rp.dash.others')} share={ts.other.count / total} count={fmt.int(ts.other.count)} fill="muted" labelWidth={220}
            title={tn(t, 'rp.dash.otherDistinct', ts.other.distinct)} />
        )}
        {ts.empty > 0 && <BarRow label={t('rp.dash.empty')} muted share={ts.empty / total} count={fmt.int(ts.empty)} fill="muted" labelWidth={220} />}
        {!(ts.values || []).length && !ts.empty && <p className="rp-empty">{t('rp.kpi.noValues')}</p>}
      </div>
    </div>
  )
}

function yearFieldLabel(d: ViewProps['d']): string {
  const id = d.summary.yearFieldId
  const f = id ? d.fields.find((x) => x.id === id) : undefined
  return f ? lcFirst(f.label) : ''
}

function StatsGrid({ f, fs, N, fmt }: { f: SummaryField; fs: SummaryFieldStats; N: number; fmt: Fmt }) {
  const t = useT()
  const stats: { label: string; value: string; warn?: boolean }[] = []
  const emptyStat = (empty: number) => ({ label: t('rp.fld.empty'), value: `${fmt.int(empty)} / ${fmt.int(N)}`, warn: empty > 0 })
  let extra: string | null = null
  if ((f.kind === 'amount' || f.kind === 'rate') && !f.textLike && 'buckets' in fs) {
    const ns = fs as NumericFieldStats
    if (f.kind === 'amount') stats.push({ label: t('rp.fld.sum'), value: fmt.agg(ns.sum ?? null, f) })
    stats.push({ label: t('rp.fld.avg'), value: fmt.agg(ns.avg, f) })
    stats.push({ label: t('rp.fld.median'), value: fmt.agg(ns.median, f) })
    stats.push({ label: t('rp.fld.min'), value: fmt.agg(ns.min, f) })
    stats.push({ label: t('rp.fld.max'), value: fmt.agg(ns.max, f) })
    stats.push(emptyStat(ns.empty))
    const nn = ns.nonNumeric || []
    if (nn.length) {
      const n = nn.reduce((a, x) => a + x.count, 0)
      extra = tn(t, 'rp.fld.nonNumeric', n, { list: nn.slice(0, 5).map((x) => `«${x.value}» (${x.count})`).join(', ') })
    }
  } else if (f.kind === 'date' && 'first' in fs && !('answers' in fs)) {
    const ds = fs as DateFieldStats
    stats.push({ label: t('rp.fld.first'), value: ds.first || '—' })
    stats.push({ label: t('rp.fld.last'), value: ds.last || '—' })
    stats.push(emptyStat(ds.empty))
  } else if (f.group === 'identifier') {
    const s = fs as { n: number; empty: number; distinct?: number }
    if (typeof s.distinct === 'number') stats.push({ label: t('rp.fld.distinct'), value: fmt.int(s.distinct) })
    stats.push(emptyStat(s.empty))
  } else if (f.kind === 'check' && 'answers' in fs && typeof (fs as CheckFieldStats).other === 'number' && (fs as CheckFieldStats).answers.length) {
    const cs = fs as CheckFieldStats
    for (const a of cs.answers.slice(0, 3)) stats.push({ label: a.answer, value: fmt.pct(a.pct) })
    stats.push(emptyStat(cs.empty))
  } else {
    const ts = fs as TextFieldStats
    stats.push({ label: t('rp.fld.distinct'), value: fmt.int(ts.distinct) })
    stats.push(emptyStat(ts.empty))
    const nn = ts.nonNumeric || []
    if (f.textLike && nn.length) extra = tn(t, 'rp.fld.nonNumeric', nn.reduce((a, x) => a + x.count, 0), { list: nn.slice(0, 5).map((x) => `«${x.value}» (${x.count})`).join(', ') })
  }
  return (
    <>
      <div className="rp-stats">
        {stats.map((s) => (
          <div key={s.label} className="rp-st">
            <span className={`rp-sv${s.warn ? ' jb-c-warn' : ''}`} title={s.value}>{s.value}</span>
            <span className="rp-sl">{s.label}</span>
          </div>
        ))}
      </div>
      {extra && <p className="rp-note" style={{ marginTop: 12 }}>{extra}</p>}
    </>
  )
}

function TopValues({ f, ns, d, fmt, busy }: { f: SummaryField; ns: NumericFieldStats; d: ViewProps['d']; fmt: Fmt; busy: boolean }) {
  const t = useT()
  const [all, setAll] = useState(false)
  const byJob = useMemo(() => new Map(d.policies.map((p) => [p.jobId, p])), [d.policies])
  const sorted = ns.sorted || []
  const shown = all ? sorted : sorted.slice(0, TOP_ROWS)
  return (
    <div className="rp-card">
      <CardHead title={t('rp.fld.top')} mb={4} right={sorted.length > TOP_ROWS ? (
        <button type="button" className="rp-linkbtn" onClick={() => setAll(!all)}>{all ? t('rp.fld.lessSorted') : tn(t, 'rp.fld.allSorted', sorted.length)}</button>
      ) : undefined} />
      {/* l'elenco ordinato arriva col campo aperto: spinner solo mentre si carica */}
      {!ns.sorted && (busy ? <p className="rp-empty"><span className="spinner" style={{ width: 12, height: 12 }} /></p> : <p className="rp-empty">{t('rp.fld.sortedMissing')}</p>)}
      {ns.sorted && !sorted.length && <p className="rp-empty">{t('rp.kpi.noValues')}</p>}
      <div className={all ? 'rp-scrolly' : undefined}>
        {shown.map((s) => {
          const p = byJob.get(s.jobId)
          const meta = [p?.groupLabel, p?.year != null ? String(p.year) : null].filter(Boolean).join(' · ')
          return (
            <div key={s.jobId} className="rp-row">
              <span className="rp-grow rp-ell" title={p?.path ? `${p.path} / ${p.name}` : p?.name}>{p?.name || s.jobId.slice(0, 8)}</span>
              <span className="rp-sub rp-ell" style={{ width: 130 }} title={meta}>{meta}</span>
              <span style={{ width: 100, textAlign: 'right' }}>{fmt.one(s.value, f, true)}</span>
              <Link href={policyHref(s.jobId, p?.batchId)} className="rp-open">{t('rp.fld.openPolicy')}</Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PerPolicy({ f, policies }: { f: SummaryField; policies: SummaryPolicy[] }) {
  const t = useT()
  const [all, setAll] = useState(false)
  const rows = all ? policies : policies.slice(0, 50)
  return (
    <div className="rp-card rp-tablecard">
      <CardHead title={t('rp.fld.perPolicy')} sub={tn(t, 'rp.dash.nPolicies', policies.length)} />
      <div className="rp-scrollx">
        <table className="rp-table">
          <thead><tr><th className="l">{t('rp.cmp.policy')}</th><th className="l">{f.label}</th><th className="l">{t('rp.xls.year')}</th><th /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.jobId}>
                <td className="l rp-cellname" title={p.path ? `${p.path} / ${p.name}` : p.name}>{p.name}</td>
                <td className="l">{p.values?.[f.id] || <span className="rp-muted">—</span>}</td>
                <td className="l">{p.year ?? '—'}</td>
                <td><Link href={policyHref(p.jobId, p.batchId)} className="rp-open">{t('rp.fld.openPolicy')}</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {policies.length > 50 && (
        <button type="button" className="rp-linkbtn" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>{all ? t('rp.fld.lessSorted') : tn(t, 'rp.fld.allSorted', policies.length)}</button>
      )}
    </div>
  )
}
