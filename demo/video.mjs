// Video DEMO del funzionamento (dati inventati, palette OmegaNodes, etichette
// neutre): percorsi guidati nell'app vera con cursore visibile e didascalie,
// registrati a 1920×1080 col screencast di Chromium e codificati in MP4 (H.264).
// Prerequisiti come capture.mjs: app su DEMO_URL con il DB demo popolato da
// seed.mjs (stessa DEMO_LANG); serve ffmpeg nel PATH.
//   node demo/video.mjs                    → tutti i filmati, in italiano
//   node demo/video.mjs overview trust     → solo alcuni
//   DEMO_LANG=en DEMO_URL=http://localhost:3101 node demo/video.mjs   → in inglese
// Filmati: overview (panoramica), bulk (batch su un archivio), profiles (ogni
// tipo di documento), trust (fonti, controlli, storico), dashboards (riepiloghi
// ed Excel). Escono in demo/video/pdf-extractor-<filmato>[-en].mp4.
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LANG, SUFFIX, data } from './lang.mjs'

const {
  DEMO_USER, FILES, INVOICES, MISMATCH, BATCHES, SINGLES, LEASE_ERROR, SUMMARY_NAMES, BULK_ROOT, profileById, SUPPLY_CONTRACTS,
} = data

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '..', 'web', 'package.json'))
const { chromium } = require('playwright')

const BASE = process.env.DEMO_URL || 'http://localhost:3100'
const OUT_DIR = join(here, 'video')
const CSS = readFileSync(join(here, 'theme-omeganodes.css'), 'utf8')
const RELABEL = readFileSync(join(here, 'relabel.js'), 'utf8')
const IDS = JSON.parse(readFileSync(join(here, `.seed-ids${SUFFIX}.json`), 'utf8'))
// Fotogrammi 1920×1080, interfaccia al 120% (viewport CSS 1600×900): più leggibile anche da telefono.
const W = 1920
const H = 1080
const SCALE = 1.2
// Testo nella lingua del filmato.
const t = (it, en) => (LANG === 'en' ? en : it)
const label = (profileId, fieldId) => profileById[profileId].fields.find((f) => f.id === fieldId).label

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
    #demo-caption.top{bottom:auto;top:40px;transform:translate(-50%,-24px)}
    #demo-caption.top.on{transform:translate(-50%,0)}
    #demo-caption b{color:#eca83e;font-weight:700}
    #demo-card{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;background:radial-gradient(circle at 30% 20%,#19376d 0%,#0b1f3a 45%,#060f1f 100%);z-index:2147483646;opacity:0;transition:opacity .7s ease;pointer-events:none;color:#f0f6fe;font-family:Inter,system-ui,sans-serif;text-align:center}
    #demo-card.on{opacity:1}
    #demo-card .k{font-size:26px;font-weight:700;letter-spacing:6px;text-transform:uppercase;color:#9fb6d8}
    #demo-card .t{font-size:92px;font-weight:800;letter-spacing:-2px}
    #demo-card .t span{color:#e09427}
    #demo-card .s{font-size:38px;font-weight:500;color:#daeaf9;max-width:1300px}
    #demo-card .b{margin-top:26px;font-size:26px;font-weight:700;letter-spacing:6px;text-transform:uppercase;color:#e09427}
    #demo-card .n{position:absolute;bottom:40px;font-size:18px;color:#6f93c4}
  \`
  // React può ricostruire il body (idratazione non combaciante per le etichette
  // neutre): gli overlay si ricreano da soli e ritrovano il loro stato.
  const S = window.__demoState || (window.__demoState = { cap: null, top: false, card: null })
  let pos = { x: 800, y: 450 }
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
      cap.classList.toggle('top', S.top)
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
  window.__demoCaption = (html, top) => {
    S.cap = html || null; ensure()
    const cap = document.getElementById('demo-caption')
    if (html) { S.top = !!top; cap.classList.toggle('top', S.top); cap.innerHTML = html; cap.classList.add('on') } else cap.classList.remove('on')
  }
  window.__demoCard = (c) => {
    S.card = c || null; ensure()
    const card = document.getElementById('demo-card')
    if (c) { card.innerHTML = c; card.classList.add('on') } else card.classList.remove('on')
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount)
})()`

// Cartello a tutto schermo: titolo (con <span> in oro), sottotitolo, marchio.
const cardHtml = ({ kicker = '', title = 'PDF <span>Extractor</span>', sub, note = '' }) =>
  (kicker ? `<div class="k">${kicker}</div>` : '') + `<div class="t">${title}</div><div class="s">${sub}</div><div class="b">OmegaNodes</div>` +
  (note ? `<div class="n">${note}</div>` : '')

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })

