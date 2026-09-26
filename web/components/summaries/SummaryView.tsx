'use client'
// DETTAGLIO DI UN RIEPILOGO (/polizza/riepiloghi/[id]): testata, avvisi,
// switch «Cruscotto | Tabella per anno | Per campo | Confronto», filtri della
// vista, «Personalizza», drawer «Modifica selezione», «Esporta Excel».
// Stato della vista nell'URL (vista, anno, gruppo, a, b, campo) con
// replaceState, come la pagina del batch; l'ultima vista scelta anche nel
// browser (localStorage, dentro try/catch).
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import type { SummaryField, SummaryWarning } from '@/lib/summaryTypes'
import { useConfirmPanel } from '@/components/ConfirmPanel'
import { IcAlert, IcDownload, IcRefresh, IcSliders, IcX } from '@/components/jobs/Icons'
import { apiErrorText, lcFirst, makeFmt, tn } from './format'
import { useWidth } from './hooks'
import { QUERY_KEYS, readQuery, useSummary } from './useSummary'
import { Pick, type PickOption } from './ui'
import { Dashboard } from './views/Dashboard'
import { YearTable } from './views/YearTable'
import { FieldView } from './views/FieldView'
import { CompareView } from './views/CompareView'
import { SummarySettingsPanel } from './SummarySettingsPanel'
import { MembersDrawer } from './MembersDrawer'
import type { ViewProps } from './views/types'

type ViewKey = 'cruscotto' | 'tabella' | 'campo' | 'confronto'
const VIEWS: ViewKey[] = ['cruscotto', 'tabella', 'campo', 'confronto']
const VIEW_LABEL: Record<ViewKey, string> = { cruscotto: 'rp.view.dashboard', tabella: 'rp.view.table', campo: 'rp.view.field', confronto: 'rp.view.compare' }
const VIEW_KEY_STORE = 'rpView'
const isView = (v: string | null | undefined): v is ViewKey => !!v && (VIEWS as string[]).includes(v)

