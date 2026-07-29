// Semaforo in-process a limite 1 per TUTTE le estrazioni (LLM/OCR) del processo:
// job singoli (startJob) e job figli dei batch (runJobAndWait) si accodano ed
// eseguono UNA alla volta. Su hardware con poca VRAM (es. 8GB) evita che due
// estrazioni colpiscano Ollama in parallelo — swap di modello / OOM. Sufficiente con
// un solo container/processo (assunzione di deploy attuale, vedi docker-compose.yml);
// con più repliche servirebbe un lock su Postgres (advisory lock).

let globalQueue: Promise<void> = Promise.resolve()

export function withGlobalLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = globalQueue.then(fn, fn)
  globalQueue = run.then(() => undefined, () => undefined)
  return run
}