// ─── Un filmato: contesto pulito, regia, registrazione, montaggio ─────────────
async function film(name, script) {
  const ctx = await browser.newContext({
    viewport: { width: W / SCALE, height: H / SCALE }, deviceScaleFactor: SCALE, colorScheme: 'dark',
    locale: t('it-IT', 'en-IE'), timezoneId: t('Europe/Rome', 'Europe/Dublin'),
  })
  await ctx.addInitScript(({ css, jobId, lang }) => {
    try {
      localStorage.setItem('theme', 'dark'); localStorage.setItem('lang', lang); localStorage.removeItem('accentColor')
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
  }, { css: CSS, jobId: IDS.dossierMeridiane, lang: LANG })
  await ctx.addInitScript(RELABEL)
  await ctx.addInitScript(OVERLAY)
  const page = await ctx.newPage()
  const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email: DEMO_USER } })
  if (!login.ok()) throw new Error(`login fallito: ${login.status()}`)

  // Regia
  const wait = (ms) => page.waitForTimeout(ms)
  let mouse = { x: 800, y: 450 }
  async function moveTo(target, { steps = 32, dx = 0, dy = 0 } = {}) {
    await target.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {})
    const box = await target.boundingBox()
    if (!box) throw new Error('elemento non visibile')
    const x = Math.round(box.x + box.width / 2 + dx)
    const y = Math.round(box.y + box.height / 2 + dy)
    // traiettoria morbida (ease-in-out) invece del passo lineare di Playwright
    for (let i = 1; i <= steps; i++) {
      const k = i / steps
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2
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
  // Solo l'onda visiva, senza click vero (es. il selettore di cartelle di sistema).
  const ripple = () => page.evaluate(({ x, y }) => {
    const r = document.createElement('div'); r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px'
    document.body.appendChild(r); setTimeout(() => r.remove(), 700)
  }, mouse)
  // Didascalia in basso; { top: true } la sposta in alto quando sotto c'è da vedere.
  const caption = (html, { top = false } = {}) => page.evaluate(([h, tp]) => window.__demoCaption && window.__demoCaption(h, tp), [html, top])
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
  // Porta in vista (scorrendo la finestra) il primo elemento che inizia con il testo.
  async function scrollToText(text, offset = 120) {
    await page.evaluate(({ text, offset }) => {
      const el = [...document.querySelectorAll('div,span,h2,h3,button,label,p')].find((e) => e.textContent.trim().startsWith(text) && e.children.length < 4)
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' })
    }, { text, offset })
    await wait(1200)
  }
  const nav = (text) => page.locator('.sidebar .nav-item', { hasText: text }).first()
  const row = (text) => page.locator('.jb-table tbody tr', { hasText: text }).first()
  const rowName = (text) => row(text).locator('.jb-name').first()
  const tab = (text) => page.locator('.jb-tab', { hasText: text }).first()
  const button = (text) => page.locator('a,button', { hasText: text }).first()
  const jobCard = (text) => page.locator('.jb-card', { hasText: text }).first()
  // Campo di testo con quel valore (gli input controllati non lo espongono come attributo).
  async function inputWithValue(value, sel = 'input,textarea') {
    const i = await page.$$eval(sel, (els, v) => els.findIndex((e) => e.value === v), value)
    if (i < 0) throw new Error(`nessun campo con valore «${value}»`)
    return page.locator(sel).nth(i)
  }

  // Registrazione: screencast CDP (fotogrammi JPEG con il loro istante)
  const framesDir = join(OUT_DIR, `frames-${name}${SUFFIX}`)
  rmSync(framesDir, { recursive: true, force: true })
  mkdirSync(framesDir, { recursive: true })
  const cdp = await ctx.newCDPSession(page)
  const frames = []
  cdp.on('Page.screencastFrame', async ({ data: jpg, metadata, sessionId }) => {
    const file = join(framesDir, `f${String(frames.length).padStart(6, '0')}.jpg`)
    writeFileSync(file, Buffer.from(jpg, 'base64'))
    frames.push({ file, ts: metadata.timestamp })
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  let t0 = 0
  // La prima scena si prepara fuori registrazione, col cartello già sopra.
  async function start(intro) {
    await card(cardHtml(intro))
    await wait(800)
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 })
    t0 = Date.now()
    await wait(3200)
    if (frames.length) console.log(`allineamento screencast/orologio: ${(frames[0].ts - t0 / 1000).toFixed(2)} s`)
    await card(null)
    await wait(900)
  }
  // Il visore PDF di Chromium non passa dallo screencast: lì si registra a screenshot.
  async function holdScreenshots(ms) {
    const end = Date.now() + ms
    while (Date.now() < end) {
      const file = join(framesDir, `s${String(frames.length).padStart(6, '0')}.jpg`)
      writeFileSync(file, await page.screenshot({ type: 'jpeg', quality: 90, scale: 'css' }))
      frames.push({ file, ts: Date.now() / 1000 })
    }
  }
  async function outro(sub) {
    await caption(null)
    await card(cardHtml({ sub, note: t('Demo con dati di esempio', 'Demo with sample data') }))
    await wait(4200)
  }

  await script({ page, wait, moveTo, click, ripple, caption, card, settle, smoothScroll, scrollToText, nav, row, rowName, tab, button, jobCard, inputWithValue, start, holdScreenshots, outro })
  const tEnd = Date.now()
  await cdp.send('Page.stopScreencast')
  await ctx.close()

  // Montaggio: durate dai timestamp dei fotogrammi, poi H.264 a 30 fps
  if (frames.length < 2) throw new Error('nessun fotogramma registrato')
  frames.sort((a, b) => a.ts - b.ts)
  const lastTs = frames[0].ts + (tEnd - t0) / 1000
  let list = ''
  for (let i = 0; i < frames.length; i++) {
    const next = i + 1 < frames.length ? frames[i + 1].ts : lastTs
    list += `file '${frames[i].file}'\nduration ${Math.max(0.001, next - frames[i].ts).toFixed(4)}\n`
  }
  list += `file '${frames[frames.length - 1].file}'\n`
  const listFile = join(framesDir, 'frames.txt')
  writeFileSync(listFile, list)
  const out = join(OUT_DIR, `pdf-extractor-${name}${SUFFIX}.mp4`)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', `fps=30,scale=${W}:${H}:flags=lanczos,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '18',
    '-movflags', '+faststart', out], { stdio: 'inherit' })
  if (!process.env.KEEP_FRAMES) rmSync(framesDir, { recursive: true, force: true })
  console.log(`Video: ${out} · ${frames.length} fotogrammi · ${((tEnd - t0) / 1000).toFixed(1)} s`)
}

