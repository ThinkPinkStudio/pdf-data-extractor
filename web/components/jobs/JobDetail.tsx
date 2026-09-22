'use client'
import { useT } from '@/lib/i18n/I18nProvider'
import type { DetailTab, JobSnapshot } from './types'
import type { JobActions } from './useJobActions'
import { errorText, fileUrl, isTestRun, minutesSince, opEsitoKey, shortName, splitName, uiState, valuesCount } from './model'
import { StatusPill } from './StatusPill'
import { ActionMenu } from './ActionMenu'
import { actionSet, buttonClass } from './actionSet'
import { IcAlert, IcChevLeft, IcChevRight, IcCopy, IcExternal, IcFile, IcX } from './Icons'

// Dettaglio di UNA polizza: lo stesso componente sta a lato della tabella
// (drawer) e nel riquadro destro della coda (inline). Tab: Pertinenza (esito
// del controllo, strutturato), Valori (con fonte cliccabile), File, Log.
export function JobDetail({ job, batchLabel, position, onPrev, onNext, onClose, tab, onTab, A, variant }: {
  job: JobSnapshot
  batchLabel?: string | null
  position?: { i: number; n: number } | null
  onPrev?: () => void
  onNext?: () => void
  onClose?: () => void
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  A: JobActions
  variant: 'drawer' | 'inline'
}) {
  const t = useT()
  const pc = job.precheck || null
  const sugg = pc?.suggestion && pc.suggestion.id && pc.suggestion.id !== job.profileId ? pc.suggestion : null
  const stale = job.status === 'running' ? minutesSince(job.updatedAt) : null
  const nDocs = (job.scannedFiles || []).length
  const nValues = valuesCount(job)
  const profileName = job.profileName || job.profileId || t('jobsDash.profileNone')
  const acts = actionSet(job, A, t, onTab)
  const { name, path } = splitName(job, batchLabel)
  const tabs: { id: DetailTab; label: string; count?: number }[] = [
    { id: 'precheck', label: t('jobsDash.tabPrecheck') },
    { id: 'values', label: t('jobsDash.tabValues'), count: nValues },
    { id: 'files', label: t('jobsDash.tabFiles'), count: nDocs },
    { id: 'log', label: t('jobsDash.tabLog'), count: (job.logs || []).length },
  ]

  const actionsBar = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {variant === 'inline' && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text-secondary)', marginRight: 4 }}>{t('jobsDash.decision').toUpperCase()}</span>}
      {acts.primary && (
        <button type="button" className={buttonClass(acts.primary)} disabled={A.busy} title={acts.primary.title} onClick={acts.primary.run}>
          {acts.primary.icon}{acts.primary.label}
        </button>
      )}
      {acts.secondary.map((a) => (
        <button key={a.id} type="button" className={buttonClass(a)} disabled={A.busy} title={a.title} onClick={a.run}>{a.icon}{a.label}</button>
      ))}
      <div style={{ flex: '1 1 0' }} />
      {variant === 'inline' && onNext && (
        <button type="button" className="jb-btn ghost" onClick={onNext} title={t('jobsDash.next')}>{t('jobsDash.next')}<IcChevRight /></button>
      )}
      <ActionMenu ariaLabel={t('jobsDash.moreActions')} items={acts.menu.map((a) => ({ id: a.id, label: a.label, icon: a.icon, onClick: a.run, title: a.title, disabled: A.busy }))} />
    </div>
  )

  return (
    <aside className={`jb-detail ${variant}`} aria-label={shortName(job, batchLabel)}>
      <div style={{ padding: '14px 20px 10px', borderBottom: '1px solid var(--c-border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--c-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {[batchLabel, path].filter(Boolean).join(' / ')}{position ? ` · ${t('jobsDash.ofN', { i: position.i, n: position.n })}` : ''}
          </span>
          <div style={{ display: 'flex', gap: 2, flex: 'none' }}>
            {onPrev && <button type="button" className="jb-btn ghost icon" aria-label={t('jobsDash.prev')} title={t('jobsDash.prev')} disabled={!position || position.i <= 1} onClick={onPrev}><IcChevLeft /></button>}
            {onNext && <button type="button" className="jb-btn ghost icon" aria-label={t('jobsDash.next')} title={t('jobsDash.next')} disabled={!position || position.i >= position.n} onClick={onNext}><IcChevRight /></button>}
            {onClose && <button type="button" className="jb-btn ghost icon" aria-label={t('jobsDash.close')} title={t('jobsDash.close')} onClick={onClose}><IcX /></button>}
          </div>
        </div>
        <h2 style={{ margin: 0, fontSize: variant === 'inline' ? 17 : 15, fontWeight: 700, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {isTestRun(job) && <span className="jb-pill info" title={t('jobsDash.testBadge')}>{t('jobsDash.testRun')}</span>}
          <span style={{ wordBreak: 'break-word' }} title={shortName(job, batchLabel)}>{name}</span>
        </h2>
        <div className="jb-chips">
          <StatusPill job={job} />
          <span className="jb-pill neutral">{pc?.auto ? t('jobsDash.profileAuto', { name: profileName }) : profileName}</span>
          {pc?.matchOnly && job.status !== 'matched' && <span className="jb-pill neutral">{t('jobsDash.matchOnlyBadge')}</span>}
          <span className="jb-pill neutral">{nDocs === 1 ? t('jobsDash.docs1') : t('jobsDash.docsN', { n: nDocs })}</span>
          <span className="jb-pill neutral">{t('jobsDash.valuesCount', { n: nValues })}</span>
          {sugg && <span className="jb-pill ok">{t('jobsDash.suggestedShort', { name: sugg.name })}</span>}
          {stale != null && stale >= 3 && <span className="jb-pill warn" title={t('jobsDash.staleFor', { n: stale })}><IcAlert />{t('jobsDash.staleShort', { n: stale })}</span>}
          {!!job.duplicateOf && <span className="jb-pill neutral" title={t('jobsDash.duplicateOf')}><IcCopy />{t('jobsDash.duplicateOf')}</span>}
        </div>
        {variant === 'inline' && (
          <div style={{ padding: '10px 12px', background: 'var(--c-bg-card-alt)', border: '1px solid var(--c-border)', borderRadius: 8, marginTop: 4 }}>{actionsBar}</div>
        )}
      </div>

      <div className="jb-tabs" role="tablist">
        {tabs.map((tb) => (
          <button key={tb.id} type="button" role="tab" aria-selected={tab === tb.id} className={`jb-tab${tab === tb.id ? ' active' : ''}`} onClick={() => onTab(tb.id)}>
            {tb.label}{tb.count !== undefined && <span className="c">{tb.count}</span>}
          </button>
        ))}
      </div>

      <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {tab === 'precheck' && <PrecheckTab job={job} A={A} />}
        {tab === 'values' && <ValuesTab job={job} />}
        {tab === 'files' && <FilesTab job={job} />}
        {tab === 'log' && <LogTab job={job} />}
      </div>

      {variant === 'drawer' && (
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--c-border)' }}>{actionsBar}</div>
      )}
    </aside>
  )
}

function PrecheckTab({ job, A }: { job: JobSnapshot; A: JobActions }) {
  const t = useT()
  const pc = job.precheck || null
  const st = uiState(job)
  const err = errorText(job)
  if (!pc) {
    return (
      <>
        <p className="jb-text jb-muted">{t('jobsDash.noPrecheck')}</p>
        {err && <div><p className="jb-sec">{t('jobsDash.reason')}</p><p className="jb-text">{err}</p></div>}
      </>
    )
  }
  const op = pc.operativita && pc.operativita.esito ? pc.operativita : null
  const rejected = !!op && pc.verdict !== 'ok' && op.esito === 'operante'
  const verdict = pc.setAside ? { cls: 'muted', label: t('jobsDash.stSetAside') }
    : pc.verdict === 'ok' ? { cls: 'ok', label: pc.mode === 'operativita' ? t('jobsDash.opOperante') : t('jobsDash.verdictOk') }
      : pc.verdict === 'review' ? { cls: 'warn', label: t('jobsDash.stReview') }
        : pc.verdict === 'mismatch' ? { cls: 'orange', label: st === 'discarded' ? t('jobsDash.stDiscarded') : t('jobsDash.stMismatch') }
          : { cls: 'neutral', label: t('jobsDash.verdictSkipped') }
  const sugg = pc.suggestion && pc.suggestion.id && pc.suggestion.id !== job.profileId ? pc.suggestion : null
  const where = op?.documento
    ? (op.pagina ? t('jobsDash.docPage', { doc: String(op.documento), page: String(op.pagina) }) : t('jobsDash.docOnly', { doc: String(op.documento) }))
    : ''
  const triedLabel = (v: string) => v === 'ok' ? t('jobsDash.opOperante') : v === 'mismatch' ? t('jobsDash.opNonOperante') : t('jobsDash.opDubbio')
  return (
    <>
      <div>
        <p className="jb-sec">{t('jobsDash.verdict')}</p>
        <div className="jb-chips" style={{ alignItems: 'center' }}>
          <span className={`jb-pill ${verdict.cls}`}>{verdict.label}</span>
          {pc.mode && <span className="jb-pill neutral">{pc.mode}</span>}
          {pc.override && <span className="jb-pill neutral">{t('jobsDash.overrideApplied')}</span>}
          {pc.confirmed && <span className="jb-pill neutral">{t('jobsDash.confirmedApplied')}</span>}
        </div>
        {pc.reason && <p className="jb-text" style={{ marginTop: 8 }}>{pc.reason}</p>}
      </div>
      {op && (
        <>
          <div>
            <p className="jb-sec">{t('jobsDash.modelSaidLabel')}</p>
            <p className="jb-text"><b>{t(opEsitoKey(op.esito))}</b>{rejected ? ` — ${t('jobsDash.proofRejected').toLowerCase()}` : ''}</p>
          </div>
          {op.evidenza && (
            <div>
              <p className="jb-sec">{t('jobsDash.proof')}</p>
              <blockquote className="jb-quote">«{op.evidenza}»</blockquote>
              {where && <p className="jb-text jb-muted" style={{ marginTop: 6, fontSize: 11 }}>{where}</p>}
            </div>
          )}
          {op.motivo && <div><p className="jb-sec">{t('jobsDash.reason')}</p><p className="jb-text">{op.motivo}</p></div>}
        </>
      )}
      {!op && !pc.reason && err && <div><p className="jb-sec">{t('jobsDash.reason')}</p><p className="jb-text">{err}</p></div>}
      {!!pc.missing?.length && (
        <div><p className="jb-sec">{t('jobsDash.missingWords')}</p><div className="jb-chips">{pc.missing.map((w) => <span key={w} className="jb-pill neutral" style={{ fontWeight: 500 }}>{w}</span>)}</div></div>
      )}
      {!!pc.matched?.length && (
        <div><p className="jb-sec">{t('jobsDash.foundWords')}</p><div className="jb-chips">{pc.matched.map((w) => <span key={w} className="jb-pill ok" style={{ fontWeight: 500 }}>{w}</span>)}</div></div>
      )}
      {!!pc.excludeMatched?.length && (
        <div><p className="jb-sec">{t('jobsDash.excludeWords')}</p><div className="jb-chips">{pc.excludeMatched.map((w) => <span key={w} className="jb-pill orange" style={{ fontWeight: 500 }}>{w}</span>)}</div></div>
      )}
      {pc.verdict !== 'ok' && (
        <div>
          <p className="jb-sec">{t('jobsDash.suggestedProfile')}</p>
          {sugg ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, background: 'var(--c-bg-card-alt)' }}>
              <span style={{ fontSize: 12, fontWeight: 600, flex: '1 1 0' }}>{sugg.name}</span>
              <button type="button" className="jb-btn btn-secondary tone-ok" disabled={A.busy} title={t('jobsDash.useSuggestedTitle')} onClick={() => void A.rematchWith(job, sugg.id)}>
                {t('jobsDash.useSuggested')}
              </button>
            </div>
          ) : <p className="jb-text jb-muted">{t('jobsDash.noSuggestion')}</p>}
        </div>
      )}
      {!!pc.operativitaTried?.length && (
        <div>
          <p className="jb-sec">{t('jobsDash.tried')}</p>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.6 }}>
            {pc.operativitaTried.map((x, i) => <li key={`${x.name}-${i}`}>{x.name} — {triedLabel(x.verdict)}</li>)}
          </ul>
        </div>
      )}
      {!!pc.ranking?.length && (
        <div><p className="jb-sec">{t('jobsDash.ranking')}</p><p className="jb-text jb-muted">{pc.ranking.filter((r) => typeof r.score === 'number').map((r) => r.name).join(' › ') || pc.ranking.map((r) => r.name).join(' › ')}</p></div>
      )}
      {pc.detected && (pc.detected.type || pc.detected.keywords?.length) && (
        <div><p className="jb-sec">{t('jobsDash.detected')}</p><p className="jb-text jb-muted">{[pc.detected.type, (pc.detected.keywords || []).join(', ')].filter(Boolean).join(' — ')}</p></div>
      )}
      {pc.summary && <div><p className="jb-sec">{t('jobsDash.summary')}</p><p className="jb-text jb-muted" style={{ fontSize: 11 }}>{pc.summary}</p></div>}
    </>
  )
}

