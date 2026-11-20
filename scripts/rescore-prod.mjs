#!/usr/bin/env node
/**
 * RIPUNTEGGIA le run salvate da golden-prod.mjs coi golden ATTUALI (dopo una
 * correzione della verità le run vecchie si confrontano sulla stessa verità).
 *   node scripts/rescore-prod.mjs .goldens-out/prod-A [.goldens-out/prod-B …]
 * Stampa una colonna per cartella: giusti/N per fascicolo e il totale. Un
 * fascicolo fermato dall'app vale 0/N (vista del cliente); i casi di validità
 * (expect 'non-valido') sono fuori dal totale dei campi.
 */
import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { FULL_CASES } from './golden-cases.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { scoreFullTruth } = await import(join(root, 'src/services/polizzaEval.js'))
const dirs = process.argv.slice(2)
if (!dirs.length) { console.error('Uso: node scripts/rescore-prod.mjs <dir> [<dir> …]'); process.exit(2) }
const tot = dirs.map(() => ({ r: 0, n: 0 }))
console.log(['fascicolo'.padEnd(18), ...dirs.map((d) => d.split('/').pop().slice(-22).padStart(22))].join(' '))
// Casi di VALIDITÀ (expect 'non-valido', es. ALZAIA: sola quietanza): fuori dal
// conteggio dei campi; giusto se l'app ha detto «Non valido» e non ha estratto.
// Le misure salvate prima del 26/09 mattina non hanno `error`: vale anche la
// ragione della pertinenza («nessuna polizza tra i documenti letti…»).
const isNotValid = (j) => j?.status === 'mismatch' && (/^(?:Non valido|Accantonato)\b/.test(String(j?.error || '')) || /^nessuna polizza\b/i.test(String(j?.pertinenza?.reason || '')))
for (const c of FULL_CASES) {
  const golden = JSON.parse(readFileSync(join(root, c.golden), 'utf8'))
  const cells = dirs.map((d, i) => {
    const f = join(d, `${c.id}.json`)
    if (!existsSync(f)) return '—'.padStart(22)
    const j = JSON.parse(readFileSync(f, 'utf8'))
    if (c.expect === 'non-valido') return (isNotValid(j) ? 'non valido: GIUSTO' : j.status === 'done' ? 'ESTRATTO: SBAGLIATO' : `${j.status}: SBAGLIATO`).padStart(22)
    // Fermato dall'app = 0 campi per il cliente (mai più forzato: 26/09/2026).
    if (j.status !== 'done') { const n = (j.fieldDefs || []).length; tot[i].n += n; return `0/${n} (${j.status})`.padStart(22) }
    const s = scoreFullTruth({ data: j.values || {} }, golden, j.fieldDefs || [])
    tot[i].r += s.right; tot[i].n += s.total
    return `${s.right}/${s.total} ${Math.round((s.right / s.total) * 100)}%`.padStart(22)
  })
  console.log([c.id.padEnd(18), ...cells].join(' '))
}
console.log(['TOTALE'.padEnd(18), ...tot.map((t) => (t.n ? `${t.r}/${t.n} ${(Math.round((t.r / t.n) * 1000) / 10)}%` : '—').padStart(22))].join(' '))
