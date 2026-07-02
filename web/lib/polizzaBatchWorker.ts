// Orchestratore per i batch: elabora i job polizza figli di un batch_jobs UNO alla
// volta (un dossier/cartella per volta), riusando runJobAndWait di polizzaJobWorker
// senza duplicarne la logica di estrazione. Fire-and-forget come i job singoli:
// prosegue a tab chiusa, riprendibile dopo un restart del container (vedi
// listActiveBatchIds/instrumentation.ts).

import { getNextPendingBatchJob } from './polizzaJobStore'
import { runJobAndWait } from './polizzaJobWorker'

const running = new Set<string>()

export function startBatch(batchId: string): void {
  if (running.has(batchId)) return
  running.add(batchId)
  void runBatch(batchId).finally(() => running.delete(batchId))
}

async function runBatch(batchId: string): Promise<void> {
  for (;;) {
    const jobId = await getNextPendingBatchJob(batchId)
    if (!jobId) return
    await runJobAndWait(jobId)
  }
}
