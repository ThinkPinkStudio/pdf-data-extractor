// Configurazione dell'orchestratore, tutta da variabili d'ambiente.

export interface MatcherConfig {
  /** Regex (case-insensitive) sul nome cartella; null = qualsiasi cartella con PDF. */
  nameRegex: string | null
  /** Unità polizza: per cartella (tutti i PDF insieme) o per singolo file. */
  group: 'folder' | 'file'
}

export interface Config {
  databaseUrl: string
  apiUrl: string
  serviceToken: string
  outputRoot: string
  roots: string[]
  pollIntervalMs: number
  jobTimeoutMs: number
  maxTransientAttempts: number
  backoffMs: number[]
  llmPauseMs: number
  loopIdleMs: number
  matcher: MatcherConfig
}

function int(name: string, def: number): number {
  const v = parseInt(process.env[name] || '', 10)
  return Number.isFinite(v) ? v : def
}

export function loadConfig(): Config {
  return {
    databaseUrl: process.env.DATABASE_URL || '',
    apiUrl: (process.env.EXTRACT_API_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    serviceToken: process.env.EXTRACT_SERVICE_TOKEN || '',
    outputRoot: process.env.OUTPUT_ROOT || '/data/output',
    roots: (process.env.BATCH_ROOTS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    pollIntervalMs: int('POLL_INTERVAL_MS', 1500),
    jobTimeoutMs: int('JOB_TIMEOUT_MS', 600000),
    maxTransientAttempts: int('MAX_TRANSIENT_ATTEMPTS', 3),
    backoffMs: (process.env.BACKOFF_MS || '5000,30000,120000')
      .split(',')
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => Number.isFinite(n)),
    llmPauseMs: int('LLM_PAUSE_MS', 60000),
    loopIdleMs: int('LOOP_IDLE_MS', 5000),
    matcher: {
      nameRegex: process.env.MATCH_NAME_REGEX === '' ? null : process.env.MATCH_NAME_REGEX ?? 'polizz',
      group: process.env.MATCH_GROUP === 'file' ? 'file' : 'folder',
    },
  }
}

/** Valida che le chiavi richieste siano presenti, altrimenti esce con errore chiaro. */
export function requireKeys(cfg: Config, keys: (keyof Config)[]): void {
  const missing = keys.filter((k) => {
    const v = cfg[k]
    return v == null || v === '' || (Array.isArray(v) && v.length === 0)
  })
  if (missing.length > 0) {
    console.error(`[config] Variabili d'ambiente mancanti: ${missing.join(', ')}`)
    process.exit(1)
  }
}