// ─── API reale dell'app: riepiloghi e pulizia tra un filmato e l'altro ────────
async function api(method, path, body) {
  const ctx = await browser.newContext()
  try {
    const login = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email: DEMO_USER } })
    if (!login.ok()) throw new Error(`login fallito: ${login.status()}`)
    const r = await ctx.request.fetch(`${BASE}${path}`, { method, data: body })
    if (!r.ok()) throw new Error(`${method} ${path}: ${r.status()} ${await r.text()}`)
    return r.headers()['content-type']?.includes('json') ? r.json() : null
  } finally { await ctx.close() }
}
const summaries = async () => (await api('GET', '/api/polizza/summaries')).summaries || []
const doneIn = async (batchId) => ((await api('GET', `/api/polizza/batch/${batchId}`)).jobs || []).filter((j) => j.status === 'done').map((j) => j.jobId)

// Riepilogo fatture della panoramica, creato se manca.
async function ensureInvoiceSummary() {
  if ((await summaries()).some((x) => x.name === SUMMARY_NAMES.invoices)) return
  const jobIds = [...await doneIn(IDS.batchArchive), ...await doneIn(IDS.batchInvoices)]
  await api('POST', '/api/polizza/summaries', { name: SUMMARY_NAMES.invoices, jobIds, yearFieldId: 'f_data', mode: 'live' })
}

// ─── Filmati ───────────────────────────────────────────────────────────────────
const SPEND = t('Spesa fornitori 2024–2026', 'Supplier spend 2024–2026')

