import type { ExtractProgress, JobError, ErrorKind } from './extractJobs'
import { extractPolizza } from './polizzaEngine'

// Seam unico verso il meccanismo: l'estrazione è quella ESATTA dell'app
// (polizzaEngine → funzioni di src/main/services/polizzaService.js).
// Nessuna modalità finta.

export interface ExtractionResult {
  data: Record<string, string>
}

export async function runExtraction(
  pdfPaths: string[],
  onProgress: (p: ExtractProgress) => void
): Promise<ExtractionResult> {
  return extractPolizza(pdfPaths, onProgress)
}

/** Classifica un errore in transitorio/deterministico per guidare il retry. */
export function classifyError(err: unknown): JobError {
  const e = err as { message?: unknown; isLlmConnectionError?: boolean; isLlmFatal?: boolean }
  const message = e?.message ? String(e.message) : String(err)
  let kind: ErrorKind
  if (e?.isLlmConnectionError) kind = 'transient'
  else if (e?.isLlmFatal) kind = 'deterministic'
  else if (/timeout|ECONNREFUSED|ENOTFOUND|fetch failed|socket|network|503|502|504/i.test(message)) kind = 'transient'
  else kind = 'deterministic'
  return { message, kind }
}
