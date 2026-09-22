'use client'
import { useEffect } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { DetailTab, JobSnapshot } from './types'
import type { JobActions } from './useJobActions'
import { isActive, isTestRun, needsDecision, reasonLine, shortName, splitName, uiState } from './model'
import { JobDetail } from './JobDetail'
import { IcFlask } from './Icons'

// Vista CODA: lista a sinistra, dettaglio con la decisione a destra; ↑↓ (o
// j/k) scorrono, P = procedi comunque, R = riabbina, O = apri il primo PDF.
// Il filtro è la striscia KPI della pagina (nessuna colonna di stati qui).
// Colore della testa del motivo nella lista: segue lo stato della polizza.
function headClass(j: JobSnapshot): string {
  const st = uiState(j)
  if (st === 'done' || st === 'matched') return 'jb-c-ok'
  if (st === 'review') return 'jb-c-warn'
  if (st === 'error') return 'jb-c-err'
  return 'jb-c-orange'
}

export function JobsQueue({ jobs, batchLabel, selected, position, onSelect, onPrev, onNext, A, tab, onTab, checked, onChecked }: {
  jobs: JobSnapshot[]
  batchLabel?: string | null
  selected: JobSnapshot | null
  position: { i: number; n: number } | null
  onSelect: (id: string) => void
  onPrev: () => void
  onNext: () => void
  A: JobActions
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  checked: Set<string>
  onChecked: (s: Set<string>) => void
}) {
  const t = useT()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (A.dialogOpen || e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target as HTMLElement | null
      const tag = (el?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); onNext(); return }
      if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); onPrev(); return }
      if (!selected || A.busy) return
      const k = e.key.toLowerCase()
      if (k === 'p' && needsDecision(selected)) { e.preventDefault(); void A.proceed(selected) }
      else if (k === 'r' && !isActive(selected)) { e.preventDefault(); A.openRematch([selected]) }
      else if (k === 'o' && (selected.scannedFiles || []).length) { e.preventDefault(); window.open(`/api/polizza/job/${selected.jobId}/file/0`, '_blank', 'noopener') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [A, selected, onNext, onPrev])

  const allChecked = jobs.length > 0 && jobs.every((j) => checked.has(j.jobId))

  return (
    <div style={{ display: 'flex', flex: '1 1 0', minHeight: 0 }}>
      <section style={{ width: 380, flex: 'none', borderRight: '1px solid var(--c-border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: '1px solid var(--c-border)', fontSize: 11, color: 'var(--c-text-secondary)' }}>
          <input type="checkbox" checked={allChecked} aria-label={t('jobsDash.selectAllVisible', { n: jobs.length })} title={t('jobsDash.selectAllVisible', { n: jobs.length })}
            onChange={(e) => { const n = new Set(checked); for (const j of jobs) { if (e.target.checked) n.add(j.jobId); else n.delete(j.jobId) } onChecked(n) }} />
          <span>{t('jobsDash.rowsN', { n: jobs.length })}</span>
          {checked.size > 0 && <span style={{ marginLeft: 'auto' }}>{t('jobsDash.selectedN', { n: checked.size })}</span>}
        </div>
        <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'auto' }}>
          {jobs.length === 0 && <p style={{ padding: 24, fontSize: 12, color: 'var(--c-text-muted)', textAlign: 'center' }}>{t('jobsDash.noRows')}</p>}
          {jobs.map((j) => {
            const { head, body } = reasonLine(j, t)
            const { name, path } = splitName(j, batchLabel)
            const profileName = j.profileName || j.profileId || t('jobsDash.profileNone')
            const nDocs = (j.scannedFiles || []).length
            const sel = selected?.jobId === j.jobId
            return (
              <button key={j.jobId} type="button" className={`jb-item${sel ? ' sel' : ''}`} aria-current={sel ? 'true' : undefined} onClick={() => onSelect(j.jobId)}>
                <span className="n" title={shortName(j, batchLabel)}>
                  {isTestRun(j) && <span className="jb-pill info" style={{ marginRight: 6 }}><IcFlask />{t('jobsDash.testRun')}</span>}
                  {name}
                </span>
                <span className="r">
                  {head && <b className={headClass(j)}>{head}</b>}{head ? ' · ' : ''}{path ? `${path} · ` : ''}{profileName} · {nDocs === 1 ? t('jobsDash.docs1') : t('jobsDash.docsN', { n: nDocs })}
                </span>
                {body && <span className="r">{body}</span>}
              </button>
            )
          })}
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--c-border)', fontSize: 10, color: 'var(--c-text-secondary)', lineHeight: 1.5 }}>{t('jobsDash.kbdHint')}</div>
      </section>
      {selected
        ? <JobDetail variant="inline" job={selected} batchLabel={batchLabel} position={position} onPrev={onPrev} onNext={onNext} tab={tab} onTab={onTab} A={A} />
        : <div style={{ flex: '1 1 0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--c-text-muted)', fontSize: 13 }}>{t('jobsDash.noRows')}</div>}
    </div>
  )
}
