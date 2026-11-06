// RIEPILOGHI — regole PURE della selezione in Elaborazioni: quali polizze
// possono entrare in un riepilogo (estratte, con valori, non run di test, non
// Non valide) e con quale profilo. È solo un'anteprima: decide il server
// (POST /summaries/preview), che rifiuta col motivo ciò che non può entrare.
import type { JobSnapshot } from '@/components/jobs/types'
import { hasValues, isTestRun } from '@/components/jobs/model'
import { isNotValidJob } from '@/lib/jobValidity'

export const isSummaryEligible = (j: JobSnapshot) => j.status === 'done' && hasValues(j) && !isTestRun(j) && !isNotValidJob(j)

/** Chiave di profilo lato client: id del profilo, altrimenti gli id dei campi (estrazioni singole). */
export function clientProfileKey(j: JobSnapshot): string {
  if (j.profileId && j.profileId !== 'auto') return j.profileId
  return `campi:${(j.fieldDefs || []).map((f) => f.id).sort().join(',')}`
}

export interface SelectionGroup { key: string; profileName: string | null; fieldCount: number; jobs: JobSnapshot[] }

export interface SelectionInfo {
  total: number
  eligible: JobSnapshot[]
  groups: SelectionGroup[]
  /** Il profilo con più polizze ammissibili (a parità il primo nella selezione): come decide il server. */
  main: SelectionGroup | null
  /** Polizze selezionate che NON entrano (non estratte, run di test, Non valide, altri profili). */
  excluded: number
  mixed: boolean
}

export function analyzeSelection(jobs: JobSnapshot[]): SelectionInfo {
  const eligible = jobs.filter(isSummaryEligible)
  const map = new Map<string, SelectionGroup>()
  for (const j of eligible) {
    const key = clientProfileKey(j)
    let g = map.get(key)
    if (!g) {
      g = { key, profileName: j.profileName || (j.profileId && j.profileId !== 'auto' ? j.profileId : null), fieldCount: (j.fieldDefs || []).length, jobs: [] }
      map.set(key, g)
    }
    g.jobs.push(j)
  }
  const groups = [...map.values()]
  let main: SelectionGroup | null = null
  for (const g of groups) if (!main || g.jobs.length > main.jobs.length) main = g
  return { total: jobs.length, eligible, groups, main, excluded: jobs.length - (main ? main.jobs.length : 0), mixed: groups.length > 1 }
}
