// Video DEMO del funzionamento (dati inventati, palette OmegaNodes, etichette
// neutre): percorso guidato nell'app vera con cursore visibile e didascalie,
// registrato a 1920×1080 col screencast di Chromium e codificato in MP4 (H.264).
// Prerequisiti come capture.mjs: app su DEMO_URL con il DB demo popolato da
// seed.mjs; serve ffmpeg nel PATH.
//   node demo/video.mjs                 → demo/video/pdf-extractor-demo.mp4
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_USER } from './data.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '..', 'web', 'package.json'))
const { chromium } = require('playwright')

const BASE = process.env.DEMO_URL || 'http://localhost:3100'
const OUT_DIR = join(here, 'video')
const FRAMES = join(OUT_DIR, 'frames')
const OUT = join(OUT_DIR, 'pdf-extractor-demo.mp4')
const CSS = readFileSync(join(here, 'theme-omeganodes.css'), 'utf8')
const RELABEL = readFileSync(join(here, 'relabel.js'), 'utf8')
const IDS = JSON.parse(readFileSync(join(here, '.seed-ids.json'), 'utf8'))
const W = 1920
const H = 1080

rmSync(FRAMES, { recursive: true, force: true })
mkdirSync(FRAMES, { recursive: true })

// Cursore, onde del click, didascalie e cartelli: solo DOM della pagina, ricreati
// a ogni caricamento (la posizione del cursore sopravvive in sessionStorage).
const OVERLAY = `(() => {
  const css = \`
    #demo-cursor{position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;will-change:transform}
    #demo-cursor svg{filter:drop-shadow(0 2px 5px rgba(0,0,0,.55))}
    .demo-ripple{position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:3px solid #e09427;z-index:2147483646;pointer-events:none;animation:demoRipple .65s ease-out forwards}
    @keyframes demoRipple{from{transform:scale(.25);opacity:1}to{transform:scale(1.7);opacity:0}}
    #demo-caption{position:fixed;left:50%;bottom:48px;transform:translate(-50%,24px);max-width:1180px;padding:20px 34px;border-radius:16px;background:rgba(6,15,31,.93);border:1px solid rgba(224,148,39,.65);box-shadow:0 14px 44px rgba(0,0,0,.55);color:#f0f6fe;font:600 30px/1.35 Inter,system-ui,sans-serif;text-align:center;z-index:2147483645;opacity:0;transition:opacity .45s ease,transform .45s ease;pointer-events:none}
    #demo-caption.on{opacity:1;transform:translate(-50%,0)}
    #demo-caption b{color:#eca83e;font-weight:700}
    #demo-card{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:radial-gradient(circle at 30% 20%,#19376d 0%,#0b1f3a 45%,#060f1f 100%);z-index:2147483646;opacity:0;transition:opacity .7s ease;pointer-events:none;color:#f0f6fe;font-family:Inter,system-ui,sans-serif;text-align:center}
    #demo-card.on{opacity:1}
    #demo-card .t{font-size:92px;font-weight:800;letter-spacing:-2px}
    #demo-card .t span{color:#e09427}
    #demo-card .s{font-size:38px;font-weight:500;color:#daeaf9;max-width:1300px}
    #demo-card .b{margin-top:26px;font-size:26px;font-weight:700;letter-spacing:6px;text-transform:uppercase;color:#e09427}
    #demo-card .n{position:absolute;bottom:40px;font-size:18px;color:#6f93c4}
  \`
  // React può ricostruire il body (idratazione non combaciante per le etichette
  // neutre): gli overlay si ricreano da soli e ritrovano il loro stato.
  const S = window.__demoState || (window.__demoState = { cap: null, card: null })
  let pos = { x: 960, y: 540 }
  try { pos = JSON.parse(sessionStorage.getItem('demoCursor') || 'null') || pos } catch {}
  const place = () => { const c = document.getElementById('demo-cursor'); if (c) c.style.transform = 'translate(' + (pos.x - 3) + 'px,' + (pos.y - 2) + 'px)' }
  const ensure = () => {
    if (!document.body || !document.head) return
    if (!document.getElementById('demo-overlay-style')) { const st = document.createElement('style'); st.id = 'demo-overlay-style'; st.textContent = css; document.head.appendChild(st) }
    if (!document.getElementById('demo-cursor')) {
      const cur = document.createElement('div'); cur.id = 'demo-cursor'
      cur.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M3 2l20 11-9 2-4 9z" fill="#f0f6fe" stroke="#060f1f" stroke-width="1.6" stroke-linejoin="round"/></svg>'
      document.body.appendChild(cur); place()
    }
    if (!document.getElementById('demo-caption')) {
      const cap = document.createElement('div'); cap.id = 'demo-caption'; document.body.appendChild(cap)
      if (S.cap) { cap.innerHTML = S.cap; cap.classList.add('on') }
    }
    if (!document.getElementById('demo-card')) {
      const card = document.createElement('div'); card.id = 'demo-card'; document.body.appendChild(card)
      if (S.card) { card.innerHTML = S.card; card.classList.add('on') }
    }
  }
  const mount = () => {
    ensure()
    setInterval(ensure, 150)
    document.addEventListener('mousemove', (e) => { pos = { x: e.clientX, y: e.clientY }; place(); try { sessionStorage.setItem('demoCursor', JSON.stringify(pos)) } catch {} }, true)
    document.addEventListener('mousedown', (e) => {
      const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'
      document.body.appendChild(r); setTimeout(() => r.remove(), 700)
    }, true)
  }
  window.__demoCaption = (html) => {
    S.cap = html || null; ensure()
    const cap = document.getElementById('demo-caption')
    if (html) { cap.innerHTML = html; cap.classList.add('on') } else cap.classList.remove('on')
  }
  window.__demoCard = (c) => {
    S.card = c || null; ensure()
    const card = document.getElementById('demo-card')
    if (c) { card.innerHTML = c; card.classList.add('on') } else card.classList.remove('on')
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount)
})()`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: 'it-IT', timezoneId: 'Europe/Rome', colorScheme: 'dark' })
await ctx.addInitScript(({ css, jobId }) => {
  try {
    localStorage.setItem('theme', 'dark'); localStorage.setItem('lang', 'it'); localStorage.removeItem('accentColor')
    localStorage.setItem('rpNavSeen', '1'); localStorage.setItem('polizzaJobId', jobId)
  } catch { /* storage non disponibile */ }
  const inject = () => {
    if (document.getElementById('demo-theme')) return
    const font = document.createElement('link'); font.rel = 'stylesheet'
    font.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
    const st = document.createElement('style'); st.id = 'demo-theme'; st.textContent = css
    document.head.append(font, st); document.documentElement.setAttribute('data-theme', 'dark')
  }
  if (document.head) inject(); else document.addEventListener('DOMContentLoaded', inject)
}, { css: CSS, jobId: IDS.dossierMeridiane })
await ctx.addInitScript(RELABEL)
await ctx.addInitScript(OVERLAY)
const page = await ctx.newPage()
const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email: DEMO_USER } })
if (!login.ok()) throw new Error(`login fallito: ${login.status()}`)

