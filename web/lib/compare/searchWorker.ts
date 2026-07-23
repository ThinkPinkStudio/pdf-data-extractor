// Web Worker per i calcoli O(nA·nB) di Ricerca e In Entrambi: girano fuori dal
// main thread così la tab non si blocca su portafogli grandi.
import { runInclusionSearch, runBothMatch, type Row, type Condition } from './engine'

type Req =
  | { kind: 'search'; dataA: Row[]; dataB: Row[]; conditions: Condition[] }
  | { kind: 'both'; dataA: Row[]; dataB: Row[]; matchConds: Condition[]; filterConds: Condition[] }

const ctx = self as unknown as Worker

ctx.onmessage = (e: MessageEvent<Req>) => {
  const msg = e.data
  try {
    if (msg.kind === 'search') {
      ctx.postMessage({ ok: true, result: runInclusionSearch(msg.dataA, msg.dataB, msg.conditions) })
    } else {
      ctx.postMessage({ ok: true, result: runBothMatch(msg.dataA, msg.dataB, msg.matchConds, msg.filterConds) })
    }
  } catch (err) {
    ctx.postMessage({ ok: false, error: (err as Error).message })
  }
}

export {}
