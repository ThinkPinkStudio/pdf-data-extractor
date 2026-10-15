// Semaforo a limite 1 per TUTTE le estrazioni (LLM/OCR), CONDIVISO tra processi.
//
// Perche: in produzione ci sono piu repliche/container del worker, ognuno con la
// propria memoria — una coda in-memory (per-processo) permetteva run in PARALLELO
// tra repliche, facendo esplodere la VRAM 8GB (advisory lock: vedi db.ts /
// withDistributedLock). Ora tutte le estrazioni passano da un LOCK SU POSTGRES
// condiviso: a livello di sistema gira UNA sola run alla volta; le altre si
// accodano e attendono (pg_advisory_lock e bloccante).
//
// La coda in-process resta come accodamento locale (evita di aprire N connessioni
// al DB per N job in attesa): il lock DB garantisce la mutualita TRA processi.

import { withDistributedLock } from './db'

let globalQueue: Promise<void> = Promise.resolve()

export function withGlobalLock<T>(fn: () => Promise<T>): Promise<T> {
  // Coda in-process (ordine FIFO locale) + lock DB (mutualita globale).
  const run = globalQueue.then(() => withDistributedLock('extraction_run', fn), () => withDistributedLock('extraction_run', fn))
  globalQueue = run.then(() => undefined, () => undefined)
  return run
}