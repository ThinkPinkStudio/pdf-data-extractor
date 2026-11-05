'use client'

// Promozioni: il titolare e il suo nucleo escono dalla categoria di partenza
// ed entrano nella nuova dal giorno della promozione (pro-rata in uscita e in
// entrata), più l'elenco delle promozioni registrate con l'annullamento.
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { useConfirmPanel } from '@/components/ConfirmPanel'
import { RsmGate, RsmHeader, api, eur, today, useRsm } from '@/components/rsm/useRsm'
import type { Row } from '@/components/rsm/useRsm'
import { fmtDate, isCovered, previewPromotion, statusAt } from '@/lib/rsm/rules.js'
import type { RsmCalc } from '@/lib/rsm/types'

export default function Page() {
  return <Suspense><RsmPromozioniPage /></Suspense>
}

function RsmPromozioniPage() {
  const { t } = useI18n()
  const rsm = useRsm()
  const params = useSearchParams()
  const { ask, panel } = useConfirmPanel()
  const cfg = rsm.program?.config
  const [q, setQ] = useState('')
  const [titId, setTitId] = useState<string | null>(null)
  const [ids, setIds] = useState<string[]>([])
  const [to, setTo] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const rankOf = (k: string) => cfg?.categories.find((c) => c.key === k)?.rank ?? 0
  const tit = rsm.rows.find((r) => r.id === titId) || null
  const nucleus = useMemo(() => (tit
    ? rsm.rows.filter((r) => r.category === tit.category && (r.id === tit.id || (r.legame !== 'TI' && r.cfTitolare === tit.cf)) && !r.exitKind)
      .sort((a, b) => ['TI', 'CO', 'FI'].indexOf(a.legame) - ['TI', 'CO', 'FI'].indexOf(b.legame))
    : []), [rsm.rows, tit])

  function choose(r: Row) {
    setTitId(r.id)
    const fam = rsm.rows.filter((x) => x.category === r.category && (x.id === r.id || (x.legame !== 'TI' && x.cfTitolare === r.cf)) && !x.exitKind)
    setIds(fam.map((x) => x.id))
    const higher = (cfg?.categories || []).filter((c) => c.rank > rankOf(r.category)).sort((a, b) => a.rank - b.rank)[0]
    setTo(higher?.key || '')
    setQ('')
  }

  useEffect(() => {
    const m = params.get('m')
    if (m && !titId) { const r = rsm.rows.find((x) => x.id === m); if (r) choose(r) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, rsm.rows])

  const needle = q.trim().toUpperCase()
  const hits = cfg && needle.length >= 2
    ? rsm.rows.filter((r) => r.legame === 'TI' && !r.exitKind && isCovered(statusAt(cfg, r, today())) && `${r.cognome} ${r.nome} ${r.cf}`.includes(needle)).slice(0, 8)
    : []
  const chosen = nucleus.filter((r) => ids.includes(r.id))
  const valid = !!(cfg && tit && to && date && date > cfg.periodStart && date < cfg.periodEnd && chosen.length && chosen.every((r) => isCovered(statusAt(cfg, r, date))))
  const pv = cfg && tit && to && date && chosen.length ? previewPromotion(cfg, chosen, to, date) : null
  const label = (k: string) => cfg?.categories.find((c) => c.key === k)?.label || k

  async function save() {
    setBusy(true); setMsg(null)
    try {
      await api(`/api/rsm/programs/${rsm.programId}/promote`, 'POST', { memberIds: ids, toCategory: to, date, note })
      setMsg({ ok: true, text: t('rsm.pr.done', { name: `${tit!.cognome} ${tit!.nome}`, to: label(to), d: fmtDate(date) }) })
      setTitId(null); setIds([]); setDate(''); setNote('')
      await rsm.reload()
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  // Promozioni registrate: le righe in uscita raggruppate per promotion_id.
  const done = useMemo(() => {
    const map = new Map<string, { out: Row[]; inn: Row[] }>()
    for (const r of rsm.rows) {
      if (!r.promotionId) continue
      if (!map.has(r.promotionId)) map.set(r.promotionId, { out: [], inn: [] })
      if (r.exitKind === 'promozione') map.get(r.promotionId)!.out.push(r)
      if (r.entryKind === 'promozione') map.get(r.promotionId)!.inn.push(r)
    }
    return [...map.entries()].map(([id, g]) => {
      const head = g.out.find((r) => r.legame === 'TI') || g.inn.find((r) => r.legame === 'TI') || g.out[0] || g.inn[0]
      return {
        id, head, n: Math.max(g.out.length, g.inn.length), date: g.out[0]?.exitDate || g.inn[0]?.entryDate || '',
        from: g.out[0]?.category, to: g.inn[0]?.category,
        rimborso: g.out.reduce((s, r) => s + r.c.rimborso, 0), dovuto: g.inn.reduce((s, r) => s + r.c.dovuto, 0),
      }
    }).sort((a, b) => b.date.localeCompare(a.date))
  }, [rsm.rows])

  async function undo(id: string, name: string) {
    if (!(await ask(t('rsm.pr.undoAsk', { name }), { danger: true, okLabel: t('rsm.pr.undo') }))) return
    try { await api(`/api/rsm/programs/${rsm.programId}/promote`, 'DELETE', { promotionId: id }); await rsm.reload(); setMsg({ ok: true, text: t('rsm.pr.undone') }) } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }

  return (
    <div className="rsm">
      <RsmHeader rsm={rsm} title={t('rsm.pr.title')} />
      <RsmGate rsm={rsm}>
        {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`}>{msg.text}</div>}
        <p className="rsm-muted" style={{ margin: 0, maxWidth: 820 }}>{t('rsm.pr.intro', { m: cfg?.rules.prorata === 'mesi' ? t('rsm.pr.months') : t('rsm.pr.days'), tax: String(cfg?.rules.refundTaxPct ?? 0).replace('.', ',') })}</p>
        <div className="rsm-box">
          <div className="rsm-box-body">
            {!tit && (
              <>
                <label className="rsm-field" style={{ maxWidth: 420 }}>{t('rsm.pr.search')}<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('rsm.st.searchPh')} /></label>
                {hits.map((r) => (
                  <button key={r.id} className="btn btn-secondary" style={{ justifyContent: 'flex-start', maxWidth: 620 }} onClick={() => choose(r)}>
                    {r.cognome} {r.nome} · {r.cf} · {label(r.category)}
                  </button>
                ))}
              </>
            )}
            {tit && cfg && (
              <>
                <div className="rsm-row" style={{ justifyContent: 'space-between' }}>
                  <div><b>{tit.cognome} {tit.nome}</b> <span className="rsm-cf">{tit.cf}</span> · {label(tit.category)}</div>
                  <button className="btn btn-secondary" onClick={() => { setTitId(null); setIds([]) }}>{t('rsm.pr.change')}</button>
                </div>
                <div className="rsm-row">
                  <label className="rsm-field">{t('rsm.pr.to')}
                    <select value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 180 }}>
                      <option value="">—</option>
                      {cfg.categories.filter((c) => c.key !== tit.category).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </label>
                  <label className="rsm-field w-date">{t('rsm.pr.date')}<input type="date" value={date} min={cfg.periodStart} onChange={(e) => setDate(e.target.value)} /></label>
                  <label className="rsm-field" style={{ flex: 1, minWidth: 220 }}>{t('rsm.note')}<input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('rsm.notePh')} /></label>
                </div>
                <div className="rsm-muted">{t('rsm.pr.who')}</div>
                {nucleus.map((r) => (
                  <label key={r.id} className="rsm-muted" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="checkbox" checked={ids.includes(r.id)} disabled={r.legame === 'TI'} onChange={(e) => setIds((x) => (e.target.checked ? [...x, r.id] : x.filter((y) => y !== r.id)))} />
                    {r.cognome} {r.nome} · {t(`rsm.leg.${r.legame}`)}
                  </label>
                ))}
                {pv && (
                  <div className="rsm-grid2">
                    <PreviewTable title={t('rsm.pr.exitTitle', { c: label(tit.category) })} rows={pv.exits} field="rimborso" total={pv.rimborso} totalLabel={t('rsm.pr.refundTot')} />
                    <PreviewTable title={t('rsm.pr.entryTitle', { c: label(to) })} rows={pv.entries} field="dovuto" total={pv.dovuto} totalLabel={t('rsm.pr.dueTot')} />
                  </div>
                )}
                {pv && <div className="rsm-sum"><span>{t('rsm.pr.saldo')} <b>{eur(pv.saldo)}</b></span></div>}
                {date && (date <= cfg.periodStart || date >= cfg.periodEnd) && <div className="rsm-issue error">{t('rsm.pr.outOfPeriod')}</div>}
                <div className="rsm-row"><button className="btn btn-primary" disabled={!valid || busy || !rsm.editor} onClick={save}>{t('rsm.pr.save', { n: chosen.length * 2 })}</button></div>
              </>
            )}
          </div>
        </div>

        <div className="rsm-box">
          <div className="rsm-box-head"><div className="rsm-box-title">{t('rsm.pr.listTitle')}</div></div>
          {done.length === 0 ? <div className="rsm-empty">{t('rsm.pr.none')}</div> : (
            <div className="rsm-scroll"><table className="rsm-table">
              <thead><tr><th>{t('rsm.col.insured')}</th><th>{t('rsm.pr.date')}</th><th>{t('rsm.pr.fromTo')}</th><th>{t('rsm.pr.people')}</th><th className="num">{t('rsm.pr.refundTot')}</th><th className="num">{t('rsm.pr.dueTot')}</th>{rsm.editor && <th />}</tr></thead>
              <tbody>
                {done.map((p) => (
                  <tr key={p.id}>
                    <td><div className="rsm-who">{p.head.cognome} {p.head.nome}</div><div className="rsm-cf">{p.head.cf}</div></td>
                    <td className="nowrap">{fmtDate(p.date)}</td>
                    <td className="nowrap">{p.from ? label(p.from) : '?'} → {p.to ? label(p.to) : '?'}</td>
                    <td>{p.n}</td>
                    <td className="num">{eur(p.rimborso)}</td>
                    <td className="num">{eur(p.dovuto)}</td>
                    {rsm.editor && <td><div className="rsm-actions"><button className="rsm-mini danger" onClick={() => undo(p.id, `${p.head.cognome} ${p.head.nome}`)}>{t('rsm.pr.undo')}</button></div></td>}
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      </RsmGate>
      {panel}
    </div>
  )
}

function PreviewTable({ title, rows, field, total, totalLabel }: { title: string; rows: { member: Partial<Row>; calc: RsmCalc }[]; field: 'rimborso' | 'dovuto'; total: number; totalLabel: string }) {
  const { t } = useI18n()
  return (
    <div className="rsm-box">
      <div className="rsm-box-head"><div className="rsm-box-title">{title}</div></div>
      <table className="rsm-table">
        <thead><tr><th>{t('rsm.col.insured')}</th><th className="num">{t('rsm.col.annual')}</th><th className="num">{field === 'rimborso' ? t('rsm.col.refund') : t('rsm.col.due')}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.member.cognome} {r.member.nome}<div className="rsm-sub">{t(`rsm.leg.${r.member.legame}`)}</div></td>
              <td className="num">{r.calc.annuo ? eur(r.calc.annuo) : '—'}</td>
              <td className="num">{eur(r.calc[field])}{field === 'dovuto' && <div className="rsm-sub">{r.calc.calc}</div>}</td>
            </tr>
          ))}
          <tr className="total"><td colSpan={2}>{totalLabel}</td><td className="num">{eur(total)}</td></tr>
        </tbody>
      </table>
    </div>
  )
}
