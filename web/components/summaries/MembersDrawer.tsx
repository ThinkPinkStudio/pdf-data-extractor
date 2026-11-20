'use client'
// Drawer «Modifica selezione»: nome del riepilogo, modo (valori aggiornati o
// fotografia, con «Congela» / «Aggiorna la fotografia»), elenco delle polizze
// con lo stato di ognuna (le mancanti e le escluse in cima, già ordinate dal
// server) e «Togli». Si aggiungono polizze da Elaborazioni.
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { SummaryDetail, SummaryMember, SummaryPatchBody } from '@/lib/summaryTypes'
import type { ConfirmOptions } from '@/components/ConfirmPanel'
import { IcExternal, IcX } from '@/components/jobs/Icons'
import type { PatchOutcome } from './useSummary'
import { useEscape } from './hooks'
import { apiErrorText, policyHref, tn, type Fmt } from './format'

const STATUS_KEY: Record<string, string> = {
  queued: 'jobsDash.stQueued', running: 'jobsDash.stRunning', matched: 'jobsDash.stMatched', review: 'jobsDash.stReview',
  mismatch: 'jobsDash.stMismatch', done: 'jobsDash.stDone', error: 'jobsDash.stError', canceled: 'jobsDash.stCanceled',
}
const LIST_STEP = 200