export function SummaryView({ id }: { id: string }) {
  const { t, lang } = useI18n()
  const fmt = useMemo(() => makeFmt(lang), [lang])
  const sp = useSearchParams()
  const S = useSummary(id, readQuery(sp), (body, status) => apiErrorText(t, body, status))
  const [view, setViewState] = useState<ViewKey>('cruscotto')
  const [panel, setPanel] = useState<'settings' | 'members' | null>(null)
  const [err, setErr] = useState('')
  const { ask, panel: confirmPanel } = useConfirmPanel()
  const ready = useRef(false)
  const [rootRef, width] = useWidth<HTMLDivElement>(1200)

  // Vista iniziale: URL, poi l'ultima scelta, poi Cruscotto (in un effetto: niente divergenze col render server).
  useEffect(() => {
    const v = sp.get('vista')
    let vm: ViewKey = 'cruscotto'
    if (isView(v)) vm = v
    else { try { const saved = localStorage.getItem(VIEW_KEY_STORE); if (isView(saved)) vm = saved } catch { /* privato */ } }
    setViewState(vm)
    ready.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const setView = (v: ViewKey) => { setViewState(v); try { localStorage.setItem(VIEW_KEY_STORE, v) } catch { /* privato */ } }

  // Stato nell'URL: si toccano SOLO i propri parametri.
  const q = S.q
  useEffect(() => {
    if (!ready.current) return
    const p = new URLSearchParams(window.location.search)
    p.delete('vista')
    for (const k of QUERY_KEYS) p.delete(k)
    if (view !== 'cruscotto') p.set('vista', view)
    for (const k of QUERY_KEYS) if (q[k]) p.set(k, q[k] as string)
    const qs = p.toString()
    const url = `${window.location.pathname}${qs ? `?${qs}` : ''}`
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, '', url)
  }, [view, q])

  const d = S.data
  const byId = useMemo(() => new Map<string, SummaryField>([...(d?.fields || []), ...(d?.removedFields || [])].map((f) => [f.id, f])), [d])

  const narrow = width > 0 && width < 960
  const rootClass = `rp-page${narrow ? ' rp-narrow' : ''}${width > 0 && width < 520 ? ' rp-tiny' : ''}`

  if (S.status === 'notFound' || !d) {
    return (
      <div ref={rootRef} className={rootClass}>
        <div className="rp-crumb"><Link href="/polizza/riepiloghi">{t('rp.list.title')}</Link></div>
        {S.status === 'notFound'
          ? <div className="rp-card rp-empty" style={{ padding: 24, textAlign: 'center' }}>{t('rp.head.notFound')}</div>
          : S.status === 'error'
            ? <div className="rp-card rp-empty" style={{ padding: 24 }}>{t('rp.head.loadError', { msg: S.error })}</div>
            : <p><span className="spinner" /></p>}
      </div>
    )
  }

  const s = d.summary
  const inCalc = d.members.filter((m) => m.state === 'ok' || m.state === 'stale').length
  const yearField = s.yearFieldId ? byId.get(s.yearFieldId) : undefined
  const dateFields = d.fields.filter((f) => f.kind === 'date')
  const groupField = d.prefs.groupFieldId ? byId.get(d.prefs.groupFieldId) : undefined
  const busy = S.loading
  const onError = (m: string) => setErr(m)
  const vp: ViewProps = { d, fmt, byId, q, setQ: S.setQ, patch: S.patch, busy, onError }
  const overlay = !!confirmPanel

  async function changeYearField(fid: string) {
    if (!fid || fid === s.yearFieldId) return
    const out = await S.patch({ yearFieldId: fid }, { anno: null, a: null, b: null })
    if (!out.ok) setErr(apiErrorText(t, out.body, out.status))
  }

  // ── Filtri della vista (a destra dello switch). Durante un salvataggio i
  // menu che salvano (Anno da, Righe) sono spenti: niente PATCH sovrapposti.
  const yearFieldPick = (label: string) => (
    <Pick ariaLabel={t('rp.f.yearFrom')} label={label}
      options={dateFields.map((f) => ({ id: f.id, label: f.label, active: f.id === s.yearFieldId, disabled: busy }))}
      onPick={(fid) => void changeYearField(fid)} />
  )
  const yearOptions: PickOption[] = [
    { id: '', label: t('rp.f.allYears'), active: !q.anno },
    ...d.view.years.map((y) => (y.year == null
      ? { id: 'none', label: `${t('rp.f.noYear')} (${y.count})`, active: q.anno === 'none' }
      : { id: String(y.year), label: `${y.inProgress ? t('rp.f.inProgress', { year: y.year }) : y.year} (${y.count})`, active: q.anno === String(y.year) })),
  ]
  const yearLabel = !q.anno ? t('rp.f.allYears') : q.anno === 'none' ? t('rp.f.noYear') : q.anno
  const yearPick = <Pick ariaLabel={t('rp.f.yearFilter')} label={yearLabel} options={yearOptions} onPick={(v) => S.setQ({ anno: v || null })} />
  const groupLabelNow = q.gruppo ? (d.view.groupValues.find((g) => g.key === q.gruppo)?.label || q.gruppo) : null
  const groupPick = groupField ? (
    <Pick ariaLabel={t('rp.f.groupFilter', { field: groupField.label })}
      label={groupLabelNow ? `${groupField.label}: ${groupLabelNow}` : t('rp.f.allValues', { field: groupField.label })}
      options={[
        { id: '', label: t('rp.f.allValues', { field: groupField.label }), active: !q.gruppo },
        ...d.view.groupValues.map((g) => ({ id: g.key, label: `${g.label ?? g.key} (${g.count})`, active: q.gruppo === g.key })),
      ]}
      onPick={(v) => S.setQ({ gruppo: v || null })} />
  ) : null

  let filters: ReactNode = null
  if (view === 'cruscotto' || view === 'campo') {
    filters = (
      <>
        {view === 'cruscotto' && dateFields.length > 0 && <><span className="rp-sub">{t('rp.f.yearFrom')}</span>{yearFieldPick(yearField?.label || t('rp.f.noYear'))}</>}
        {yearPick}
        {groupPick}
      </>
    )
  } else if (view === 'tabella') {
    const rowsLabel: Record<string, string> = { amounts: t('rp.f.rowsAmounts'), amountsCounts: t('rp.f.rowsAmountsCounts'), all: t('rp.f.rowsAll') }
    filters = (
      <>
        {dateFields.length > 0 && <><span className="rp-sub">{t('rp.f.columns')}</span>{yearFieldPick(yearField ? t('rp.f.yearOf', { field: lcFirst(yearField.label) }) : t('rp.f.noYear'))}</>}
        <span className="rp-sub">{t('rp.f.rows')}</span>
        <Pick ariaLabel={t('rp.f.rows')} label={rowsLabel[d.prefs.tableRows]}
          options={(['amounts', 'amountsCounts', 'all'] as const).map((k) => ({ id: k, label: rowsLabel[k], active: d.prefs.tableRows === k, disabled: busy }))}
          onPick={async (k) => {
            if (k === d.prefs.tableRows || busy) return
            const out = await S.patch({ prefs: { tableRows: k as 'amounts' | 'amountsCounts' | 'all' } })
            if (!out.ok) setErr(apiErrorText(t, out.body, out.status))
          }} />
      </>
    )
  } else if (view === 'confronto' && !('error' in d.compare && d.compare.error === 'need-two-years')) {
    const years = d.compare.years || []
    const ya = 'error' in d.compare ? d.compare.yearA : d.compare.yearA
    const yb = 'error' in d.compare ? d.compare.yearB : d.compare.yearB
    filters = (
      <>
        <span className="rp-sub">{t('rp.f.compare')}</span>
        <Pick ariaLabel={`${t('rp.f.compare')} A`} label={ya != null ? String(ya) : '—'}
          options={years.map((y) => ({ id: String(y), label: String(y), active: y === ya }))} onPick={(v) => S.setQ({ a: v })} />
        <span className="rp-sub">{t('rp.f.with')}</span>
        <Pick ariaLabel={`${t('rp.f.compare')} B`} label={yb != null ? String(yb) : '—'}
          options={years.map((y) => ({ id: String(y), label: String(y), active: y === yb }))} onPick={(v) => S.setQ({ b: v })} />
      </>
    )
  }

  return (
    <div ref={rootRef} className={rootClass}>
      <header className="rp-head">
        <div style={{ minWidth: 0 }}>
          <div className="rp-crumb"><Link href="/polizza/riepiloghi">{t('rp.list.title')}</Link> / <span>{s.name}</span></div>
          <h1 className="rp-title">{s.name}</h1>
          <div className="rp-meta">
            <span>{t('rp.head.meta', { profile: s.profileName || t('rp.profileFromFields', { n: s.fieldCount }), n: fmt.int(inCalc) })}</span>
            <span className={`jb-pill ${s.mode === 'snapshot' ? 'info' : 'neutral'}`} title={s.mode === 'snapshot' ? t('rp.new.snapshotData') : t('rp.head.live')}>
              {s.mode === 'snapshot' ? t('rp.mode.snapshot', { date: fmt.date(s.snapshotAt) }) : t('rp.mode.live')}
            </span>
          </div>
        </div>
        <div className="rp-actions">
          <button type="button" className="jb-btn btn-secondary rp-btn" onClick={() => setPanel(panel === 'members' ? null : 'members')}>{t('rp.head.members')}</button>
          {s.mode === 'live' && (
            <button type="button" className="jb-btn ghost rp-btn" disabled={busy} onClick={S.reload} title={t('rp.head.reloadTitle')}><IcRefresh />{t('rp.head.reload')}</button>
          )}
          <button type="button" className="jb-btn btn-primary rp-btn" disabled={S.exporting} onClick={async () => { if (!(await S.exportExcel(lang))) setErr(t('rp.head.exportError')) }}>
            {S.exporting ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <IcDownload />}{t('rp.head.export')}
          </button>
        </div>
      </header>

      {err && (
        <div className="jb-callout" role="alert">
          <span className="jb-c-err" style={{ display: 'inline-flex' }}><IcAlert /></span>
          <span style={{ flex: '1 1 0' }}>{err}</span>
          <button type="button" className="jb-btn ghost icon" aria-label={t('jobsDash.close')} onClick={() => setErr('')}><IcX /></button>
        </div>
      )}
      {S.refreshError && (
        <div className="jb-callout" role="alert">
          <span className="jb-c-err" style={{ display: 'inline-flex' }}><IcAlert /></span>
          <span style={{ flex: '1 1 0' }}>{t('rp.head.refreshError', { msg: S.refreshError })}</span>
          <button type="button" className="jb-btn btn-secondary rp-btn" disabled={busy} onClick={S.retry}><IcRefresh />{t('rp.head.retry')}</button>
        </div>
      )}
      {d.warnings.map((w) => <WarningLine key={w.code} w={w} onFix={() => setPanel('members')} />)}

      <div className="rp-toolbar">
        <div className="rp-seg" role="group" aria-label={t('rp.view.aria')}>
          {VIEWS.map((v) => (
            <button key={v} type="button" className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}>{t(VIEW_LABEL[v])}</button>
          ))}
        </div>
        <div className="rp-filters">
          {busy && <span className="spinner" style={{ width: 14, height: 14 }} aria-label="…" />}
          {filters}
          <button type="button" className="jb-btn btn-secondary rp-btn" aria-pressed={panel === 'settings'} onClick={() => setPanel(panel === 'settings' ? null : 'settings')}><IcSliders />{t('rp.head.customize')}</button>
        </div>
      </div>

      {d.members.length === 0 ? (
        <div className="rp-card rp-empty" style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ marginBottom: 10 }}>{t('rp.head.noMembers')}</p>
          <Link href="/polizza/jobs" className="jb-btn btn-primary rp-btn">{t('rp.list.goJobs')}</Link>
        </div>
      ) : inCalc === 0 ? (
        <div className="rp-card rp-empty" style={{ padding: 24, textAlign: 'center' }}>
          <p style={{ marginBottom: 10 }}>{t('rp.head.allExcluded')}</p>
          <button type="button" className="jb-btn btn-primary rp-btn" onClick={() => setPanel('members')}>{t('rp.head.members')}</button>
        </div>
      ) : view === 'cruscotto' ? <Dashboard {...vp} />
        : view === 'tabella' ? <YearTable {...vp} />
          : view === 'campo' ? <FieldView {...vp} />
            : <CompareView {...vp} />}

      {panel === 'settings' && <SummarySettingsPanel d={d} patch={S.patch} onClose={() => setPanel(null)} active={!overlay} />}
      {panel === 'members' && <MembersDrawer d={d} fmt={fmt} patch={S.patch} ask={ask} onClose={() => setPanel(null)} active={!overlay} />}
      {confirmPanel}
    </div>
  )
}

function WarningLine({ w, onFix }: { w: SummaryWarning; onFix: () => void }) {
  const { t } = useI18n()
  const n = w.jobIds.length
  const calm = w.code === 'stale'
  return (
    <div className={`jb-callout${calm ? ' calm' : ''}`}>
      <span className={calm ? 'jb-c-info' : 'jb-c-warn'} style={{ display: 'inline-flex' }}><IcAlert /></span>
      <span style={{ flex: '1 1 0' }}>{tn(t, `rp.warn.${w.code}`, n)}</span>
      <button type="button" className="jb-btn ghost" onClick={onFix}>{t('rp.warn.fix')}</button>
    </div>
  )
}
