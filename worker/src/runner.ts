import { mkdir, writeFile } from 'fs/promises'
import { join, relative, basename } from 'path'
import { loadConfig } from './config'
import {
  claimNextItem, markDone, markErrorFinal, requeueItem, updateItemProgress,
  pauseRun, resumePausedRuns, resumeStuck, finalizeRuns,
} from './queue'
import { submitPolicy, pollJob, downloadResult, ApiError } from './apiClient'
import type { BatchItem } from './db'

const cfg = loadConfig()
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Loop autonomo, sequenziale (concorrenza = 1). Indipendente da qualsiasi
// sessione browser; sopravvive all'abbandono dell'utente.
export async function runForever(): Promise<void> {
  await resumeStuck()
  let stop = false
  const onStop = () => {
    stop = true
    console.log('[worker] stop richiesto: termino l\'item corrente e esco (graceful)')
  }
  process.on('SIGTERM', onStop)
  process.on('SIGINT', onStop)

  console.log('[worker] loop avviato (sequenziale, concorrenza=1)')
  while (!stop) {
    await resumePausedRuns(Date.now())
    const item = await claimNextItem(Date.now())
    if (!item) {
      await finalizeRuns(Date.now())
      await sleep(cfg.loopIdleMs)
      continue
    }
    await processItem(item)
  }
}

async function processItem(item: BatchItem): Promise<void> {
  const name = basename(item.folder_path) || `polizza-${item.id}`
  const started = Date.now()
  try {
    const buf = await runOnce(item, name)
    const outPath = await saveMirror(item, name, buf)
    await markDone(item.id, outPath, Date.now() - started)
    console.log(`[done] #${item.id} ${name} → ${outPath}`)
  } catch (err) {
    const e = err as ApiError
    if (e?.kind === 'deterministic') {
      await markErrorFinal(item.id, e.message || String(err))
      console.error(`[error] #${item.id} ${name}: ${e?.message}`)
    } else {
      // Transitorio persistente (provider in difficoltà): rimetti in coda e
      // metti l'intero run in pausa — non bruciare la coda a vuoto.
      await requeueItem(item.id)
      await pauseRun(item.run_id, Date.now() + cfg.llmPauseMs)
      console.warn(`[pause] run ${item.run_id} in pausa ${cfg.llmPauseMs}ms: ${e?.message}`)
    }
  }
}

// submit → poll(progress) → download, con retry inline sui transitori.
async function runOnce(item: BatchItem, name: string): Promise<Buffer> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= cfg.maxTransientAttempts; attempt++) {
    try {
      const jobId = await submitPolicy(item.pdf_paths, name)
      const deadline = Date.now() + cfg.jobTimeoutMs
      for (;;) {
        const st = await pollJob(jobId)
        if (st.status === 'done') return await downloadResult(jobId)
        if (st.status === 'error') {
          const k = st.error?.kind === 'deterministic' ? 'deterministic' : 'transient'
          throw new ApiError(st.error?.message || 'estrazione fallita', k)
        }
        if (st.progress) {
          const p = st.progress
          await updateItemProgress(item.id, p)
          console.log(
            `[..] #${item.id} ${name} doc ${p.docIndex + 1}/${p.docTotal} pag ${p.pageIndex}/${p.pageTotal}`
          )
        }
        if (Date.now() > deadline) throw new ApiError('timeout job', 'transient')
        await sleep(cfg.pollIntervalMs)
      }
    } catch (err) {
      lastErr = err
      const e = err as ApiError
      if (e?.kind === 'deterministic') throw err // non ritentare
      const backoff = cfg.backoffMs[Math.min(attempt - 1, cfg.backoffMs.length - 1)] ?? 5000
      console.warn(
        `[retry] #${item.id} tentativo ${attempt}/${cfg.maxTransientAttempts} tra ${backoff}ms: ${e?.message}`
      )
      await sleep(backoff)
    }
  }
  throw lastErr ?? new ApiError('estrazione fallita', 'transient')
}

/** Salva l'XLS nell'albero mirror sotto OUTPUT_ROOT (sorgenti intatti). */
async function saveMirror(item: BatchItem, name: string, buf: Buffer): Promise<string> {
  const rel = relative(item.root_path, item.folder_path)
  const dir = join(cfg.outputRoot, rel)
  await mkdir(dir, { recursive: true })
  const out = join(dir, `${name}.xlsx`)
  await writeFile(out, buf)
  return out
}
