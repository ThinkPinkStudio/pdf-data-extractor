// Orchestratore per i batch: elabora i job polizza figli di un batch_jobs UNO alla
// volta (un dossier/cartella per volta), riusando runJobAndWait di polizzaJobWorker
// senza duplicarne la logica di estrazione. Fire-and-forget come i job singoli:
// prosegue a tab chiusa, riprendibile dopo un restart del container (vedi
// listActiveBatchIds/instrumentation.ts).
//
// Un semaforo globale (limite 1) serializza l'esecuzione effettiva dei job ACROSS
// TUTTI i batch attivi: se due batch vengono avviati uno dopo l'altro, i loro job
// non girano mai in parallelo tra loro (protegge i rate limit LLM/OCR condivisi).

import { getNextPendingBatchJob, isUploadComplete } from './polizzaJobStore'
import { runJobAndWait } from './polizzaJobWorker'

const running = new Set<string>()

// Semaforo in-process a limite 1: le chiamate si accodano ed eseguono una alla volta,
// qualunque sia il batch di provenienza. Sufficiente con un solo container/processo
// (assunzione di deploy attuale, vedi docker-compose.yml); con più repliche servirebbe
// un lock su Postgres.
let globalQueue: Promise<void> = Promise.resolve()
function withGlobalLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = globalQueue.then(fn, fn)
  globalQueue = run.then(() => undefined, () => undefined)
  return run
}

export function startBatch(batchId: string): void {
  if (running.has(batchId)) return
  running.add(batchId)
  void runBatch(batchId).finally(() => running.delete(batchId))
}

async function runBatch(batchId: string): Promise<void> {
  for (;;) {
    const jobId = await getNextPendingBatchJob(batchId)
    if (jobId) {
      await withGlobalLock(() => runJobAndWait(jobId))
      continue
    }
    // Nessun job pronto: se l'upload è ancora in corso, altri dossier potrebbero
    // arrivare a breve (upload a chunk) — attende invece di terminare l'orchestrazione.
    if (await isUploadComplete(batchId)) return
    await new Promise((r) => setTimeout(r, 2000))
  }
}