// Riepilogo fatture (API reale dell'app), creato se manca.
async function ensureInvoiceSummary() {
  const NAME = 'Fatture fornitori · 2024–2026'
  const list = await (await page.request.get(`${BASE}/api/polizza/summaries`)).json()
  const found = (list.summaries || []).find((x) => x.name === NAME)
  if (found) return found.id
  const doneIn = async (id) => ((await (await page.request.get(`${BASE}/api/polizza/batch/${id}`)).json()).jobs || []).filter((j) => j.status === 'done').map((j) => j.jobId)
  const jobIds = [...await doneIn(IDS.batchArchive), ...await doneIn(IDS.batchInvoices)]
  const r = await page.request.post(`${BASE}/api/polizza/summaries`, { data: { name: NAME, jobIds, yearFieldId: 'f_data', mode: 'live' } })
  if (!r.ok()) throw new Error(`riepilogo: ${r.status()} ${await r.text()}`)
  return (await r.json()).id
}
await ensureInvoiceSummary()

// ─── Regia ─────────────────────────────────────────────────────────────────────
const wait = (ms) => page.waitForTimeout(ms)
let mouse = { x: 960, y: 540 }
async function moveTo(target, { steps = 32, dx = 0, dy = 0 } = {}) {
  const box = await target.boundingBox()
  if (!box) throw new Error('elemento non visibile')
  const x = Math.round(box.x + box.width / 2 + dx)
  const y = Math.round(box.y + box.height / 2 + dy)
  // traiettoria morbida (ease-in-out) invece del passo lineare di Playwright
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    await page.mouse.move(mouse.x + (x - mouse.x) * e, mouse.y + (y - mouse.y) * e)
    await wait(12)
  }
  mouse = { x, y }
}
async function click(target, opts) {
  await moveTo(target, opts)
  await wait(180)
  await page.mouse.down(); await wait(90); await page.mouse.up()
}
const caption = (html) => page.evaluate((h) => window.__demoCaption && window.__demoCaption(h), html)
const card = (html) => page.evaluate((h) => window.__demoCard && window.__demoCard(h), html)
async function settle(ms = 700) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {})
  await wait(ms)
}
async function smoothScroll(selector, top) {
  await page.evaluate(([sel, y]) => {
    const el = sel ? document.querySelector(sel) : null
    ;(el || window).scrollTo({ top: y, behavior: 'smooth' })
  }, [selector, top])
  await wait(1100)
}
const nav = (label) => page.locator('.sidebar .nav-item', { hasText: label }).first()

