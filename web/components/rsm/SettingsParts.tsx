'use client'

// Pezzi delle Impostazioni RSM (17/11/2026): tariffe per fascia d'età, regole
// componibili con la spiegazione accanto, esempio di calcolo che segue le
// impostazioni, prova prima di salvare (cosa cambia per categoria e per
// persona), tracciato del file della società.
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import ValueInput from '@/components/ValueInput'
import { eur } from '@/components/rsm/useRsm'
import { DEFAULT_MAIL_TEXTS, DEFAULT_WORDS, LAYOUT_FIELDS, compareConfigs, entryStepsOf, exampleCalc, fmtDate, legamiOf, refundTaxOf, legameLabel } from '@/lib/rsm/rules.js'
import { describeValue } from '@/lib/configValue.js'
import type { ConfigValue, RsmCategory, RsmConfig, RsmLegame, RsmMember, RsmTariffs } from '@/lib/rsm/types'

type Band = RsmTariffs & { upTo: number | null }
type T = (k: string, p?: Record<string, string | number>) => string

/** Colonne delle tariffe: titolare, quiescente e una per ogni familiare del programma. */
export function tariffColumns(cfg: RsmConfig, t: T) {
  return [
    { key: 'titolare', label: t('rsm.set.tTit'), family: false },
    { key: 'quiescente', label: t('rsm.set.tQui'), family: false },
    ...legamiOf(cfg).filter((l: RsmLegame) => l.key !== 'TI').map((l: RsmLegame) => ({ key: l.tariff, label: l.label, family: true })),
  ]
}

/** Giorno e mese 'gg/mm' (salvato come 'MM-DD'): si scrive liberamente, vale quando è completo. */
export function DayMonth({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (v: string) => void }) {
  const show = (v: string) => v.split('-').reverse().join('/')
  const [text, setText] = useState(show(value))
  useEffect(() => setText(show(value)), [value])
  return (
    <input value={text} disabled={disabled} placeholder="30/06" style={{ width: 80 }}
      onChange={(e) => {
        setText(e.target.value)
        const m = /^(\d{1,2})\/(\d{1,2})$/.exec(e.target.value.trim())
        if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) onChange(`${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`)
      }}
      onBlur={() => setText(show(value))} />
  )
}

/**
 * LEGAMI del nucleo: il titolare (fisso) e i familiari, a cui se ne
 * aggiungono altri. Ognuno ha il nome, il codice, le parole con cui lo
 * scrivono i file e un'età massima (solo avviso); la tariffa è una colonna
 * nelle categorie.
 */