const FILMS = {
  // Panoramica: dalla cartella al riepilogo.
  overview: async (d) => {
    const { page, wait, moveTo, click, ripple, caption, settle, smoothScroll, nav, rowName, tab, button, jobCard } = d
    await ensureInvoiceSummary()
    await page.goto(`${BASE}/polizza/jobs`)
    await settle(900)
    await d.start({ sub: t('Dati estratti in automatico da migliaia di PDF, con la fonte di ogni valore', 'Data pulled automatically from thousands of PDFs — with the source of every value') })

    // 1 · Cartella bulk
    await click(nav(t('Cartella bulk', 'Bulk folder')))
    await page.waitForURL('**/polizza/bulk'); await settle(600)
    await page.addStyleTag({ content: 'div[style*="max-width: 760px"]{max-width:1500px!important} td select[style*="max-width: 160px"]{min-width:230px!important;max-width:260px!important}' })
    await caption(t('<b>1.</b> Scegli una cartella: ogni sottocartella diventa una pratica', '<b>1.</b> Pick a folder: every subfolder becomes a dossier'))
    await moveTo(page.getByRole('button', { name: t(/Seleziona cartella/, /Select folder/) }).first())
    await wait(900)
    // Il click vero aprirebbe il selettore di sistema: solo l'onda visiva, poi la
    // cartella arriva da setInputFiles (stesso percorso del selettore classico).
    await ripple()
    await wait(400)
    await page.locator('input[type=file][webkitdirectory]').setInputFiles(join(here, 'bulk' + SUFFIX, BULK_ROOT))
    await settle(900)
    await d.scrollToText(t('Cartella: ', 'Folder: ') + BULK_ROOT)
    await caption(t('Riconosce il tipo di documento di ogni pratica e scarta le cartelle da ignorare', 'It recognises each dossier’s document type and skips the folders to ignore'), { top: true })
    const selects = page.locator('td select')
    for (const i of [0, 1, 3]) { await moveTo(selects.nth(i), { steps: 26 }); await wait(650) }
    await moveTo(page.getByRole('button', { name: t(/Avvia elaborazione bulk/, /Start bulk processing/) }).first())
    await wait(1600)
    await caption(null)

    // 2 · Elaborazioni
    await smoothScroll(null, 0)
    await click(nav(t('Elaborazioni', 'Jobs')))
    await page.waitForURL('**/polizza/jobs'); await page.locator('.jb-card').first().waitFor(); await settle(700)
    await caption(t('<b>2.</b> Il batch lavora sul server, anche a browser chiuso', '<b>2.</b> The batch runs on the server, even with the browser closed'))
    await moveTo(jobCard(BATCHES.contracts), { dy: -40 })
    await wait(1500)
    await moveTo(jobCard(BATCHES.payslips), { dy: -40 })
    await wait(1100)
    await caption(t('Se un documento richiede una decisione, il batch lo segnala', 'When a document needs a decision, the batch flags it'))
    await click(button(t('Apri il batch', 'Open batch')))
    await page.waitForURL('**/polizza/jobs/**'); await page.locator('.jb-table tbody tr').first().waitFor(); await settle(800)

    // 3 · Dettaglio batch
    await caption(t('<b>3.</b> Per ogni pratica: stato, profilo e campi estratti', '<b>3.</b> For every dossier: status, profile and extracted fields'))
    await moveTo(page.locator('.jb-kpi', { hasText: t('Estratte', 'Extracted') }).first())
    await wait(1300)
    await click(rowName(INVOICES[0].dossier))
    await wait(900)
    await click(tab(t('Valori', 'Values')))
    await wait(500)
    await caption(t('Ogni valore ha la sua fonte: file e pagina del documento', 'Every value has its source: file and page of the document'))
    await moveTo(page.locator('.jb-detail').getByText(label('prof_fatture', 'f_tot')).first(), { dx: 120 })
    await wait(1500)
    await smoothScroll('.jb-detail .jb-tabs + div', 360)
    await wait(900)

    // 4 · Documento fuori posto
    await click(rowName(MISMATCH.dossier))
    await wait(800)
    await caption(t('Un documento fuori posto si ferma, con il profilo giusto già suggerito', 'A misplaced document stops, with the right profile already suggested'))
    await moveTo(page.locator('.jb-detail').getByText(MISMATCH.precheck.suggestion.name).first())
    await wait(2200)

    // 5 · Pratica multi-documento
    await caption(null)
    await click(nav(t('Pratiche', 'Dossiers')))
    await page.waitForURL('**/polizza'); await settle(1200)
    await caption(t('<b>4.</b> Più documenti nella stessa pratica: vince il dato più recente', '<b>4.</b> Many documents in one dossier: the most recent value wins'))
    await moveTo(page.locator('.polizza-file-item').nth(1))
    await wait(1000)
    await moveTo(page.locator('.polizza-table tr', { hasText: label('prof_fornitura', 'c_scad') }).first(), { dx: 200 })
    await wait(1800)
    await smoothScroll('.polizza-results', 520)
    await moveTo(page.locator('.polizza-table tr', { hasText: label('prof_fornitura', 'c_audit') }).first(), { dx: 200 })
    await wait(1600)

    // 6 · Riepiloghi
    await caption(null)
    await click(nav(t('Riepiloghi', 'Summaries')))
    await page.waitForURL('**/polizza/riepiloghi'); await settle(700)
    await caption(t('<b>5.</b> Anni di documenti riassunti in un cruscotto, pronto per Excel', '<b>5.</b> Years of documents in one dashboard, ready for Excel'))
    await click(jobCard(SUMMARY_NAMES.invoices).locator('a.jb-btn').first())
    await page.waitForURL('**/polizza/riepiloghi/**'); await settle(1300)
    await moveTo(page.locator('.rp-card', { has: page.locator('svg') }).first(), { dy: 40 })
    await wait(1800)
    await moveTo(page.getByText(t('In scadenza nei prossimi 90 giorni', 'Expiring in the next 90 days')).first(), { dy: 60 })
    await wait(1500)
    await moveTo(button(t('Esporta Excel', 'Export Excel')))
    await wait(1500)
    await d.outro(t('Migliaia di PDF in batch · ogni dato con la sua fonte · riepiloghi ed export Excel', 'Thousands of PDFs in batch · every value with its source · dashboards and Excel export'))
  },

  // Batch su un intero archivio: filtri, profili per cartella, stato, export.
  bulk: async (d) => {
    const { page, wait, moveTo, click, ripple, caption, settle, nav, row, button, jobCard } = d
    await page.goto(`${BASE}/polizza/bulk`)
    await settle(900)
    await page.addStyleTag({ content: 'div[style*="max-width: 760px"]{max-width:1500px!important} td select[style*="max-width: 160px"]{min-width:230px!important;max-width:260px!important}' })
    await d.start({ kicker: 'PDF Extractor', title: t('Elaborazione <span>in batch</span>', 'Batch <span>processing</span>'), sub: t('Un intero archivio di documenti, in un solo passaggio', 'A whole document archive, in one pass') })

    await caption(t('Indica una cartella: anche una share di rete con migliaia di PDF', 'Point it at a folder — even a network share with thousands of PDFs'))
    await moveTo(page.getByRole('button', { name: t(/Seleziona cartella/, /Select folder/) }).first())
    await wait(1000)
    await ripple()
    await wait(400)
    await page.locator('input[type=file][webkitdirectory]').setInputFiles(join(here, 'bulk' + SUFFIX, BULK_ROOT))
    await settle(1000)
    await caption(t('Bozze e documenti annullati restano fuori, con regole che decidi tu', 'Drafts and cancelled documents stay out — by rules you set'))
    await moveTo(await d.inputWithValue(data.SETTINGS_TEXT.bulkExcludeKeywords, 'input'))
    await wait(1200)
    const skipped = page.getByRole('button', { name: t(/Mostra i \d+ PDF scartati/, /Show the \d+ skipped PDFs/) }).first()
    await click(skipped)
    await wait(700)
    await d.scrollToText(t('Nascondi i PDF scartati', 'Hide skipped PDFs'), 160)
    await moveTo(page.getByText(new RegExp(t('Annullate', 'Cancelled') + '/')).first(), { dx: 120 })
    await wait(1600)
    await d.scrollToText(t('Cartella: ', 'Folder: ') + BULK_ROOT)
    await caption(t('Ogni sottocartella diventa una pratica, con il suo profilo documento', 'Each subfolder becomes a dossier, with its own document profile'), { top: true })
    await moveTo(page.getByText(new RegExp(t('Trovate? \\d+', 'Found \\d+'))).first())
    await wait(900)
    const selects = page.locator('td select')
    for (const i of [0, 1, 2, 3]) { await moveTo(selects.nth(i), { steps: 24 }); await wait(550) }
    await caption(t('Un clic e parte: il server lavora le pratiche una dopo l’altra', 'One click to start — the server works through the dossiers one by one'), { top: true })
    await moveTo(page.getByRole('button', { name: t(/Avvia elaborazione bulk/, /Start bulk processing/) }).first())
    await wait(1700)

    await caption(null)
    await d.smoothScroll(null, 0)
    await click(nav(t('Elaborazioni', 'Jobs')))
    await page.waitForURL('**/polizza/jobs'); await page.locator('.jb-card').first().waitFor(); await settle(700)
    await caption(t('Lo stato di ogni batch, anche a browser chiuso', 'Every batch’s progress — even with the browser closed'))
    const contracts = jobCard(BATCHES.contracts)
    await moveTo(contracts, { dy: -20 })
    await wait(1400)
    await click(contracts.locator('a,button', { hasText: t('Apri', 'Open') }).last())
    await page.waitForURL('**/polizza/jobs/**'); await page.locator('.jb-table tbody tr').first().waitFor(); await settle(800)
    await caption(t('Pratica per pratica: estratte, in corso, in coda', 'Dossier by dossier: extracted, running, queued'))
    await moveTo(row(SUPPLY_CONTRACTS[0].dossier), { dx: 40 })
    await wait(900)
    await moveTo(row(SUPPLY_CONTRACTS[3].dossier), { dx: 40 })
    await wait(1500)
    await moveTo(row(SUPPLY_CONTRACTS[4].dossier), { dx: 40 })
    await wait(1000)
    await caption(t('Esporta tutto il batch in Excel o ZIP, con un clic', 'Export the whole batch to Excel or ZIP in one click'))
    await click(button(t('Esporta', 'Export')))
    await wait(1900)
    await page.keyboard.press('Escape')
    await wait(400)

    await caption(null)
    await click(page.locator('a', { hasText: t('Elaborazioni', 'Jobs') }).filter({ hasNot: page.locator('svg') }).first())
    await page.waitForURL('**/polizza/jobs'); await page.locator('.jb-card').first().waitFor(); await settle(700)
    await click(button(t('Apri il batch', 'Open batch')))
    await page.waitForURL('**/polizza/jobs/**'); await page.locator('.jb-table tbody tr').first().waitFor(); await settle(800)
    await click(button(t('Schema cartelle', 'Folder map')))
    await wait(500)
    await caption(t('La mappa delle cartelle mostra come è stato esplorato l’archivio', 'The folder map shows how the archive was explored'))
    await wait(2600)
    await page.keyboard.press('Escape')
    await wait(500)
    await click(button(t('Coda', 'Queue')))
    await wait(700)
    await caption(t('Vista Coda: si decide una pratica alla volta, anche da tastiera', 'Queue view: decide one dossier at a time — keyboard included'))
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowDown'); await wait(900) }
    await moveTo(button(t('Successiva', 'Next')))
    await wait(2200)
    await d.outro(t('Migliaia di PDF · una cartella · un clic', 'Thousands of PDFs · one folder · one click'))
  },

  // Ogni tipo di documento: profili, descrizioni dei campi, stesso motore.
  profiles: async (d) => {
    const { page, wait, moveTo, click, caption, settle, nav } = d
    const profileRow = (name) => page.locator('div', { has: page.locator(`span:text-is("${name}")`) }).filter({ has: page.getByRole('button', { name: t('Applica', 'Apply') }) }).last()
    const payslips = profileById.prof_cedolini
    await page.goto(`${BASE}/settings`)
    await settle(900)
    await d.scrollToText(t('Profili documento (JSON)', 'Document profiles (JSON)'), 90)
    await d.start({ kicker: 'PDF Extractor', title: t('Ogni <span>documento</span>', 'Any <span>document</span>'), sub: t('Descrivi i campi una volta: al resto pensa l’AI', 'Describe the fields once — the AI does the rest') })

    await caption(t('Un profilo per ogni tipo di documento: fatture, contratti, cedolini, CV…', 'One profile per document type: invoices, contracts, leases, payslips, CVs…'))
    for (const id of ['prof_fatture', 'prof_fornitura', 'prof_locazione', 'prof_cedolini', 'prof_cv']) {
      await moveTo(page.locator(`span:text-is("${profileById[id].name}")`).first(), { steps: 22 })
      await wait(500)
    }
    await click(profileRow(payslips.name).getByRole('button', { name: t('Applica', 'Apply') }))
    await wait(900)
    await d.scrollToText(t('Profilo attuale:', 'Current profile:'), 60)
    await caption(t('Ogni campo ha una descrizione in parole semplici che guida l’AI', 'Every field has a plain-language description that guides the AI'))
    for (const fid of ['p_netto', 'p_tfr', 'p_ferie']) {
      const f = payslips.fields.find((x) => x.id === fid)
      await moveTo(await d.inputWithValue(f.description, 'input'), { dx: -200 })
      await wait(1100)
    }
    await caption(t('Parole chiave delle cartelle e una definizione «come riconoscerlo» scelgono il profilo giusto', 'Folder keywords and a “how to recognise it” definition pick the right profile'))
    await d.scrollToText(t('Profili documento (JSON)', 'Document profiles (JSON)'), 90)
    await moveTo(await d.inputWithValue(payslips.matchKeywords, 'input'))
    await wait(1100)
    await moveTo(await d.inputWithValue(payslips.recognition, 'textarea'), { dx: -300 })
    await wait(1600)

    await caption(null)
    await d.smoothScroll(null, 0)
    await click(nav(t('Cronologia', 'History')))
    await page.waitForURL('**/history'); await settle(700)
    await caption(t('Lo stesso motore legge i cedolini…', 'The same engine reads payslips…'))
    await click(page.locator('.card', { hasText: FILES.cedolino }).first().getByRole('button', { name: t('Apri', 'Open') }))
    await page.waitForURL('**/extractor'); await settle(1600)
    await moveTo(page.locator('.ext-canvas img').first(), { dy: 40 })
    await wait(1100)
    await moveTo(page.getByText(label('prof_cedolini', 'p_netto'), { exact: true }).last(), { dx: 160 })
    await wait(1500)
    await caption(t('…i contratti di locazione, e risponde a domande sul testo', '…leases too — and answers questions about the text'))
    await click(nav(t('Cronologia', 'History')))
    await page.waitForURL('**/history'); await settle(700)
    await click(page.locator('.card', { hasText: FILES.locazione }).first().getByRole('button', { name: t('Apri', 'Open') }))
    await page.waitForURL('**/extractor'); await settle(1400)
    await click(page.getByRole('button', { name: 'Chat' }).first())
    await settle(900)
    await moveTo(page.locator('text=/6 mesi|6 months/').first(), { dx: 80 }).catch(() => {})
    await wait(1800)
    await moveTo(page.locator('text=/2\.350,00|2,350\.00/').first(), { dx: 80 }).catch(() => {})
    await wait(2200)
    await d.outro(t('Un motore · ogni documento · i tuoi campi', 'One engine · any document · your fields'))
  },

  // Tracciabilità: pertinenza, fonte di ogni valore, storico delle run, errori.
  trust: async (d) => {
    const { page, wait, moveTo, click, caption, settle, nav, rowName, tab, jobCard } = d
    await page.goto(`${BASE}/polizza/jobs/${IDS.batchInvoices}`)
    await settle(900)
    await d.start({ kicker: 'PDF Extractor', title: t('Tracciabile <span>per scelta</span>', 'Traceable <span>by design</span>'), sub: t('Ogni valore con la sua fonte, ogni elaborazione registrata', 'Every value comes with its source — every run is on record') })

    await click(rowName(INVOICES[0].dossier))
    await wait(700)
    await click(tab(t('Pertinenza', 'Relevance')))
    await wait(400)
    await caption(t('Prima di estrarre verifica che il documento corrisponda al profilo', 'Before extracting, it checks the document really matches the profile'))
    await moveTo(page.locator('.jb-detail').getByText(t('fattura', 'invoice'), { exact: true }).first())
    await wait(1800)
    await click(tab(t('Valori', 'Values')))
    await wait(500)
    await caption(t('Ogni valore porta al suo file e alla sua pagina', 'Every value links back to its file and page'))
    const totRow = page.locator('.jb-detail tr', { hasText: label('prof_fatture', 'f_tot') }).first()
    const src = totRow.locator('td.src a').first()
    await moveTo(src)
    await wait(1200)
    // Il link apre il PDF in una nuova scheda: qui lo si segue nella stessa, per vederlo.
    await caption(null)
    await page.mouse.down(); await wait(90); await page.mouse.up()
    await page.goto(new URL(await src.getAttribute('href'), BASE).href)
    await wait(600)
    await caption(t('Il PDF originale, alla pagina citata', 'The original PDF, opened at the cited page'), { top: true })
    await d.holdScreenshots(3600)
    await page.goto(`${BASE}/polizza/jobs/${IDS.batchInvoices}`)
    await page.locator('.jb-table tbody tr').first().waitFor(); await settle(900)

    await click(rowName(MISMATCH.dossier))
    await wait(800)
    await caption(t('Se non corrisponde si ferma e suggerisce il profilo giusto: decidi tu', 'If it doesn’t match, it stops and suggests the right profile — you decide'))
    await moveTo(page.locator('.jb-detail').getByText(MISMATCH.precheck.suggestion.name).first())
    await wait(1400)
    await moveTo(page.locator('.jb-detail').locator('button', { hasText: t('Procedi comunque', 'Proceed anyway') }).first())
    await wait(1500)

    await caption(null)
    await click(nav(t('Elaborazioni', 'Jobs')))
    await page.waitForURL('**/polizza/jobs'); await page.locator('.jb-card').first().waitFor(); await settle(700)
    await click(jobCard(t('Estrazioni singole', 'Single extractions')).locator('a,button', { hasText: t('Apri', 'Open') }).last())
    await page.waitForURL('**/polizza/jobs/**'); await page.locator('.jb-table tbody tr').first().waitFor(); await settle(800)
    await click(rowName(SINGLES.meridiane.dossier))
    await wait(700)
    await click(tab(t('Storico', 'History')))
    await wait(500)
    await page.locator('.jb-detail details summary').first().click().catch(() => {})
    await wait(500)
    await caption(t('Ogni elaborazione resta registrata: cosa è cambiato e perché', 'Every run is on record: what changed, and why'))
    await moveTo(page.locator('.jb-detail tr', { hasText: label('prof_fornitura', 'c_scad') }).first(), { dx: 60 })
    await wait(1600)
    await moveTo(page.locator('.jb-detail tr', { hasText: label('prof_fornitura', 'c_val') }).first(), { dx: 60 })
    await wait(1300)
    await click(tab('Log'))
    await wait(500)
    await caption(t('E una diagnostica completa per ogni pratica', 'Plus full diagnostics for every dossier'))
    await moveTo(page.locator('.jb-detail pre, .jb-detail code').first().or(page.locator('.jb-detail').getByText(/Strateg/).first()), { dy: -30 })
    await wait(1800)

    await caption(null)
    await click(nav(t('Elaborazioni', 'Jobs')))
    await page.waitForURL('**/polizza/jobs'); await page.locator('.jb-card').first().waitFor(); await settle(700)
    await click(jobCard(BATCHES.leases).locator('a,button', { hasText: t('Apri', 'Open') }).last())
    await page.waitForURL('**/polizza/jobs/**'); await page.locator('.jb-table tbody tr').first().waitFor(); await settle(800)
    await click(rowName(LEASE_ERROR.dossier))
    await wait(800)
    await caption(t('Una scansione illeggibile viene segnalata, non indovinata: meglio vuoto che sbagliato', 'An unreadable scan is flagged, not guessed: better empty than wrong'))
    await moveTo(page.locator('.jb-detail').getByText(/OCR:/).or(page.locator('.jb-table').getByText(/OCR:/)).first())
    await wait(2400)
    await d.outro(t('Ogni valore tracciabile · ogni elaborazione registrata · meglio vuoto che sbagliato', 'Every value traceable · every run on record · better empty than wrong'))
  },

  // Riepiloghi: creazione dal batch, aggiunta di un altro batch, personalizza, Excel.
  dashboards: async (d) => {
    const { page, wait, moveTo, click, caption, settle, nav, button } = d
    // Rilanciabile: il riepilogo creato dal filmato non deve esistere già.
    for (const s of await summaries()) if (s.name === SPEND) await api('DELETE', `/api/polizza/summaries/${s.id}`)
    await page.goto(`${BASE}/polizza/jobs/${IDS.batchArchive}`)
    await settle(900)
    await d.start({ kicker: 'PDF Extractor', title: t('Dai documenti <span>ai numeri</span>', 'From documents <span>to decisions</span>'), sub: t('Riepiloghi ed Excel, direttamente dai dati estratti', 'Dashboards and Excel, straight from the extracted data') })

    await caption(t('Seleziona le pratiche estratte…', 'Select the extracted dossiers…'), { top: true })
    await click(page.locator('.jb-table thead input[type=checkbox]').first())
    await wait(900)
    await caption(t('…e crea un riepilogo', '…and create a summary'), { top: true })
    await click(button(t('Crea riepilogo', 'Create summary')))
    await wait(900)
    await page.keyboard.press('Control+A')
    await page.keyboard.type(SPEND, { delay: 45 })
    await wait(500)
    await moveTo(page.locator('select', { has: page.locator('option', { hasText: label('prof_fatture', 'f_data') }) }).first())
    await wait(1000)
    await click(button(t('Crea e apri', 'Create and open')))
    await page.waitForURL('**/polizza/riepiloghi/**'); await settle(1400)
    await caption(t('KPI, andamento per anno e scadenze, calcolati dai documenti', 'KPIs, yearly trend and deadlines — computed from the documents'))
    await moveTo(page.locator('.rp-card, .rp-kpi').nth(1))
    await wait(1100)
    await moveTo(page.locator('.rp-card', { has: page.locator('svg') }).first(), { dy: 40 })
    await wait(1600)

    await caption(t('Aggiungi altri batch quando vuoi: il cruscotto si aggiorna', 'Add more batches any time — the dashboard updates'), { top: true })
    await click(nav(t('Elaborazioni', 'Jobs')))
    await page.waitForURL('**/polizza/jobs'); await page.locator('.jb-card').first().waitFor(); await settle(700)
    await click(button(t('Apri il batch', 'Open batch')))
    await page.waitForURL('**/polizza/jobs/**'); await page.locator('.jb-table tbody tr').first().waitFor(); await settle(800)
    await click(page.locator('.jb-table thead input[type=checkbox]').first())
    await wait(700)
    await click(button(t('Aggiungi a un riepilogo', 'Add to a summary')))
    await wait(700)
    await click(page.getByRole('menuitem', { name: new RegExp(SPEND) }).first().or(page.locator('[role=menu] *', { hasText: SPEND }).last()))
    await wait(1300)
    await click(page.locator('[role=status] a', { hasText: t('Apri', 'Open') }).first())
    await page.waitForURL('**/polizza/riepiloghi/**'); await settle(1400)
    await moveTo(page.locator('.rp-card', { has: page.locator('svg') }).first(), { dy: 40 })
    await wait(1300)
    await moveTo(page.getByText(t('In scadenza nei prossimi 90 giorni', 'Expiring in the next 90 days')).first(), { dy: 50 })
    await wait(1500)

    await caption(t('Personalizzalo: per esempio, raggruppa per fornitore', 'Make it yours — for example, group by supplier'))
    await click(button(t('Personalizza', 'Customize')))
    await wait(700)
    const group = page.locator('label', { has: page.locator('.rp-lbl', { hasText: t('Raggruppa per', 'Group by') }) }).locator('select').first()
    await moveTo(group)
    await wait(500)
    await group.selectOption('f_forn')
    await wait(700)
    await click(page.getByRole('button', { name: t('Salva', 'Save'), exact: true }).first())
    await settle(900)
    await moveTo(page.locator('.rp-card', { hasText: label('prof_fatture', 'f_forn') }).first(), { dy: 20 })
    await wait(1800)
    await caption(t('Tabella per anno, dettaglio per campo…', 'Year-by-year table, field-by-field detail…'))
    await click(page.getByRole('button', { name: t('Tabella per anno', 'Table by year'), exact: true }).first())
    await settle(1200)
    await click(page.getByRole('button', { name: t('Per campo', 'By field'), exact: true }).first())
    await settle(1400)
    await caption(t('…e un clic per la cartella Excel, pronta da condividere', '…and one click for an Excel workbook, ready to share'))
    await moveTo(button(t('Esporta Excel', 'Export Excel')))
    await wait(1900)
    await d.outro(t('Dai PDF ai cruscotti · export Excel · sempre aggiornati', 'From PDFs to dashboards · Excel export · always up to date'))
  },
}

const only = process.argv.slice(2)
for (const n of only) if (!FILMS[n]) throw new Error(`filmato sconosciuto: ${n} (disponibili: ${Object.keys(FILMS).join(', ')})`)
mkdirSync(OUT_DIR, { recursive: true })
for (const [name, script] of Object.entries(FILMS)) {
  if (only.length && !only.includes(name)) continue
  await film(name, script)
}
await browser.close()
