'use client'

// Movimenti e regolazione: entrate e uscite dell'anno filtrate per periodo,
// tipo e categoria, con i totali per la regolazione del premio.
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { RsmGate, RsmHeader, downloadExport, eur, today, useRsm } from '@/components/rsm/useRsm'
import type { Row } from '@/components/rsm/useRsm'
import { addDays, fmtDate } from '@/lib/rsm/rules.js'

type Kind = 'all' | 'in' | 'out' | 'promo'
interface Ev { r: Row; type: 'in' | 'out'; date: string; amount: number; promo: boolean; comm: string | null }

export default function RsmMovimentiPage() {
  const { t } = useI18n()
  const rsm = useRsm()
  const cfg = rsm.program?.config
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [kind, setKind] = useState<Kind>('all')
  const [cat, setCat] = useState('all')
  const [err, setErr] = useState<string | null>(null)

  const events = useMemo(() => {
    const out: Ev[] = []
    for (const r of rsm.rows) {
      if (r.entryKind !== 'iniziale' && r.entryDate) out.push({ r, type: 'in', date: r.entryDate, amount: r.c.dovuto, promo: r.entryKind === 'promozione', comm: r.communicatedDate })
      if (r.exitDate) out.push({ r, type: 'out', date: r.exitDate, amount: -r.c.rimborso, promo: r.exitKind === 'promozione', comm: r.exitCommunicated })
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || a.r.cognome.localeCompare(b.r.cognome))
  }, [rsm.rows])

  const f = events.filter((e) => (!from || e.date >= from) && (!to || e.date <= to) && (cat === 'all' || e.r.category === cat)
    && (kind === 'all' || (kind === 'promo' ? e.promo : e.type === kind)))

  const totals = (cfg?.categories || []).map((c) => {
    const ev = f.filter((e) => e.r.category === c.key)
    const ratei = ev.filter((e) => e.type === 'in').reduce((s, e) => s + e.amount, 0)
    const rimborsi = -ev.filter((e) => e.type === 'out').reduce((s, e) => s + e.amount, 0)
    return { c, ins: ev.filter((e) => e.type === 'in').length, outs: ev.filter((e) => e.type === 'out').length, ratei, rimborsi }
  })
  const label = (k: string) => cfg?.categories.find((c) => c.key === k)?.label || k

  return (
    <div className="rsm">
      <RsmHeader rsm={rsm} title={t('rsm.mv.title')}>
        {rsm.program && <button className="btn btn-secondary" onClick={() => downloadExport(rsm.programId!, { kind: 'stato', at: today() }).catch((e) => setErr(e.message))}>{t('rsm.st.exportStato')}</button>}
      </RsmHeader>
      <RsmGate rsm={rsm}>
        {err && <div className="alert alert-error">{err}</div>}
        <div className="rsm-box"><div className="rsm-box-body"><div className="rsm-row">
          <label className="rsm-field w-date">{t('rsm.mv.from')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="rsm-field w-date">{t('rsm.st.to')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="rsm-field">{t('rsm.mv.kind')}
            <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} style={{ width: 160 }}>
              <option value="all">{t('rsm.all')}</option><option value="in">{t('rsm.mv.ins')}</option><option value="out">{t('rsm.mv.outs')}</option><option value="promo">{t('rsm.mv.promos')}</option>
            </select>
          </label>
          <label className="rsm-field">{t('rsm.category')}
            <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ width: 160 }}>
              <option value="all">{t('rsm.all')}</option>{cfg?.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          {cfg && <span className="rsm-note" style={{ alignSelf: 'center' }}>{t('rsm.mv.period', { a: fmtDate(cfg.periodStart), b: fmtDate(addDays(cfg.periodEnd, -1)) })}</span>}
        </div></div></div>

        <div className="rsm-kpis">
          {totals.map((x) => (
            <div key={x.c.key} className="rsm-kpi">
              <div className="rsm-kpi-top"><span>{x.c.label}</span><span>{x.c.policy ? t('rsm.pol', { n: x.c.policy }) : ''}</span></div>
              <div className="rsm-kpi-line">{t('rsm.mv.insOuts', { i: x.ins, o: x.outs })}</div>
              <div className="rsm-kpi-line">{t('rsm.mv.ratei', { v: eur(x.ratei) })} · {t('rsm.mv.rimborsi', { v: eur(x.rimborsi) })}</div>
              <div className="rsm-kpi-num">{eur(x.ratei - x.rimborsi)}</div>
              <div className="rsm-kpi-line">{t('rsm.mv.regolazione')}</div>
            </div>
          ))}
        </div>

        <div className="rsm-box">
          <div className="rsm-box-head"><div className="rsm-box-title">{t('rsm.mv.list', { n: f.length })}</div></div>
          {f.length === 0 ? <div className="rsm-empty">{t('rsm.mv.none')}</div> : (
            <div className="rsm-scroll"><table className="rsm-table">
              <thead><tr>
                <th>{t('rsm.mv.date')}</th><th>{t('rsm.mv.kind')}</th><th>{t('rsm.col.insured')}</th><th>{t('rsm.col.legame')}</th><th>{t('rsm.category')}</th>
                <th className="num">{t('rsm.mv.amount')}</th><th>{t('rsm.mv.comm')}</th><th>{t('rsm.mv.source')}</th>
              </tr></thead>
              <tbody>
                {f.map((e, i) => (
                  <tr key={i}>
                    <td className="nowrap">{fmtDate(e.date)}</td>
                    <td className="nowrap"><span className={`rsm-pill ${e.promo ? 'promo' : e.type === 'in' ? 'new' : 'off'}`}>{t(e.promo ? (e.type === 'in' ? 'rsm.mv.promoIn' : 'rsm.mv.promoOut') : e.type === 'in' ? 'rsm.var.entrata' : 'rsm.mv.cessazione')}</span></td>
                    <td><div className="rsm-who"><Link className="rsm-who-btn" href={`/rsm?p=${e.r.cf}`}>{e.r.cognome} {e.r.nome}</Link></div><div className="rsm-cf">{e.r.cf}</div></td>
                    <td className="nowrap">{t(`rsm.leg.${e.r.legame}`)}</td>
                    <td className="nowrap">{label(e.r.category)}</td>
                    <td className="num">{e.amount ? eur(e.amount) : '0,00'}<div className="rsm-sub">{e.type === 'in' ? e.r.c.calc : e.promo ? t('rsm.mv.refundNet') : t('rsm.mv.noRefund')}</div></td>
                    <td className="nowrap">{fmtDate(e.comm)}</td>
                    <td className="rsm-sub" style={{ maxWidth: 280 }}>{e.r.source || ''}{e.r.note ? ` · ${e.r.note}` : ''}<div>{e.r.createdBy}</div></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      </RsmGate>
    </div>
  )
}
