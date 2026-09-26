// Proprietà comuni delle quattro viste del riepilogo.
import type { SummaryDetail, SummaryField } from '@/lib/summaryTypes'
import type { Fmt } from '../format'
import type { SummaryQuery, SummaryState } from '../useSummary'

export interface ViewProps {
  d: SummaryDetail
  fmt: Fmt
  /** Campi del riepilogo (anche quelli tolti dal profilo) per id. */
  byId: Map<string, SummaryField>
  q: SummaryQuery
  setQ: (p: Partial<SummaryQuery>) => void
  patch: SummaryState['patch']
  busy: boolean
  /** Messaggio d'errore di un salvataggio (mostrato in un avviso). */
  onError: (msg: string) => void
}

export const OTHER_KEY = '__other'
export const EMPTY_KEY = '__empty'
export const DOSSIER_KEY = '@dossier'
