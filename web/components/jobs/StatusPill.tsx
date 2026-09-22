'use client'
import type { ReactElement } from 'react'
import { useT } from '@/lib/i18n/I18nProvider'
import type { JobSnapshot, T, UiState } from './types'
import { uiState } from './model'
import { IcAlert, IcCheck, IcClock, IcHelp, IcPause, IcX, IcXCircle } from './Icons'

// UNA pillola per stato, uguale in tabella, lista, dettaglio: colore
// semantico + icona + etichetta (mai testo colorato sciolto).
const META: Record<UiState, { cls: string; key: string; icon: () => ReactElement }> = {
  running: { cls: 'info', key: 'jobsDash.stRunning', icon: IcClock },
  queued: { cls: 'muted', key: 'jobsDash.stQueued', icon: IcClock },
  matched: { cls: 'ok outline', key: 'jobsDash.stMatched', icon: IcCheck },
  review: { cls: 'warn', key: 'jobsDash.stReview', icon: IcHelp },
  mismatch: { cls: 'orange', key: 'jobsDash.stMismatch', icon: IcXCircle },
  discarded: { cls: 'orange', key: 'jobsDash.stDiscarded', icon: IcXCircle },
  setAside: { cls: 'muted', key: 'jobsDash.stSetAside', icon: IcPause },
  done: { cls: 'ok', key: 'jobsDash.stDone', icon: IcCheck },
  error: { cls: 'err', key: 'jobsDash.stError', icon: IcAlert },
  canceled: { cls: 'muted', key: 'jobsDash.stCanceled', icon: IcX },
}

export function stateLabel(job: JobSnapshot, t: T): string {
  return t(META[uiState(job)].key)
}

export function StatusPill({ job, title }: { job: JobSnapshot; title?: string }) {
  const t = useT()
  const m = META[uiState(job)]
  const Icon = m.icon
  return <span className={`jb-pill ${m.cls}`} title={title}><Icon />{t(m.key)}</span>
}
