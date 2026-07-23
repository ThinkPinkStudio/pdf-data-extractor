'use client'

// Helper client per eseguire un calcolo nel Web Worker e ottenerne il risultato
// come Promise. Ogni chiamata usa un worker usa-e-getta (terminato a fine job).
import type { Row, Condition, MatchKey } from './engine'

type Req =
  | { kind: 'search'; dataA: Row[]; dataB: Row[]; conditions: Condition[] }
  | { kind: 'both'; dataA: Row[]; dataB: Row[]; matchConds: Condition[]; filterConds: Condition[] }
  | { kind: 'compare'; dataA: Row[]; dataB: Row[]; keys: MatchKey[]; minOverlap: number; broadOpts: { enabled: boolean; minOverlap: number } }

export function runInWorker<T>(req: Req): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./searchWorker.ts', import.meta.url))
    } catch (e) {
      // Fallback (ambienti senza Worker): esegue in modo sincrono sul main thread.
      import('./engine').then((eng) => {
        if (req.kind === 'search') resolve(eng.runInclusionSearch(req.dataA, req.dataB, req.conditions) as unknown as T)
        else if (req.kind === 'both') resolve(eng.runBothMatch(req.dataA, req.dataB, req.matchConds, req.filterConds) as unknown as T)
        else resolve(eng.compare(req.dataA, req.dataB, req.keys, req.minOverlap, req.broadOpts) as unknown as T)
      }).catch(reject)
      void e
      return
    }
    worker.onmessage = (ev: MessageEvent<{ ok: boolean; result?: T; error?: string }>) => {
      const d = ev.data
      worker.terminate()
      if (d.ok) resolve(d.result as T)
      else reject(new Error(d.error || 'Errore nel worker'))
    }
    worker.onerror = (ev) => { worker.terminate(); reject(new Error(ev.message || 'Errore nel worker')) }
    worker.postMessage(req)
  })
}
