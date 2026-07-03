export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initDb } = await import('./lib/db')
    await initDb()

    // Ripresa dei job di estrazione rimasti 'running'/'queued' (es. dopo un restart
    // del container): il worker riparte dal cursor persistito. Non bloccante.
    try {
      const { listResumableJobs } = await import('./lib/polizzaJobStore')
      const { startJob } = await import('./lib/polizzaJobWorker')
      const ids = await listResumableJobs()
      for (const id of ids) startJob(id)
    } catch { /* la ripresa non deve mai bloccare il boot */ }

    // Ripresa dei batch con job figli non ancora completati: l'orchestratore
    // riprende l'elaborazione sequenziale dal job giusto (running > queued). Nessun
    // client può più essere a metà upload verso questo processo appena riavviato,
    // quindi i batch ancora "aperti" vengono chiusi forzatamente prima — altrimenti
    // l'orchestratore resterebbe in attesa per sempre di dossier che non arriveranno.
    try {
      const { listActiveBatchIds, forceUploadCompleteForActiveBatches } = await import('./lib/polizzaJobStore')
      const { startBatch } = await import('./lib/polizzaBatchWorker')
      await forceUploadCompleteForActiveBatches()
      const batchIds = await listActiveBatchIds()
      for (const id of batchIds) startBatch(id)
    } catch { /* la ripresa non deve mai bloccare il boot */ }
  }
}
