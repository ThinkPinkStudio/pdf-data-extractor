import type { ReactNode } from 'react'
import type { DetailTab, JobSnapshot, T } from './types'
import type { JobActions } from './useJobActions'
import { hasValues, isReusable, uiState } from './model'
import { IcCopy, IcDownload, IcFile, IcFlask, IcList, IcPlay, IcRefresh, IcSwap, IcX } from './Icons'

export interface ActionDef { id: string; label: string; shortLabel?: string; icon: ReactNode; tone?: 'primary' | 'warn' | 'ok' | 'ghost' | 'danger'; title?: string; run: () => void }
export interface ActionSet { primary: ActionDef | null; secondary: ActionDef[]; menu: ActionDef[] }

// UNICA regola «quale azione per quale stato», usata da riga (primaria + ⋯),
// pannello di dettaglio (primaria + secondarie + ⋯) e coda. L'azione primaria
// è il passo successivo naturale: Estrai per un'abbinata, Procedi comunque
// per una da decidere (o «Usa il profilo suggerito» quando c'è), Riprova per
// un errore, Excel per un'estratta, Annulla per una in corso. Una NON VALIDA
// (nessuna polizza, regola dell'utente del 26/09/2026) non si forza: niente
// Procedi comunque, niente profilo suggerito, niente Estrai né riuso; resta
// solo Riabbina, che rifà il controllo (le route rifiutano comunque con 409).
export function actionSet(j: JobSnapshot, A: JobActions, t: T, openTab: (tab: DetailTab) => void): ActionSet {
  const st = uiState(j)
  const sugg = j.precheck?.suggestion && j.precheck.suggestion.id && j.precheck.suggestion.id !== j.profileId ? j.precheck.suggestion : null
  const mk = (id: string, label: string, icon: ReactNode, run: () => void, extra: Partial<ActionDef> = {}): ActionDef => ({ id, label, icon, run, ...extra })

  const cancel = mk('cancel', t('jobsDash.cancel'), <IcX />, () => void A.cancel(j), { tone: 'ghost' })
  const extract = mk('extract', t('jobsDash.extract'), <IcPlay />, () => void A.extract(j), { tone: 'primary', title: t('jobsDash.extractTitle') })
  const proceed = mk('proceed', t('jobsDash.proceedAnyway'), <IcPlay />, () => void A.proceed(j), { tone: 'warn', title: st === 'review' ? t('jobsDash.proceedReviewTitle') : t('jobsDash.proceedTitle') })
  const useSugg = sugg ? mk('useSugg', t('jobsDash.useSuggestedNamed', { name: sugg.name }), <IcRefresh />, () => void A.rematchWith(j, sugg.id), { tone: 'ok', shortLabel: t('jobsDash.useSuggested'), title: `${t('jobsDash.useSuggestedNamed', { name: sugg.name })} — ${t('jobsDash.useSuggestedTitle')}` }) : null
  const rematch = mk('rematch', t('jobsDash.rematchDots'), <IcRefresh />, () => A.openRematch([j]), { title: t('jobsDash.rematchTitle') })
  const reprofile = mk('reprofile', t('jobsDash.withProfile'), <IcSwap />, () => A.openReprofile([j]), { title: t('jobsDash.reprocessWithProfileTitle') })
  const reprocess = mk('reprocess', t('jobsDash.reprocess'), <IcRefresh />, () => void A.retry(j), { title: t('jobsDash.reprocessTitle') })
  const retry = mk('retry', t('jobsDash.retry'), <IcRefresh />, () => void A.retry(j), { tone: 'primary' })
  const reuse = mk('reuse', t('jobsDash.reuse'), <IcCopy />, () => void A.reuse(j), { title: t('jobsDash.reuseTitle') })
  const test = mk('test', t('jobsDash.testDots'), <IcFlask />, () => A.openTest([j]), { title: t('jobsDash.testTitle') })
  const excel = mk('excel', 'Excel', <IcDownload />, () => void A.exportExcel(j))
  const values = mk('values', t('jobsDash.tabValues'), <IcList />, () => openTab('values'))
  const log = mk('log', t('jobsDash.tabLog'), <IcList />, () => openTab('log'))
  const files = mk('files', t('jobsDash.tabFiles'), <IcFile />, () => openTab('files'), { title: t('jobsDash.filesTitle') })
  const reusable = isReusable(j) ? [reuse] : []
  // Dossier nato da un'UNIONE della riconciliazione: si può disfare (i file
  // tornano nelle cartelle da cui sono stati caricati) e riabbinare.
  const lastIdx = (needle: string) => (j.logs || []).reduce((at, l, i) => (l.includes(needle) ? i : at), -1)
  const merged = lastIdx('Riconciliazione per numero di polizza') > lastIdx("Separazione per cartella d'origine")
  const splitFn = A.split
  const split = merged && splitFn ? [mk('split', t('jobsDash.split'), <IcSwap />, () => void splitFn(j), { title: t('jobsDash.splitTitle') })] : []

  switch (st) {
    case 'running':
    case 'queued':
      return { primary: cancel, secondary: [], menu: [log, files] }
    case 'matched':
      return { primary: extract, secondary: [rematch, reprofile], menu: [reprocess, ...split, log, files] }
    case 'notValid':
      return { primary: { ...rematch, tone: 'primary' }, secondary: [], menu: [...split, log, files] }
    case 'review':
    case 'mismatch':
    case 'discarded':
      return useSugg
        ? { primary: useSugg, secondary: [proceed, rematch, reprofile], menu: [reprocess, ...split, log, files] }
        : { primary: proceed, secondary: [rematch, reprofile], menu: [reprocess, ...split, log, files] }
    case 'error':
      return { primary: retry, secondary: [...reusable, rematch, reprofile], menu: [test, ...split, log, files] }
    case 'canceled':
      return { primary: { ...reprocess, tone: 'primary' }, secondary: [...reusable, rematch, reprofile], menu: [...split, log, files] }
    case 'done':
    default:
      return { primary: hasValues(j) ? excel : null, secondary: [rematch, reprofile], menu: [reprocess, test, ...split, values, log, files] }
  }
}

export function buttonClass(a: ActionDef): string {
  if (a.tone === 'primary') return 'jb-btn btn-primary'
  if (a.tone === 'ghost') return 'jb-btn ghost'
  return `jb-btn btn-secondary${a.tone === 'warn' ? ' tone-warn' : a.tone === 'ok' ? ' tone-ok' : a.tone === 'danger' ? ' tone-danger' : ''}`
}