export function LegamiBox({ cfg, ro, onChange }: { cfg: RsmConfig; ro: boolean; onChange: (l: RsmLegame[]) => void }) {
  const { t } = useI18n()
  const legs: RsmLegame[] = legamiOf(cfg)
  const set = (i: number, p: Partial<RsmLegame>) => onChange(legs.map((l, j) => (j === i ? { ...l, ...p } : l)))
  const add = () => {
    let n = 1
    while (legs.some((l) => l.key === `L${n}`)) n++
    onChange([...legs, { key: `L${n}`, label: '', tariff: `legame${n}`, words: '', maxAge: null }])
  }
  return (
    <div className="rsm-box">
      <div className="rsm-box-head"><div><div className="rsm-box-title">{t('rsm.leg.title')}</div><span className="rsm-note">{t('rsm.leg.hint')}</span></div></div>
      <div className="rsm-box-body rsm-scroll">
        <table className="rsm-cats">
          <thead><tr><th>{t('rsm.leg.code')}</th><th>{t('rsm.leg.name')}</th><th>{t('rsm.leg.words')}</th><th>{t('rsm.leg.maxAge')}</th><th /></tr></thead>
          <tbody>
            {legs.map((l, i) => (
              <tr key={i}>
                <td><input value={l.key} disabled={ro || l.key === 'TI'} maxLength={12} onChange={(e) => set(i, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} style={{ width: 70 }} aria-label={t('rsm.leg.code')} /></td>
                <td><input value={l.label} disabled={ro} onChange={(e) => set(i, { label: e.target.value })} style={{ width: 170 }} aria-label={t('rsm.leg.name')} /></td>
                <td><input value={l.words} disabled={ro} onChange={(e) => set(i, { words: e.target.value })} style={{ width: 300 }} placeholder="CONIUGE, CONVIVENTE" aria-label={t('rsm.leg.words')} /></td>
                <td>{l.key === 'TI' ? <span className="rsm-muted">—</span> : <input type="number" min={0} max={120} value={l.maxAge ?? ''} placeholder={t('rsm.r.kidNone')} disabled={ro} onChange={(e) => set(i, { maxAge: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 90 }} aria-label={t('rsm.leg.maxAge')} />}</td>
                <td>{!ro && l.key !== 'TI' && <button className="rsm-mini danger" aria-label={t('rsm.delete')} onClick={() => onChange(legs.filter((_, j) => j !== i))}>×</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!ro && <div><button className="btn btn-secondary" onClick={add}>{t('rsm.leg.add')}</button></div>}
      </div>
    </div>
  )
}

/**
 * Scaglioni d'entrata: chi entra fino al giorno X paga Y (percentuale del
 * premio annuo o importo fisso). Di default due: fino al 30/06 il 100%, poi il
 * 50%; se ne aggiungono quanti servono (trimestri, mesi…).
 */
export function EntrySteps({ cfg, ro, onChange }: { cfg: RsmConfig; ro: boolean; onChange: (s: { until: string; value: ConfigValue }[]) => void }) {
  const { t } = useI18n()
  const steps = entryStepsOf(cfg) as { until: string; value: ConfigValue }[]
  const set = (i: number, p: Partial<{ until: string; value: ConfigValue }>) => onChange(steps.map((x, j) => (j === i ? { ...x, ...p } : x)))
  return (
    <div className="rsm-field" style={{ display: 'grid', gap: 6 }}>
      <span>{t('rsm.es.title')}</span>
      {steps.map((x, i) => (
        <span key={i} className="rsm-row" style={{ alignItems: 'center', gap: 6 }}>
          {t('rsm.es.until')} <DayMonth value={x.until} disabled={ro || i === steps.length - 1} onChange={(v) => set(i, { until: v })} />
          <ValueInput value={x.value} legacy={{ mode: 'percentuale', of: ['premio'] }} disabled={ro} onChange={(v) => set(i, { value: v })} bases={[{ key: 'premio', label: t('rsm.es.premio') }]} width={70} label={t('rsm.es.until')} />
          {!ro && steps.length > 1 && i < steps.length - 1 && <button className="rsm-mini danger" aria-label={t('rsm.delete')} onClick={() => onChange(steps.filter((_, j) => j !== i))}>×</button>}
        </span>
      ))}
      {!ro && <span><button type="button" className="btn btn-secondary" onClick={() => {
        const last = steps[steps.length - 1]
        const prev = steps.length > 1 ? steps[steps.length - 2].until : '06-30'
        const [mm] = prev.split('-').map(Number)
        const until = `${String(Math.min(11, mm + 3)).padStart(2, '0')}-${mm + 3 >= 11 ? '30' : '30'}`
        onChange([...steps.slice(0, -1), { until, value: last.value }, last])
      }}>{t('rsm.es.add')}</button></span>}
      <span className="rsm-help">{t('rsm.es.help')}</span>
    </div>
  )
}

/** Fasce d'età di una categoria: «fino a N anni» e l'ultima per tutti gli altri. */
export function AgeBands({ cfg, cat, ro, onChange }: { cfg: RsmConfig; cat: RsmCategory; ro: boolean; onChange: (bands: Band[]) => void }) {
  const { t } = useI18n()
  const cols = tariffColumns(cfg, t)
  const bands: Band[] = cat.ageBands && cat.ageBands.length ? cat.ageBands : [{ ...cat.tariffs, upTo: null }]
  const sorted = bands.map((b, i) => ({ b, i })).sort((x, y) => (x.b.upTo == null ? 1e9 : x.b.upTo) - (y.b.upTo == null ? 1e9 : y.b.upTo))
  const set = (i: number, p: Partial<Band>) => onChange(bands.map((b, j) => (j === i ? { ...b, ...p } : b)))
  const prevOf = (k: number) => (k === 0 ? null : sorted[k - 1].b.upTo)
  return (
    <div className="rsm-bands">
      <div className="rsm-box-title" style={{ fontSize: 13 }}>{t('rsm.ab.title', { c: cat.label })}</div>
      <table className="rsm-cats">
        <thead><tr><th>{t('rsm.ab.band')}</th>{cols.map((c) => <th key={c.key}>{c.label}</th>)}<th /></tr></thead>
        <tbody>
          {sorted.map(({ b, i }, k) => {
            const from = prevOf(k)
            return (
              <tr key={i}>
                <td className="nowrap">
                  {b.upTo == null
                    ? <span className="rsm-muted">{from == null ? t('rsm.ab.all') : t('rsm.ab.over', { n: from })}</span>
                    : <span className="rsm-row" style={{ alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>{from == null ? t('rsm.ab.upTo') : t('rsm.ab.fromTo', { n: from + 1 })}
                      <input type="number" value={b.upTo} disabled={ro} min={0} max={120} onChange={(e) => set(i, { upTo: e.target.value === '' ? null : Number(e.target.value) })} style={{ width: 64 }} aria-label={t('rsm.ab.upTo')} />{t('rsm.ab.years')}</span>}
                </td>
                {cols.map((col) => (
                  <td key={col.key}><ValueInput value={b[col.key]} disabled={ro || (cat.mode === 'nucleo' && col.family)} onChange={(v) => set(i, { [col.key]: v })} width={76}
                    bases={cols.filter((o) => o.key !== col.key).map((o) => ({ key: o.key, label: o.label }))} label={`${cat.label} ${col.label}`} /></td>
                ))}
                <td>{!ro && b.upTo != null && <button className="rsm-mini danger" aria-label={t('rsm.delete')} onClick={() => onChange(bands.filter((_, j) => j !== i))}>×</button>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {!ro && (
        <div className="rsm-row" style={{ alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={() => {
            const ups = bands.map((b) => b.upTo).filter((n): n is number => n != null)
            const next = ups.length ? Math.max(...ups) + 10 : 40
            const base = bands.find((b) => b.upTo == null) || bands[bands.length - 1]
            onChange([...(bands.some((b) => b.upTo == null) ? bands : [...bands, { ...base, upTo: null }]), { ...base, upTo: Math.min(next, 110) }])
          }}>{t('rsm.ab.add')}</button>
          <span className="rsm-note">{t('rsm.ab.hint')}</span>
        </div>
      )}
    </div>
  )
}

/** Regole del programma, ognuna con una riga di spiegazione in italiano semplice. */
export function RuleChoices({ cfg, ro, setRule }: { cfg: RsmConfig; ro: boolean; setRule: (k: keyof RsmConfig['rules'], v: unknown) => void }) {
  const { t } = useI18n()
  const r = cfg.rules
  const exitMode = r.exitMode === 'rimborso' ? 'rimborso' : 'fineAnno'
  return (
    <div className="rsm-rules">
      <label className="rsm-field">{t('rsm.r.entry')}
        <select value={r.entryMode || 'semestri'} disabled={ro} onChange={(e) => setRule('entryMode', e.target.value)}>
          <option value="semestri">{t('rsm.r.entrySteps')}</option>
          <option value="prorata">{t('rsm.r.entryPro')}</option>
          <option value="intero">{t('rsm.r.entryFull')}</option>
        </select>
        <span className="rsm-help">{t(`rsm.r.entryHelp.${r.entryMode || 'semestri'}`)}</span>
      </label>
      <label className="rsm-field">{t('rsm.r.dec')}
        <select value={r.decorrenzaMode || 'data'} disabled={ro} onChange={(e) => setRule('decorrenzaMode', e.target.value)}>
          <option value="data">{t('rsm.r.decDate')}</option>
          <option value="mese">{t('rsm.r.decMonth')}</option>
        </select>
        <span className="rsm-help">{t(`rsm.r.decHelp.${r.decorrenzaMode || 'data'}`, { n: r.notifyDays })}</span>
      </label>
      <label className="rsm-field">{t('rsm.r.exit')}
        <select value={exitMode} disabled={ro} onChange={(e) => { setRule('exitMode', e.target.value); setRule('coverUntilPeriodEnd', e.target.value !== 'rimborso') }}>
          <option value="fineAnno">{t('rsm.r.exitEnd')}</option>
          <option value="rimborso">{t('rsm.r.exitRefund', { p: describeValue(refundTaxOf(cfg), { rimborso: t('rsm.set.refundGross') }) })}</option>
        </select>
        <span className="rsm-help">{t(`rsm.r.exitHelp.${exitMode}`)}</span>
      </label>
      <label className="rsm-field">{t('rsm.r.quotaWho')}
        <select value={r.quotaWho || 'titolare'} disabled={ro} onChange={(e) => setRule('quotaWho', e.target.value)}>
          <option value="titolare">{t('rsm.r.quotaWhoTit')}</option>
          <option value="tutti">{t('rsm.r.quotaWhoAll')}</option>
        </select>
      </label>
      <label className="rsm-field">{t('rsm.r.quotaMode')}
        <select value={r.quotaMode || 'intera'} disabled={ro} onChange={(e) => setRule('quotaMode', e.target.value)}>
          <option value="intera">{t('rsm.r.quotaFull')}</option>
          <option value="comePremio">{t('rsm.r.quotaLikePremium')}</option>
        </select>
      </label>
      <label className="rsm-rule"><input type="checkbox" checked={!!r.quotaRefund} disabled={ro} onChange={(e) => setRule('quotaRefund', e.target.checked)} />
        <span>{t('rsm.r.quotaRefund')}</span></label>
      <label className="rsm-field">{t('rsm.r.promoEntry')}
        <select value={r.promotionEntry || 'prorata'} disabled={ro} onChange={(e) => setRule('promotionEntry', e.target.value)}>
          <option value="prorata">{t('rsm.r.promoProrata')}</option>
          <option value="comeEntrata">{t('rsm.r.promoLikeEntry')}</option>
        </select>
      </label>
    </div>
  )
}

/** Esempio di calcolo con le impostazioni del modulo (non ancora salvate). */
export function ExampleBox({ cfg }: { cfg: RsmConfig }) {
  const { t } = useI18n()
  const y = +cfg.periodStart.slice(0, 4)
  const [ex, setEx] = useState({ category: cfg.categories[0]?.key || '', legame: 'TI', age: 45, requested: `${y}-09-12`, communicated: `${y}-09-20` })
  const cat = cfg.categories.find((c) => c.key === ex.category) || cfg.categories[0]
  const r = useMemo(() => (cat ? exampleCalc(cfg, { ...ex, category: cat.key }) : null), [cfg, ex, cat])
  if (!cat || !r) return null
  const dec = r.dec as { date: string | null; reason: string; shifted?: string }
  const decText = dec.shifted
    ? t('rsm.ex.decShift', { d: fmtDate(dec.date), s: fmtDate(dec.shifted) })
    : r.dec.reason === 'tardiva' ? t('rsm.ex.decLate', { d: fmtDate(r.dec.date), n: cfg.rules.notifyDays }) : t('rsm.ex.decOk', { d: fmtDate(r.dec.date) })
  return (
    <div className="rsm-box">
      <div className="rsm-box-head"><div><div className="rsm-box-title">{t('rsm.ex.title')}</div><span className="rsm-note">{t('rsm.ex.hint')}</span></div></div>
      <div className="rsm-box-body">
        <div className="rsm-row">
          <label className="rsm-field">{t('rsm.category')}<select value={cat.key} onChange={(e) => setEx({ ...ex, category: e.target.value })}>{cfg.categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
          <label className="rsm-field">{t('rsm.ex.who')}<select value={ex.legame} onChange={(e) => setEx({ ...ex, legame: e.target.value })}>{legamiOf(cfg).map((l: RsmLegame) => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
          <label className="rsm-field">{t('rsm.ex.age')}<input type="number" min={0} max={110} value={ex.age} onChange={(e) => setEx({ ...ex, age: Number(e.target.value) || 0 })} style={{ width: 80 }} /></label>
          <label className="rsm-field w-date">{t('rsm.ex.req')}<input type="date" value={ex.requested} onChange={(e) => setEx({ ...ex, requested: e.target.value })} /></label>
          <label className="rsm-field w-date">{t('rsm.ex.com')}<input type="date" value={ex.communicated} onChange={(e) => setEx({ ...ex, communicated: e.target.value })} /></label>
        </div>
        <div className="rsm-chain">
          <span className="chip">{decText}</span><span className="arrow">→</span>
          <span className="chip">{t('rsm.ex.annual', { v: eur(r.calc.annuo) })}{cat.tariffBy === 'eta' ? ` · ${t('rsm.ex.band', { a: r.age ?? '—' })}` : ''}</span><span className="arrow">→</span>
          <span className="chip">{r.calc.calc} = <b>&nbsp;{eur(r.calc.rateo)}</b></span>
          {r.calc.quota > 0 && <><span className="arrow">+</span><span className="chip">{t('rsm.ex.quota', { v: eur(r.calc.quota) })}</span></>}
          <span className="arrow">=</span><span className="chip strong">{eur(r.calc.dovuto)}</span>
        </div>
      </div>
    </div>
  )
}

/** Prova prima di salvare: premi e rimborsi prima e dopo, persone il cui importo cambia. */
export function ComparePanel({ before, after, members, busy, onCancel, onSave }: {
  before: RsmConfig; after: RsmConfig; members: RsmMember[]; busy: boolean; onCancel: () => void; onSave: () => void
}) {
  const { t } = useI18n()
  const r = useMemo(() => compareConfigs(before, after, members), [before, after, members])
  const [all, setAll] = useState(false)
  const d = (a: number, b: number) => {
    const x = Math.round((b - a) * 100) / 100
    return x === 0 ? '—' : `${x > 0 ? '+' : '−'}${eur(Math.abs(x))}`
  }
  const max = Math.max(1, ...r.categories.map((c) => Math.abs(c.after - c.before)))
  const shown = all ? r.changed : r.changed.slice(0, 12)
  return (
    <div className="rsm-compare" role="dialog" aria-label={t('rsm.cmp.title')}>
      <div className="rsm-box">
        <div className="rsm-box-head">
          <div><div className="rsm-box-title">{t('rsm.cmp.title')}</div><span className="rsm-note">{t('rsm.cmp.hint', { n: r.totals.n })}</span></div>
          <div className="rsm-row" style={{ alignItems: 'center' }}>
            <button className="btn btn-secondary" onClick={onCancel}>{t('rsm.cmp.back')}</button>
            <button className="btn btn-primary" disabled={busy} onClick={onSave}>{busy ? <span className="spinner" /> : t('rsm.cmp.save')}</button>
          </div>
        </div>
        <div className="rsm-box-body">
          <div className="rsm-kpis">
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>{t('rsm.cmp.premium')}</span></div><div className="rsm-kpi-num">{eur(r.totals.after)}</div><div className="rsm-kpi-line">{t('rsm.cmp.was', { v: eur(r.totals.before) })} · <b>{d(r.totals.before, r.totals.after)}</b></div></div>
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>{t('rsm.cmp.refunds')}</span></div><div className="rsm-kpi-num">{eur(r.totals.refundAfter)}</div><div className="rsm-kpi-line">{t('rsm.cmp.was', { v: eur(r.totals.refundBefore) })} · <b>{d(r.totals.refundBefore, r.totals.refundAfter)}</b></div></div>
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>{t('rsm.cmp.people')}</span></div><div className="rsm-kpi-num">{r.changed.length}</div><div className="rsm-kpi-line">{t('rsm.cmp.of', { n: r.totals.n })}</div></div>
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>{t('rsm.cmp.alerts')}</span></div><div className="rsm-kpi-num" style={{ color: r.alertsAfter > r.alertsBefore ? 'var(--c-warning)' : undefined }}>{r.alertsAfter}</div><div className="rsm-kpi-line">{t('rsm.cmp.was', { v: r.alertsBefore })}</div></div>
          </div>
          <table className="rsm-table">
            <thead><tr><th>{t('rsm.category')}</th><th className="num">{t('rsm.cmp.n')}</th><th className="num">{t('rsm.cmp.before')}</th><th className="num">{t('rsm.cmp.after')}</th><th className="num">{t('rsm.cmp.diff')}</th><th style={{ width: '24%' }} /></tr></thead>
            <tbody>
              {r.categories.map((c) => (
                <tr key={c.key}>
                  <td>{c.label}</td><td className="num">{c.n}</td><td className="num">{eur(c.before)}</td><td className="num">{eur(c.after)}</td>
                  <td className="num"><b>{d(c.before, c.after)}</b></td>
                  <td>{c.after !== c.before && <div className="rsm-bar" style={{ width: `${Math.max(3, Math.abs(c.after - c.before) / max * 100)}%`, opacity: c.after > c.before ? 0.9 : 0.45 }} title={d(c.before, c.after)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.changed.length > 0 ? (
            <>
              <div className="rsm-box-title" style={{ fontSize: 13 }}>{t('rsm.cmp.list')}</div>
              <table className="rsm-table">
                <thead><tr><th>{t('rsm.cmp.who')}</th><th>{t('rsm.category')}</th><th className="num">{t('rsm.cmp.before')}</th><th className="num">{t('rsm.cmp.after')}</th><th>{t('rsm.cmp.how')}</th></tr></thead>
                <tbody>
                  {shown.map((x) => (
                    <tr key={x.m.id}>
                      <td>{x.m.cognome} {x.m.nome}</td><td>{after.categories.find((c) => c.key === x.m.category)?.label || x.m.category}</td>
                      <td className="num">{eur(x.before.dovuto)}{x.before.rimborso ? <div className="rsm-sub">{t('rsm.cmp.refund', { v: eur(x.before.rimborso) })}</div> : null}</td>
                      <td className="num"><b>{eur(x.after.dovuto)}</b>{x.after.rimborso ? <div className="rsm-sub">{t('rsm.cmp.refund', { v: eur(x.after.rimborso) })}</div> : null}</td>
                      <td className="rsm-sub">{x.after.calc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.changed.length > shown.length && <div><button className="rsm-mini" onClick={() => setAll(true)}>{t('rsm.cmp.more', { n: r.changed.length - shown.length })}</button></div>}
            </>
          ) : <div className="rsm-note">{t('rsm.cmp.none')}</div>}
        </div>
      </div>
    </div>
  )
}

/** Tracciato del file della società salvato all'import: cosa ricorda il programma. */
export function LayoutSummary({ cfg, ro, onForget }: { cfg: RsmConfig; ro: boolean; onForget: () => void }) {
  const { t } = useI18n()
  const l = cfg.fileLayout
  if (!l) return null
  const fields = Object.entries(l.columns).filter(([, f]) => f !== 'skip')
  const label = (k: string) => { const [key, q] = k.split('|'); const c = cfg.categories.find((x) => x.key === key); return `${c ? c.label : key}${q ? ` ${t('rsm.set.tQui').toLowerCase()}` : ''}` }
  return (
    <div className="rsm-box">
      <div className="rsm-box-head">
        <div><div className="rsm-box-title">{t('rsm.lay.title')}</div><span className="rsm-note">{t('rsm.lay.hint')}</span></div>
        {!ro && <button className="btn btn-secondary" onClick={onForget}>{t('rsm.lay.forget')}</button>}
      </div>
      <div className="rsm-box-body">
        <div className="rsm-chips">{fields.map(([h, f]) => <span key={h} className="chip">{h} → <b>{t(`rsm.f.${f}`)}</b></span>)}</div>
        {Object.keys(l.categoryCodes).length > 0 && <div className="rsm-chips">{Object.entries(l.categoryCodes).map(([c, k]) => <span key={c} className="chip">«{c}» = <b>{label(k)}</b></span>)}</div>}
        {Object.keys(l.legameCodes).length > 0 && <div className="rsm-chips">{Object.entries(l.legameCodes).map(([c, k]) => <span key={c} className="chip">«{c}» = <b>{legameLabel(cfg, k)}</b></span>)}</div>}
      </div>
    </div>
  )
}

/**
 * PAROLE DEI FILE: come il cliente scrive «sì», cosa nelle note suggerisce una
 * promozione o una cessazione, come si chiama il foglio delle variazioni, e
 * intestazioni in più per ogni colonna. Si aggiungono a quelle di sempre.
 */
export function WordsBox({ cfg, ro, onChange, onExcel }: { cfg: RsmConfig; ro: boolean; onChange: (w: NonNullable<RsmConfig['words']>) => void; onExcel: (text: string) => void }) {
  const { t } = useI18n()
  const w = cfg.words || {}
  const set = (p: Partial<NonNullable<RsmConfig['words']>>) => onChange({ ...w, ...p })
  const field = (k: 'yes' | 'promoNotes' | 'cessNotes' | 'varSheet') => (
    <label className="rsm-field" key={k}>{t(`rsm.w.${k}`)}
      <input value={w[k] ?? ''} placeholder={DEFAULT_WORDS[k]} disabled={ro} onChange={(e) => set({ [k]: e.target.value })} style={{ width: 320 }} />
    </label>
  )
  return (
    <div className="rsm-box">
      <div className="rsm-box-head"><div><div className="rsm-box-title">{t('rsm.w.title')}</div><span className="rsm-note">{t('rsm.w.hint')}</span></div></div>
      <div className="rsm-box-body">
        <div className="rsm-row">{field('yes')}{field('varSheet')}</div>
        <div className="rsm-row">{field('promoNotes')}{field('cessNotes')}</div>
        <details>
          <summary className="rsm-muted" style={{ cursor: 'pointer' }}>{t('rsm.w.heads')}</summary>
          <div className="rsm-row" style={{ marginTop: 8 }}>
            {(LAYOUT_FIELDS as string[]).map((f) => (
              <label className="rsm-field" key={f}>{t(`rsm.f.${f}`)}
                <input value={(w.heads || {})[f] || ''} disabled={ro} placeholder={t('rsm.w.headsPh')} onChange={(e) => set({ heads: { ...(w.heads || {}), [f]: e.target.value } })} style={{ width: 220 }} />
              </label>
            ))}
          </div>
        </details>
        <details>
          <summary className="rsm-muted" style={{ cursor: 'pointer' }}>{t('rsm.w.excel')}</summary>
          <textarea rows={5} disabled={ro} value={cfg.excelLabels || ''} placeholder={'NR. POLIZZA = NUMERO POLIZZA\nVariazioni = Movimenti\nSI = SÌ'}
            onChange={(e) => onExcel(e.target.value)} style={{ width: '100%', marginTop: 8, fontFamily: 'var(--font-mono, monospace)' }} />
          <span className="rsm-help">{t('rsm.w.excelHelp')}</span>
        </details>
      </div>
    </div>
  )
}

/** Testi della mail per i dati errati, con i segnaposto {file} {data} {altre}. */
export function MailTexts({ cfg, ro, onChange }: { cfg: RsmConfig; ro: boolean; onChange: (m: RsmConfig['mail']) => void }) {
  const { t } = useI18n()
  const m = cfg.mail
  const keys = ['subject', 'greeting', 'intro', 'askAll', 'askSome', 'closing'] as const
  return (
    <details>
      <summary className="rsm-muted" style={{ cursor: 'pointer' }}>{t('rsm.mt.title')}</summary>
      <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
        {keys.map((k) => (
          <label className="rsm-field" key={k}>{t(`rsm.mt.${k}`)}
            <input value={m[k] ?? ''} placeholder={DEFAULT_MAIL_TEXTS[k]} disabled={ro} onChange={(e) => onChange({ ...m, [k]: e.target.value })} />
          </label>
        ))}
        <span className="rsm-help">{t('rsm.mt.help')}</span>
      </div>
    </details>
  )
}