// ─── Registrazione: screencast CDP (fotogrammi JPEG con il loro istante) ──────
const cdp = await ctx.newCDPSession(page)
const frames = []
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  const file = join(FRAMES, `f${String(frames.length).padStart(6, '0')}.jpg`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  frames.push({ file, ts: metadata.timestamp })
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
})

// Prima scena caricata fuori registrazione, col cartello già sopra.
await page.goto(`${BASE}/polizza/jobs`)
await settle(900)
await card('<div class="t">PDF <span>Extractor</span></div><div class="s">Dati estratti in automatico da migliaia di PDF, con la fonte di ogni valore</div><div class="b">OmegaNodes</div>')
await wait(800)
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
const t0 = Date.now()
await wait(3200)
await card(null)
await wait(900)

// 1 · Cartella bulk
await click(nav('Cartella bulk'))
await page.waitForURL('**/polizza/bulk'); await settle(600)
await page.addStyleTag({ content: 'div[style*="max-width: 760px"]{max-width:1500px!important} td select[style*="max-width: 160px"]{min-width:230px!important;max-width:260px!important}' })
await caption('<b>1.</b> Scegli una cartella: ogni sottocartella diventa una pratica')
await moveTo(page.getByRole('button', { name: /Seleziona cartella/ }).first())
await wait(900)
// Il click vero aprirebbe il selettore di sistema: solo l'onda visiva, poi la
// cartella arriva da setInputFiles (stesso percorso del selettore classico).
await page.evaluate(({ x, y }) => {
  const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'
  document.body.appendChild(r); setTimeout(() => r.remove(), 700)
}, mouse)
await wait(400)
await page.locator('input[type=file][webkitdirectory]').setInputFiles(join(here, 'bulk', 'Archivio_Documenti_2026'))
await settle(900)
await page.evaluate(() => {
  const el = [...document.querySelectorAll('div,span,h2,h3')].find((e) => e.textContent.trim().startsWith('Cartella: Archivio_Documenti_2026'))
  if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 120, behavior: 'smooth' })
})
await wait(1300)
await caption('Riconosce il tipo di documento di ogni pratica e scarta le cartelle da ignorare')
const selects = page.locator('td select')
for (const i of [0, 1, 3]) { await moveTo(selects.nth(i), { steps: 26 }); await wait(650) }
await moveTo(page.getByRole('button', { name: /Avvia elaborazione bulk/ }).first())
await wait(1600)
await caption(null)

// 2 · Elaborazioni
await smoothScroll(null, 0)
await click(nav('Elaborazioni'))
await page.waitForURL('**/polizza/jobs'); await settle(700)
await caption('<b>2.</b> Il batch lavora sul server, anche a browser chiuso')
await moveTo(page.locator('.jb-card', { hasText: 'Contratti fornitori' }).first(), { dy: -40 })
await wait(1500)
await moveTo(page.locator('.jb-card', { hasText: 'Cedolini' }).first(), { dy: -40 })
await wait(1100)
await caption('Se un documento richiede una decisione, il batch lo segnala')
await click(page.locator('a,button', { hasText: 'Apri il batch' }).first())
await page.waitForURL('**/polizza/jobs/**'); await settle(800)

