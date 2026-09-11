#!/usr/bin/env node
// E2E di produzione: login reale (come la UI, senza password) + carica PDF
// sull'API del worker deployato (POST /api/polizza/job) e attende l'esito.
// NON usa percorsi locali né test-docling: l'estrazione gira sul SERVER di
// produzione (OCR/Docling/Ollama di prod), esattamente come un job dall'UI.
//
// Uso: node scripts/e2e-prod.mjs <baseUrl> <email> <pdf1> [pdf2 ...]
//   baseUrl es. https://genius.csabroker.it
//   email   es. francesco.galleano@omeganodes.ai  (dominio autorizzato, no password)
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const [base, email, ...pdfArgs] = process.argv.slice(2)
if (!base || !email || !pdfArgs.length) {
  console.error('Uso: node scripts/e2e-prod.mjs <baseUrl> <email> <pdf1> [pdf2 ...]')
  process.exit(2)
}

// Il sito può avere un certificato non fidato (self-signed): Node lo accetta.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

let cookie = ''
async function login() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'e2e-prod-script' },
    body: JSON.stringify({ email }),
    redirect: 'manual',
  })
  if (!res.ok) throw new Error(`Login → HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  const setCook = res.headers.getSetCookie?.() || []
  const sc = setCook.find((c) => c.startsWith('pdf_extractor_session=')) || String(res.headers.get('set-cookie') || '')
  cookie = sc.split(';')[0]
  if (!cookie) throw new Error(`Login ok ma nessun cookie di sessione nel set-cookie`)
  console.log(`Login ok come ${email}`)
}

const headers = () => ({ Cookie: cookie })

async function startJob(files) {
  const form = new FormData()
  for (const f of files) {
    const buf = readFileSync(f)
    form.append('pdf', new Blob([new Uint8Array(buf)]), f.split('/').pop())
  }
  const res = await fetch(`${base}/api/polizza/job`, { method: 'POST', headers: headers(), body: form })
  if (!res.ok) throw new Error(`POST /api/polizza/job → HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  const j = await res.json()
  if (!j.jobId) throw new Error(`Nessun jobId: ${JSON.stringify(j)}`)
  return j.jobId
}

async function waitJob(jobId, timeoutMs = 30 * 60 * 1000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`${base}/api/polizza/job/${jobId}`, { headers: headers() })
    if (!res.ok) throw new Error(`GET job → HTTP ${res.status}`)
    const j = await res.json()
    const st = j.status || j.job?.status
    if (st === 'done' || st === 'error') return j
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('Timeout ad attendere il job')
}

await login()
const started = Date.now()
const jobId = await startJob(pdfArgs.map((p) => (p.startsWith('/') ? p : join(process.cwd(), p))))
console.log(`Job avviato: ${jobId} (${pdfArgs.length} PDF)`)
const done = await waitJob(jobId)
const secs = ((Date.now() - started) / 1000).toFixed(0)
const status = done.status || done.job?.status

if (status !== 'done') {
  console.error(`\nESITO: ${status} dopo ${secs}s`)
  console.error('errore:', done.error || done.job?.error || '(nessun errore)')
  console.error('log:', (done.logs || done.job?.logs || []).slice(-25).join('\n'))
  process.exit(1)
}

console.log(`\n=== DONE in ${secs}s ===`)
const data = done.data || done.job?.state || {}
const src = done.sources || done.job?.sources || {}
const entries = Object.entries(data).filter(([, v]) => v != null && v !== '')
console.log(`Campi estratti: ${entries.length}`)
for (const [k, v] of entries) {
  const s = src?.[k]
  console.log(`  ${k.padEnd(42)} = ${String(v).slice(0, 70)}${s?.file ? `  [${s.file}${s.page ? ` p${s.page}` : ''}]` : ''}`)
}
console.log('\n--- LOG (ultimi 20) ---')
for (const l of (done.logs || done.job?.logs || []).slice(-20)) console.log(' ', String(l).slice(0, 200))