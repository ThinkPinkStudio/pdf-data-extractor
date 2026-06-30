import { loadConfig, requireKeys } from './config'
import { initBatchSchema, pool } from './db'
import { discover } from './discovery'
import { createRun, enqueueDiscovered, updateRunTotal } from './queue'
import { runForever } from './runner'
import { writeManifest, writeErrorReport, printSummary } from './report'

// CLI:
//   work       loop autonomo sequenziale (default; comando del container)
//   scan       discovery ricorsiva → crea un run e mette le polizze in coda
//   dry-run    discovery in sola lettura: conta/anteprima, niente DB
//   report <runId>   scrive manifest + report errori e stampa il riepilogo
const cmd = process.argv[2] || 'work'
const cfg = loadConfig()

async function main(): Promise<void> {
  switch (cmd) {
    case 'dry-run': {
      requireKeys(cfg, ['roots'])
      let n = 0
      for await (const u of discover(cfg.roots, cfg.matcher)) {
        n++
        if (n <= 20) console.log(`${u.policyKey.slice(0, 8)}  ${u.folderPath}  (${u.pdfPaths.length} pdf)`)
      }
      console.log(`\nTotale polizze trovate: ${n}`)
      break
    }

    case 'scan': {
      requireKeys(cfg, ['databaseUrl', 'roots'])
      await initBatchSchema()
      const runId = await createRun(cfg.roots, cfg.matcher, cfg.outputRoot)
      let n = 0
      for await (const u of discover(cfg.roots, cfg.matcher)) {
        await enqueueDiscovered(runId, u)
        if (++n % 500 === 0) console.log(`  …${n} in coda`)
      }
      await updateRunTotal(runId)
      console.log(`Run #${runId} creato — ${n} polizze in coda.`)
      break
    }

    case 'work': {
      requireKeys(cfg, ['databaseUrl', 'apiUrl', 'serviceToken', 'outputRoot'])
      await initBatchSchema()
      await runForever()
      break
    }

    case 'report': {
      requireKeys(cfg, ['databaseUrl'])
      const runId = parseInt(process.argv[3] || '', 10)
      if (!Number.isFinite(runId)) {
        console.error('uso: report <runId>')
        process.exit(1)
      }
      const m = await writeManifest(runId, cfg.outputRoot)
      const e = await writeErrorReport(runId, cfg.outputRoot)
      await printSummary(runId)
      console.log(`Manifest: ${m}\nErrori:   ${e}`)
      break
    }

    default:
      console.error(`comando sconosciuto: ${cmd} (usa: work | scan | dry-run | report)`)
      process.exit(1)
  }

  await pool.end().catch(() => {})
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
