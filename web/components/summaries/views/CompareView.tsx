'use client'
// VISTA D — CONFRONTO TRA DUE ANNI (mockup Confronto.dc.html): carte A → B,
// continuità del portafoglio (rinnovate / nuove / non rinnovate, abbinate per
// i campi scelti in «Personalizza», di default numero di polizza e P.IVA/CF),
// spostamenti del campo «raggruppa per», tabella per polizza. Usa TUTTE le
// polizze del riepilogo: i filtri anno e gruppo delle altre viste non contano.
import Link from 'next/link'
import { useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { SummaryCompareOk, SummaryCompareRow, SummaryField } from '@/lib/summaryTypes'
import { amountSigned, countSigned, deltaClass, opWord, partialTitle, pctSigned, pctTone, policyHref, tn } from '../format'
import { CardHead } from '../ui'
import { DOSSIER_KEY, type ViewProps } from './types'

const ROWS_STEP = 100

export function CompareView({ d, fmt, byId }: Pick<ViewProps, 'd' | 'fmt' | 'byId'>) {
  const t = useT()
  const cmp = d.compare
  if ('error' in cmp) {
    return (
      <div className="rp-stack">
        <div className="rp-card rp-empty">{cmp.error === 'same-year' ? t('rp.cmp.sameYear') : t('rp.cmp.needTwo')}</div>
        {cmp.error === 'need-two-years' && <p className="rp-sub">{t('rp.tbl.oneYearNote')}</p>}
      </div>
    )
  }
  return <CompareOk cmp={cmp} d={d} fmt={fmt} byId={byId} />
}

function CompareOk({ cmp, d, fmt, byId }: { cmp: SummaryCompareOk } & Pick<ViewProps, 'd' | 'fmt' | 'byId'>) {
  const t = useT()
  const [limit, setLimit] = useState(ROWS_STEP)
  const label = (fid: string | null | undefined) => (fid === DOSSIER_KEY ? t('rp.cmp.dossier') : (fid && byId.get(fid)?.label) || fid || '')
  const groupField = cmp.groupShift ? byId.get(cmp.groupShift.fieldId) : d.prefs.groupFieldId ? byId.get(d.prefs.groupFieldId) : undefined
  const amountIds = cmp.rows[0]?.amounts.map((a) => a.fieldId) || [...new Set(d.prefs.highlights.map((h) => h.fieldId))].slice(0, 2)
  const amountFields = amountIds.map((id) => byId.get(id)).filter((x): x is SummaryField => !!x)

  const cont = cmp.continuity
  const contTotal = cont.renewed + cont.added + cont.lost
  const seg = (n: number) => `${contTotal ? (n / contTotal) * 100 : 0}%`
  const matchList = cmp.matchFieldIds.map(label).join(`, ${t('rp.cmp.thenBy')} `)

  const rows = cmp.rows.slice(0, limit)

  // Regola unica (deltaClass, come nei mockup): aumento verde, calo o parità
  // neutri; una somma con polizze senza valore (delta.partial) neutra con «*».
  const chipClass = (cls: string) => (cls === 'jb-c-ok' ? 'rp-d jb-c-ok' : 'rp-d n')
  const deltaChip = (card: SummaryCompareOk['cards'][number]) => {
    if (card.op === 'count') {
      const abs = card.delta?.abs ?? null
      return <span className={chipClass(deltaClass(abs))}>{countSigned(abs, fmt)}</span>
    }
    if (card.op === 'minmax' || !card.delta) return null
    const tone = pctTone(card.delta)
    if (!tone) return null
    const title = partialTitle(t, card.delta, cmp.yearA, cmp.yearB)
    return (
      <span className={chipClass(deltaClass(tone.tone === 'up' ? 1 : -1, !!title))} title={title}>
        {pctSigned(card.delta, fmt)}{title ? ' *' : ''}
      </span>
    )
  }
  const anyPartial = cmp.cards.some((c) => c.delta?.partial)

  // Cambio del gruppo deciso dal server per CHIAVE: «DAS» → «D.A.S.» non è un cambio.
  const groupCell = (r: SummaryCompareRow) => {
    const a = r.group.a
    const b = r.group.b
    if (r.kind === 'renewed' && r.group.changed && a && b) return `${a} → ${b}`
    return b || a || '—'
  }

  const note = (r: SummaryCompareRow) => {
    if (r.kind === 'added') return <span className="rp-tag new jb-c-info">{t('rp.cmp.tagNew')}</span>
    if (r.kind === 'lost') return <span className="rp-tag out jb-c-warn" title={t('rp.cmp.lostTitle')}>{t('rp.cmp.tagLost')}</span>
    return r.changed.map((fid) => <span key={fid} className="rp-tag">{t('rp.cmp.tagChanged', { field: label(fid) })}</span>)
  }

  return (
    <div className="rp-stack">
      <section className="rp-cmps">
        {cmp.cards.map((c, i) => {
          const f = c.fieldId ? byId.get(c.fieldId) : undefined
          const title = c.op === 'count' ? t('rp.cmp.policies') : t('rp.kpi.label', { field: f?.label || c.fieldId || '', op: opWord(t, c.op) })
          const v = (x: typeof c.a) => (c.op === 'count' ? fmt.int(x as number | null) : fmt.agg(x, f))
          return (
            <div key={i} className="rp-card rp-cmp">
              <span className="rp-cl">{title}</span>
              <div className="rp-cv">
                <span className="rp-old">{v(c.a)}</span>
                <span className="rp-arr">→</span>
                <span className="rp-nw">{v(c.b)}</span>
                {deltaChip(c)}
              </div>
            </div>
          )
        })}
      </section>
      {anyPartial && <p className="rp-sub" style={{ marginTop: -4 }}>{t('rp.tbl.partialNote')}</p>}

      <section className="rp-g2e">
        <div className="rp-card">
          <CardHead title={t('rp.cmp.continuity')} sub={matchList ? t('rp.cmp.matchedBy', { list: matchList }) : undefined} mb={0} />
          <p className="rp-sub" style={{ marginTop: 2 }}>{t('rp.cmp.continuitySub')}</p>
          <div className="rp-cont" role="img" aria-label={`${t('rp.cmp.renewed', { year: cmp.yearB })} ${cont.renewed}, ${t('rp.cmp.added', { year: cmp.yearB })} ${cont.added}, ${t('rp.cmp.lost')} ${cont.lost}`}>
            {contTotal === 0 && <span className="rp-cont-empty" />}
            {cont.renewed > 0 && <span style={{ width: seg(cont.renewed), background: 'var(--c-accent)' }} />}
            {cont.added > 0 && <span style={{ width: seg(cont.added), background: 'var(--c-info)' }} />}
            {cont.lost > 0 && <span style={{ width: seg(cont.lost), background: 'var(--c-warning)' }} />}
          </div>
          <div className="rp-cont-n">
            <div><div className="rp-big">{fmt.int(cont.renewed)}</div><div className="rp-sub"><span className="rp-sq" style={{ background: 'var(--c-accent)' }} />{t('rp.cmp.renewed', { year: cmp.yearB })}</div></div>
            <div><div className="rp-big">{fmt.int(cont.added)}</div><div className="rp-sub"><span className="rp-sq" style={{ background: 'var(--c-info)' }} />{t('rp.cmp.added', { year: cmp.yearB })}</div></div>
            <div title={t('rp.cmp.lostTitle')}><div className="rp-big">{fmt.int(cont.lost)}</div><div className="rp-sub"><span className="rp-sq" style={{ background: 'var(--c-warning)' }} />{t('rp.cmp.lost')}</div></div>
          </div>
        </div>
        <div className="rp-card">
          {cmp.groupShift && groupField ? (
            <>
              <CardHead title={groupField.label} sub={t('rp.cmp.groupSub', { a: cmp.yearA, b: cmp.yearB })} mb={4} />
              <table className="rp-table rp-mini">
                <tbody>
                  {cmp.groupShift.rows.map((r) => (
                    <tr key={r.key}>
                      <td className="l rp-cellname">{r.label ?? r.key}</td>
                      <td>{fmt.int(r.a)}</td>
                      <td className="rp-arr">→</td>
                      <td>{fmt.int(r.b)}</td>
                      <td><span className={chipClass(deltaClass(r.diff))}>{countSigned(r.diff, fmt)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!cmp.groupShift.rows.length && <p className="rp-empty">{t('rp.dash.noPolicies')}</p>}
            </>
          ) : (
            <>
              <CardHead title={t('rp.cfg.groupBy')} />
              <p className="rp-empty">{t('rp.dash.noGroup')}</p>
            </>
          )}
        </div>
      </section>

      <div className="rp-card rp-tablecard">
        <div className="rp-scrollx">
          <table className="rp-table">
            <thead>
              <tr>
                <th className="l">{t('rp.cmp.policy')}</th>
                {groupField && <th className="l">{groupField.label}</th>}
                {amountFields[0] && <th>{t('rp.cmp.colYear', { field: amountFields[0].label, year: cmp.yearA })}</th>}
                {amountFields[0] && <th>{t('rp.cmp.colYear', { field: amountFields[0].label, year: cmp.yearB })}</th>}
                {amountFields[0] && <th>{t('rp.cmp.diff')}</th>}
                {amountFields[1] && <th>{t('rp.cmp.colYear', { field: amountFields[1].label, year: cmp.yearA })}</th>}
                {amountFields[1] && <th>{t('rp.cmp.colYear', { field: amountFields[1].label, year: cmp.yearB })}</th>}
                <th className="l">{t('rp.cmp.note')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const jobId = r.jobB || r.jobA || ''
                const a0 = r.amounts[0]
                const a1 = r.amounts[1]
                const f0 = amountFields[0]
                const f1 = amountFields[1]
                return (
                  <tr key={`${r.jobA || ''}|${r.jobB || ''}`} title={r.matchedBy ? t('rp.cmp.matchedTitle', { field: label(r.matchedBy) }) : undefined}>
                    <td className="l rp-cellname"><Link href={policyHref(jobId, r.batchId)} className="rp-link">{r.name}</Link></td>
                    {groupField && <td className="l rp-cellname">{groupCell(r)}</td>}
                    {f0 && <td>{fmt.one(a0?.a ?? null, f0)}</td>}
                    {f0 && <td>{fmt.one(a0?.b ?? null, f0)}</td>}
                    {f0 && <td className={deltaClass(a0?.diff)}>{amountSigned(a0?.diff ?? null, f0, fmt)}</td>}
                    {f1 && <td>{fmt.one(a1?.a ?? null, f1)}</td>}
                    {f1 && <td>{fmt.one(a1?.b ?? null, f1)}</td>}
                    <td className="l">{note(r)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {cmp.rows.length === 0 && <p className="rp-empty">{t('rp.dash.noPolicies')}</p>}
        {cmp.rows.length > limit && (
          <button type="button" className="rp-linkbtn" style={{ marginTop: 8 }} onClick={() => setLimit(cmp.rows.length)}>{tn(t, 'rp.cmp.showAll', cmp.rows.length)}</button>
        )}
      </div>
    </div>
  )
}