function ValuesTab({ job }: { job: JobSnapshot }) {
  const t = useT()
  const entries = Object.entries(job.values || {})
  const label = (id: string) => job.fieldDefs?.find((f) => f.id === id)?.label || id
  if (!entries.length) {
    return (
      <div>
        <p className="jb-text jb-muted">{t('jobsDash.noValues')}</p>
        {job.status !== 'done' && job.status !== 'running' && <p className="jb-text jb-muted" style={{ marginTop: 6, fontSize: 11 }}>{t('jobsDash.noValuesHint')}</p>}
      </div>
    )
  }
  return (
    <table className="jb-values">
      <thead><tr><th>{t('jobsDash.colField')}</th><th>{t('jobsDash.colValue')}</th><th>{t('jobsDash.colSource')}</th></tr></thead>
      <tbody>
        {entries.map(([k, v]) => {
          const s = job.sources?.[k]
          const url = s ? fileUrl(job, s.file, s.page) : null
          const text = s ? `${s.file}${s.page ? ` · pag. ${s.page}` : ''}` : ''
          return (
            <tr key={k}>
              <td className="jb-muted">{label(k)}</td>
              <td className="v" style={{ whiteSpace: 'pre-wrap' }}>{String(v)}</td>
              <td className="src">{url ? <a href={url} target="_blank" rel="noopener" title={t('jobsDash.openPdf')} style={{ color: 'inherit', textDecoration: 'underline dotted' }}>{text}</a> : text}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function FilesTab({ job }: { job: JobSnapshot }) {
  const t = useT()
  const files = job.scannedFiles || []
  if (!files.length) return <p className="jb-text jb-muted">—</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {files.map((name, i) => (
        <a key={`${name}-${i}`} className="jb-filelink" href={`/api/polizza/job/${job.jobId}/file/${i}`} target="_blank" rel="noopener" title={t('jobsDash.openPdf')}>
          <IcFile /><span className="f">{name}</span><IcExternal />
        </a>
      ))}
    </div>
  )
}

function LogTab({ job }: { job: JobSnapshot }) {
  const t = useT()
  const logs = job.logs || []
  if (!logs.length) return <p className="jb-text jb-muted">{t('jobsDash.noLog')}</p>
  return <pre className="jb-log">{logs.join('\n')}</pre>
}
