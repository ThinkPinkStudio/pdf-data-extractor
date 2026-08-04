// Web Worker per i calcoli O(nA·nB) di Ricerca e In Entrambi: girano fuori dal
// main thread così la tab non si blocca su portafogli grandi.
import { compare, runInclusionSearch, runBothByRow, type Row, type Condition, type MatchKey, type FuzzyOpts } from './engine'

type Req =
  | { kind: 'search'; dataA: Row[]; dataB: Row[]; conditions: Condition[] }
  | { kind: 'both'; dataA: Row[]; dataB: Row[]; matchConds: Condition[]; filterConds: Condition[] }
  | { kind: 'compare'; dataA: Row[]; dataB: Row[]; keys: MatchKey[]; fuzzy: FuzzyOpts }

const ctx = self as unknown as Worker

ctx.onmessage = (e: MessageEvent<Req>) => {
  const msg = e.data
  try {
    if (msg.kind === 'search') {
      ctx.postMessage({ ok: true, result: runInclusionSearch(msg.dataA, msg.dataB, msg.conditions) })
    } else if (msg.kind === 'both') {
      // Verdetto per riga di A (trovata/non trovata in B), mai la matrice di coppie
      ctx.postMessage({ ok: true, result: runBothByRow(msg.dataA, msg.dataB, msg.matchConds, msg.filterConds) })
    } else {
      ctx.postMessage({ ok: true, result: compare(msg.dataA, msg.dataB, msg.keys, msg.fuzzy) })
    }
  } catch (err) {
    ctx.postMessage({ ok: false, error: (err as Error).message })
  }
}

export {}