// 3 · Dettaglio batch
await caption('<b>3.</b> Per ogni pratica: stato, profilo e campi estratti')
await moveTo(page.locator('.jb-kpi', { hasText: 'Estratte' }).first())
await wait(1300)
await click(page.locator('.jb-table tbody tr', { hasText: 'Officine Meridiane' }).first().locator('.jb-name').first())
await wait(900)
await click(page.locator('.jb-tab', { hasText: 'Valori' }).first())
await wait(500)
await caption('Ogni valore ha la sua fonte: file e pagina del documento')
await moveTo(page.locator('.jb-detail').getByText('Totale documento').first(), { dx: 120 })
await wait(1500)
await smoothScroll('.jb-detail .jb-tabs + div', 360)
await wait(900)

// 4 · Documento fuori posto
await click(page.locator('.jb-table tbody tr', { hasText: 'Documenti vari' }).first().locator('.jb-name').first())
await wait(800)
await caption('Un documento fuori posto si ferma, con il profilo giusto già suggerito')
await moveTo(page.locator('.jb-detail').getByText('Curriculum candidati').first())
await wait(2200)

// 5 · Pratica multi-documento
await caption(null)
await click(nav('Pratiche'))
await page.waitForURL('**/polizza'); await settle(1200)
await caption('<b>4.</b> Più documenti nella stessa pratica: vince il dato più recente')
await moveTo(page.locator('.polizza-file-item').nth(1))
await wait(1000)
await moveTo(page.locator('.polizza-table tr', { hasText: 'Scadenza contratto' }).first(), { dx: 200 })
await wait(1800)
await smoothScroll('.polizza-results', 520)
await moveTo(page.locator('.polizza-table tr', { hasText: 'Esito ultimo audit' }).first(), { dx: 200 })
await wait(1600)

// 6 · Riepiloghi
await caption(null)
await click(nav('Riepiloghi'))
await page.waitForURL('**/polizza/riepiloghi'); await settle(700)
await caption('<b>5.</b> Anni di documenti riassunti in un cruscotto, pronto per Excel')
await click(page.locator('a,button', { hasText: 'Apri' }).first())
await page.waitForURL('**/polizza/riepiloghi/**'); await settle(1300)
const bars = page.locator('svg rect.rp-col, svg rect')
await moveTo(page.getByText('Imponibile per anno').first(), { dy: 160 })
await wait(1800)
await moveTo(page.getByText('In scadenza nei prossimi 90 giorni').first(), { dy: 60 })
await wait(1500)
await moveTo(page.locator('a,button', { hasText: 'Esporta Excel' }).first())
await wait(1500)
await caption(null)
void bars

// Cartello finale
await card('<div class="t">PDF <span>Extractor</span></div><div class="s">Migliaia di PDF in batch · ogni dato con la sua fonte · riepiloghi ed export Excel</div><div class="b">OmegaNodes</div><div class="n">Demo con dati di esempio</div>')
await wait(4200)
const tEnd = Date.now()
await cdp.send('Page.stopScreencast')
await browser.close()

// ─── Montaggio: durate dai timestamp dei fotogrammi, poi H.264 a 30 fps ───────
if (frames.length < 2) throw new Error('nessun fotogramma registrato')
const lastTs = frames[0].ts + (tEnd - t0) / 1000
let list = ''
for (let i = 0; i < frames.length; i++) {
  const next = i + 1 < frames.length ? frames[i + 1].ts : lastTs
  const d = Math.max(0.001, next - frames[i].ts)
  list += `file '${frames[i].file}'\nduration ${d.toFixed(4)}\n`
}
list += `file '${frames[frames.length - 1].file}'\n`
const listFile = join(OUT_DIR, 'frames.txt')
writeFileSync(listFile, list)
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
  '-vf', `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
  '-movflags', '+faststart', OUT], { stdio: 'inherit' })
console.log(`Video: ${OUT} · ${frames.length} fotogrammi · ${((tEnd - t0) / 1000).toFixed(1)} s`)
