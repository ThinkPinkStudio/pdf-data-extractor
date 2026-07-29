// Orchestratore per i batch: elabora i job polizza figli di un batch_jobs UNO alla
// volta (un dossier/cartella per volta), riusando runJobAndWait di polizzaJobWorker
// senza duplicarne la logica di estrazione. Fire-and-forget come i job singoli:
// prosegue a tab chiusa, riprendibile dopo un restart del container (vedi
// listActiveBatchIds/instrumentation.ts).
//
// L'esecuzione effettiva dei job è serializzata dal semaforo globale condiviso
// (llmSemaphore, dentro runJobAndWait): job di batch diversi e job singoli non girano
// mai in parallelo tra loro (protegge VRAM e rate limit LLM/OCR condivisi).

import { getNextPendingBatchJob, isUploadComplete } from './polizzaJobStore'
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
    if (jobId) {
      await runJobAndWait(jobId) // serializzato internamente dal semaforo globale
      continue
    }
    // Nessun job pronto: se l'upload è ancora in corso, altri dossier potrebbero
    // arrivare a breve (upload a chunk) — attende invece di terminare l'orchestrazione.
    if (await isUploadComplete(batchId)) return
    await new Promise((r) => setTimeout(r, 2000))
  }
}
