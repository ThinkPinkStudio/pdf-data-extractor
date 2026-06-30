// Tipi condivisi nell'orchestratore.

/** Forma canonica del progress dell'API (= rollingProgress). */
export interface ExtractProgress {
  docIndex: number
  docTotal: number
  pageIndex: number
  pageTotal: number
  docName: string
  totalPagesProcessed: number
}

export type ErrorKind = 'transient' | 'deterministic'
