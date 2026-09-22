'use client'
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { DetailTab, JobSnapshot } from './types'
import type { JobActions } from './useJobActions'
import { isActive, isTestRun, minutesSince, needsDecision, reasonLine, shortName, splitName, valuesCount } from './model'
import { StatusPill } from './StatusPill'
import { ActionMenu } from './ActionMenu'
import { actionSet, buttonClass } from './actionSet'
import { IcAlert, IcCopy, IcFlask, IcPlay, IcRefresh, IcSwap, IcX } from './Icons'

const stop = (e: MouseEvent) => e.stopPropagation()

// Vista TABELLA: una riga per polizza (44px), stato a pillola, motivo in una
// riga, UN'azione primaria + menu ⋯. Click sulla riga = dettaglio a lato.
// La barra delle azioni collettive compare solo con una selezione.
export function JobsTable({ jobs, allJobs, batchLabel, selectedId, onSelect, checked, onChecked, A, onOpenTab, reasonFull }: {
  jobs: JobSnapshot[]
  allJobs: JobSnapshot[]
  batchLabel?: string | null
  selectedId: string | null
  onSelect: (id: string) => void
  checked: Set<string>
  onChecked: (s: Set<string>) => void
  A: JobActions
  onOpenTab: (job: JobSnapshot, tab: DetailTab) => void
  reasonFull: boolean
}) {
  const t = useT()
  // Motivo per esteso: globale (interruttore in toolbar) o per riga (click sulla cella).
  const [openReasons, setOpenReasons] = useState<Set<string>>(new Set())
  const toggleReason = (id: string) => setOpenReasons((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  // Larghezza disponibile: col pannello laterale aperto (o finestra stretta)
  // la tabella passa in modalità COMPATTA e nasconde Motivo e Campi, che il
  // pannello mostra comunque; senza, la colonna Motivo restava a zero.
  const wrapRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => { for (const e of entries) setCompact(e.contentRect.width < 960) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const allVisibleChecked = jobs.length > 0 && jobs.every((j) => checked.has(j.jobId))
  const selectedJobs = allJobs.filter((j) => checked.has(j.jobId))

  function toggleAll(on: boolean) {
    const n = new Set(checked)
    for (const j of jobs) { if (on) n.add(j.jobId); else n.delete(j.jobId) }
    onChecked(n)
  }
  function toggleOne(id: string) {
    const n = new Set(checked)
    if (n.has(id)) n.delete(id); else n.add(id)
    onChecked(n)
  }

  const anyMatched = selectedJobs.some((j) => j.status === 'matched')
  const anyDecision = selectedJobs.some(needsDecision)
  const anyError = selectedJobs.some((j) => j.status === 'error')
  const anyActive = selectedJobs.some(isActive)
  const anyReusable = selectedJobs.some((j) => !!j.duplicateOf)

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'auto' }}>
        <table className="jb-table">
          <colgroup>
            <col style={{ width: 36 }} /><col style={compact ? undefined : { width: '26%' }} /><col style={{ width: 130 }} /><col style={{ width: 128 }} />
            {!compact && <col />}{!compact && <col style={{ width: 60 }} />}<col style={{ width: 156 }} /><col style={{ width: 34 }} />
          </colgroup>
          <thead>
            <tr>
              <th><input type="checkbox" checked={allVisibleChecked} onChange={(e) => toggleAll(e.target.checked)} aria-label={t('jobsDash.selectAllVisible', { n: jobs.length })} title={t('jobsDash.selectAllVisible', { n: jobs.length })} /></th>
              <th>{t('jobsDash.dossierName')}</th>
              <th>{t('jobsDash.colProfile')}</th>
              <th>{t('jobsDash.dossierStatus')}</th>
              {!compact && <th>{t('jobsDash.colReason')}</th>}
              {!compact && <th className="right">{t('jobsDash.colFields')}</th>}
              <th>{t('jobsDash.colAction')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => {
              const pc = j.precheck || null
              const sugg = pc?.suggestion && pc.suggestion.id && pc.suggestion.id !== j.profileId ? pc.suggestion : null
              const profileName = j.profileName || j.profileId || t('jobsDash.profileNone')
              const nDocs = (j.scannedFiles || []).length
              const stale = j.status === 'running' ? minutesSince(j.updatedAt) : null
              const { head, body } = reasonLine(j, t)
              const { name, path } = splitName(j, batchLabel)
              const rOpen = reasonFull || openReasons.has(j.jobId)
              const acts = actionSet(j, A, t, (tab) => onOpenTab(j, tab))
              const menuItems = [...acts.secondary, ...acts.menu].map((a) => ({ id: a.id, label: a.label, icon: a.icon, onClick: a.run, title: a.title, disabled: A.busy }))
              return (
                <tr key={j.jobId} className={`${selectedId === j.jobId ? 'sel' : ''}${rOpen ? ' exp' : ''}`} onClick={() => onSelect(j.jobId)} aria-selected={selectedId === j.jobId}>
                  <td onClick={stop}><input type="checkbox" checked={checked.has(j.jobId)} onChange={() => toggleOne(j.jobId)} aria-label={shortName(j, batchLabel)} /></td>
                  <td>
                    <div className="jb-name">
                      <span className="n" title={shortName(j, batchLabel)}>
                        {isTestRun(j) && <span className="jb-pill info" style={{ marginRight: 6 }} title={t('jobsDash.testBadge')}><IcFlask />{t('jobsDash.testRun')}</span>}
                        {name}
                      </span>
                      <span className="s" title={path || undefined}>
                        {path ? `${path} · ` : ''}{nDocs === 1 ? t('jobsDash.docs1') : t('jobsDash.docsN', { n: nDocs })}
                        {j.duplicateOf ? <> · <IcCopy /> {t('jobsDash.duplicateOf')}</> : null}
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="jb-name">
                      <span className="n jb-muted" style={{ fontWeight: 400 }} title={profileName}>{pc?.auto ? t('jobsDash.profileAuto', { name: profileName }) : profileName}</span>
                      {sugg && <span className="s jb-c-ok">{t('jobsDash.suggestedShort', { name: sugg.name })}</span>}
                    </div>
                  </td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <StatusPill job={j} />
                      {stale != null && stale >= 3 && <span className="jb-pill warn" title={t('jobsDash.staleFor', { n: stale })}><IcAlert />{stale}′</span>}
                    </span>
                  </td>
                  {!compact && (
                    <td className={`jb-muted reason${rOpen ? ' exp' : ''}`} title={rOpen ? undefined : t('jobsDash.reasonExpandHint')}
                      onClick={(e) => { e.stopPropagation(); toggleReason(j.jobId) }}>
                      {head && <b style={{ color: 'var(--c-text-primary)' }}>{head}</b>}{head && body ? ' · ' : ''}{body}
                    </td>
                  )}
                  {!compact && <td className="right jb-muted">{isActive(j) ? '—' : valuesCount(j)}</td>}
                  <td onClick={stop}>
                    {acts.primary && (
                      <button type="button" className={buttonClass(acts.primary)} disabled={A.busy} title={acts.primary.title} onClick={acts.primary.run}>
                        {acts.primary.icon}{acts.primary.shortLabel || acts.primary.label}
                      </button>
                    )}
                  </td>
                  <td onClick={stop} style={{ padding: '0 4px' }}><ActionMenu ariaLabel={t('jobsDash.moreActions')} items={menuItems} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {jobs.length === 0 && <p style={{ padding: 24, fontSize: 12, color: 'var(--c-text-muted)', textAlign: 'center' }}>{t('jobsDash.noRows')}</p>}
      </div>

      {selectedJobs.length > 0 && (
        <div className="jb-bulk" role="toolbar" aria-label={t('jobsDash.bulkTitle', { n: selectedJobs.length })}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{t('jobsDash.selectedN', { n: selectedJobs.length })}</span>
          <span className="sep" />
          {anyMatched && <button type="button" className="jb-btn btn-primary" disabled={A.busy} title={t('jobsDash.extractTitle')} onClick={() => void A.bulk('extract', selectedJobs)}><IcPlay />{t('jobsDash.extract')}</button>}
          {anyDecision && <button type="button" className="jb-btn btn-secondary tone-warn" disabled={A.busy} title={t('jobsDash.proceedTitle')} onClick={() => void A.bulk('proceed', selectedJobs)}><IcPlay />{t('jobsDash.proceedAnyway')}</button>}
          {anyError && <button type="button" className="jb-btn btn-secondary" disabled={A.busy} onClick={() => void A.bulk('retry', selectedJobs)}><IcRefresh />{t('jobsDash.retry')}</button>}
          <button type="button" className="jb-btn btn-secondary" disabled={A.busy} title={t('jobsDash.rematchTitle')} onClick={() => void A.bulk('rematch', selectedJobs)}><IcRefresh />{t('jobsDash.rematchDots')}</button>
          <button type="button" className="jb-btn btn-secondary" disabled={A.busy} title={t('jobsDash.reprocessWithProfileTitle')} onClick={() => void A.bulk('reprofile', selectedJobs)}><IcSwap />{t('jobsDash.withProfile')}</button>
          <ActionMenu ariaLabel={t('jobsDash.more')} trigger={<>{t('jobsDash.more')}</>} className="btn-secondary" items={[
            { id: 'reprocess', label: t('jobsDash.reprocess'), icon: <IcRefresh />, onClick: () => void A.bulk('retry', selectedJobs), title: t('jobsDash.reprocessTitle'), disabled: A.busy },
            { id: 'test', label: t('jobsDash.testDots'), icon: <IcFlask />, onClick: () => void A.bulk('test', selectedJobs), title: t('jobsDash.testTitle'), disabled: A.busy },
            ...(anyReusable ? [{ id: 'reuse', label: t('jobsDash.reuse'), icon: <IcCopy />, onClick: () => void A.bulk('reuse', selectedJobs), title: t('jobsDash.reuseTitle'), disabled: A.busy }] : []),
            ...(anyActive ? [{ id: 'cancel', label: t('jobsDash.cancel'), icon: <IcX />, onClick: () => void A.bulk('cancel', selectedJobs), danger: true, disabled: A.busy }] : []),
          ]} />
          {A.bulkResult && <span style={{ fontSize: 11, color: 'var(--c-text-secondary)' }}>{A.bulkResult}</span>}
          <button type="button" className="jb-btn ghost icon" aria-label={t('jobsDash.deselect')} title={t('jobsDash.deselect')} onClick={() => onChecked(new Set())}><IcX /></button>
        </div>
      )}
    </div>
  )
}