export function MembersDrawer({ d, fmt, onClose, patch, ask, active }: {
  d: SummaryDetail
  fmt: Fmt
  onClose: () => void
  patch: (body: SummaryPatchBody) => Promise<PatchOutcome>
  ask: (message: string, opts?: ConfirmOptions) => Promise<boolean>
  active: boolean
}) {
  const t = useT()
  useEscape(onClose, active)
  const s = d.summary
  const [name, setName] = useState(s.name)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(LIST_STEP)

  const stateText = (m: SummaryMember): { text: string; cls: string } => {
    if (m.state === 'ok') return { text: m.kept ? t('rp.mem.state.kept') : t('rp.mem.state.ok'), cls: m.kept ? 'jb-c-warn' : 'jb-c-ok' }
    if (m.state === 'stale') {
      const status = m.status ? t(STATUS_KEY[m.status] || m.status) : '—'
      return { text: t('rp.mem.state.stale', { date: fmt.date(m.valuesAt), status }), cls: 'jb-c-info' }
    }
    if (m.state === 'missing') return { text: t('rp.mem.state.missing'), cls: 'jb-c-err' }
    return { text: t(`rp.mem.state.${m.reason || 'notDone'}`), cls: 'jb-c-orange' }
  }

  async function run(body: SummaryPatchBody, done?: (o: Extract<PatchOutcome, { ok: true }>) => string | null) {
    setBusy(true)
    setMsg(null)
    const out = await patch(body)
    setBusy(false)
    if (!out.ok) { setMsg({ text: apiErrorText(t, out.body, out.status), err: true }); return false }
    const text = done ? done(out) : null
    if (text) setMsg({ text })
    return true
  }

  async function rename() {
    const v = name.trim()
    if (!v) { setMsg({ text: t('rp.new.nameRequired'), err: true }); return }
    if (v === s.name) return
    await run({ name: v }, () => t('rp.mem.renamed'))
  }

  async function toSnapshot() {
    // Chi non è nei calcoli (escluse, non più presenti) non entra nella
    // fotografia e viene tolta dal riepilogo: lo si dice PRIMA, col numero.
    const out = d.members.filter((m) => m.state !== 'ok' && m.state !== 'stale').length
    const message = out ? tn(t, 'rp.mem.toSnapshotAskDrop', out) : t('rp.mem.toSnapshotAsk')
    if (!(await ask(message, { okLabel: t('rp.mem.toSnapshot'), title: t('rp.mem.toSnapshot'), details: t('rp.new.snapshotData') }))) return
    await run({ mode: 'snapshot' }, (o) => (o.result?.dropped.length ? tn(t, 'rp.mem.dropped', o.result.dropped.length) : t('rp.mem.frozen')))
  }

  async function refresh() {
    if (!(await ask(t('rp.mem.refreshAsk'), { okLabel: t('rp.mem.refresh'), title: t('rp.mem.refresh') }))) return
    await run({ refreshSnapshot: true }, (o) => {
      const parts = [t('rp.mem.refreshed')]
      if (o.result?.keptOld.length) parts.push(tn(t, 'rp.warn.keptOld', o.result.keptOld.length))
      if (o.result?.dropped.length) parts.push(tn(t, 'rp.mem.dropped', o.result.dropped.length))
      return parts.join(' · ')
    })
  }

  async function remove(m: SummaryMember) {
    if (!(await ask(t('rp.mem.removeAsk', { name: m.name }), { okLabel: t('rp.mem.remove'), danger: true, title: t('rp.mem.remove') }))) return
    await run({ removeJobIds: [m.jobId] })
  }

  const qq = query.trim().toLowerCase()
  const members = useMemo(() => (qq ? d.members.filter((m) => `${m.name} ${m.path} ${m.batchLabel || ''}`.toLowerCase().includes(qq)) : d.members), [d.members, qq])
  const shown = members.slice(0, limit)

  return (
    <aside className="jb-detail drawer rp-drawer" role="dialog" aria-label={t('rp.mem.title')}>
      <div className="rp-dhead">
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{t('rp.mem.title')}</h2>
        <span className="rp-sub">{tn(t, 'rp.dash.nPolicies', d.members.length)}</span>
        <span style={{ flex: '1 1 0' }} />
        <button type="button" className="jb-btn ghost icon" aria-label={t('jobsDash.close')} title={t('jobsDash.close')} onClick={onClose}><IcX /></button>
      </div>
      <div className="rp-dbody">
        <label>
          <span className="rp-lbl">{t('rp.mem.name')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void rename() }} />
            <button type="button" className="jb-btn btn-secondary rp-btn" disabled={busy || !name.trim() || name.trim() === s.name} onClick={() => void rename()}>{t('rp.mem.rename')}</button>
          </div>
        </label>

        <div>
          <span className="rp-lbl">{t('rp.mem.mode')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className={`jb-pill ${s.mode === 'snapshot' ? 'info' : 'neutral'}`}>
              {s.mode === 'snapshot' ? t('rp.mode.snapshot', { date: fmt.date(s.snapshotAt) }) : t('rp.mode.live')}
            </span>
            <span style={{ flex: '1 1 0' }} />
            {s.mode === 'live'
              ? <button type="button" className="jb-btn btn-secondary rp-btn" disabled={busy} onClick={() => void toSnapshot()}>{t('rp.mem.toSnapshot')}</button>
              : <button type="button" className="jb-btn btn-secondary rp-btn" disabled={busy} onClick={() => void refresh()}>{t('rp.mem.refresh')}</button>}
          </div>
          <p className="rp-sub" style={{ marginTop: 6 }}>{s.mode === 'live' ? t('rp.head.live') : t('rp.new.snapshotData')}</p>
        </div>

        {msg && <p className={msg.err ? 'rp-err' : 'rp-ok'} role={msg.err ? 'alert' : 'status'}>{msg.text}</p>}

        <div className="rp-dlist">
          <label className="jb-search">
            <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(LIST_STEP) }} placeholder={t('rp.mem.search')} aria-label={t('rp.mem.search')} />
          </label>
          <div className="rp-mlist">
            {shown.map((m) => {
              const st = stateText(m)
              return (
                <div key={m.jobId} className="rp-mrow">
                  <div style={{ minWidth: 0, flex: '1 1 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="rp-ell" style={{ fontWeight: 600, fontSize: 13 }} title={m.name}>{m.name}</span>
                    <span className="rp-sub rp-ell" title={[m.batchLabel, m.path].filter(Boolean).join(' / ')}>
                      {[m.batchLabel || t('jobsDash.singlesShort'), m.path].filter(Boolean).join(' / ')}{m.year != null ? ` · ${m.year}` : ''}
                    </span>
                    <span className={`rp-mstate ${st.cls}`}>{st.text}</span>
                    {m.forced && <span className="rp-mstate jb-c-warn">{t('rp.mem.forced')}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 2, flex: 'none', alignItems: 'center' }}>
                    {m.state !== 'missing' && (
                      <Link href={policyHref(m.jobId, m.batchId)} className="jb-btn ghost icon" aria-label={t('rp.fld.openPolicy')} title={t('rp.fld.openPolicy')}><IcExternal /></Link>
                    )}
                    <button type="button" className="jb-btn ghost" disabled={busy} onClick={() => void remove(m)}>{t('rp.mem.remove')}</button>
                  </div>
                </div>
              )
            })}
            {members.length > limit && (
              <button type="button" className="rp-linkbtn" style={{ margin: '8px 0' }} onClick={() => setLimit((n) => n + LIST_STEP)}>{tn(t, 'rp.mem.more', members.length - limit)}</button>
            )}
            {!members.length && <p className="rp-empty">{t('rp.mem.noneFound')}</p>}
          </div>
        </div>

        <p className="rp-sub">{t('rp.mem.addHint')} <Link href="/polizza/jobs">{t('rp.mem.goJobs')}</Link></p>
      </div>
    </aside>
  )
}
