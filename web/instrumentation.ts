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
  }
}
