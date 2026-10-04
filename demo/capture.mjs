// Cattura gli screenshot DEMO con palette OmegaNodes ed etichette neutre.
// Prerequisiti: web app avviata su DEMO_URL (default http://localhost:3100) con
// un DATABASE_URL locale già popolato da demo/seed.mjs.
//   node demo/capture.mjs                 # tutti gli scatti
//   node demo/capture.mjs 03 07           # solo gli scatti il cui nome inizia così
import { createRequire } from 'node:module'
import { readFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEMO_USER, FILES } from './data.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(join(here, '..', 'web', 'package.json'))
const { chromium } = require('playwright')

const BASE = process.env.DEMO_URL || 'http://localhost:3100'
const OUT = join(here, 'screenshots')
mkdirSync(OUT, { recursive: true })
const CSS = readFileSync(join(here, 'theme-omeganodes.css'), 'utf8')
const RELABEL = readFileSync(join(here, 'relabel.js'), 'utf8')
const IDS = JSON.parse(readFileSync(join(here, '.seed-ids.json'), 'utf8'))
const only = process.argv.slice(2)

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
})

async function newPage(theme = 'dark', { width = 1440, height = 900 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, locale: 'it-IT', timezoneId: 'Europe/Rome',
    colorScheme: theme,
  })
  await ctx.addInitScript(({ css, theme, jobId }) => {
    try {
      localStorage.setItem('theme', theme)
      localStorage.setItem('lang', 'it')
      localStorage.removeItem('accentColor')
      if (jobId) localStorage.setItem('polizzaJobId', jobId)
    } catch { /* storage non disponibile */ }
    const inject = () => {
      if (document.getElementById('demo-theme')) return
      const font = document.createElement('link')
      font.rel = 'stylesheet'
      font.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap'
      const st = document.createElement('style')
      st.id = 'demo-theme'
      st.textContent = css
      document.head.append(font, st)
      document.documentElement.setAttribute('data-theme', theme)
    }
    if (document.head) inject(); else document.addEventListener('DOMContentLoaded', inject)
  }, { css: CSS, theme, jobId: IDS.dossierMeridiane })
  await ctx.addInitScript(RELABEL)
  const page = await ctx.newPage()
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await page.request.post(`${BASE}/api/auth/login`, { data: { email: DEMO_USER } })
      if (r.ok()) break
      throw new Error(`login fallito: ${r.status()}`)
    } catch (err) {
      if (attempt >= 3) throw err
      await page.waitForTimeout(1000 * attempt)
    }
  }
  return page
}

async function settle(page, ms = 900) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {})
  await page.waitForTimeout(ms)
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, name + '.png') })
  console.log('✓', name)
}

const want = (name) => !only.length || only.some((p) => name.startsWith(p))

// Ripristina una sessione dalla Cronologia (stesso flusso del pulsante «Apri»).
async function openFromHistory(page, fileName) {
  await page.goto(`${BASE}/history`)
  await settle(page, 400)
  const card = page.locator('.card', { hasText: fileName }).first()
  await card.getByRole('button', { name: 'Apri' }).click()
  await page.waitForURL('**/extractor')
  await settle(page, 1500)
}

async function addExtractorTabs(page, files) {
  await page.locator('input[type=file][accept=".pdf"]').setInputFiles(files.map((f) => join(here, 'pdfs', f)))
  await page.waitForTimeout(600)
}

async function loadProfileInExtractor(page, name) {
  const sel = page.locator('.ext-panel select').first()
  const value = await sel.locator('option', { hasText: name }).first().getAttribute('value')
  await sel.selectOption(value)
  await page.waitForTimeout(300)
}

async function applyProfile(page, name) {
  const row = page.locator('div', { has: page.locator(`span:text-is("${name}")`) }).filter({ has: page.getByRole('button', { name: 'Applica' }) }).last()
  await row.getByRole('button', { name: 'Applica' }).click()
  await page.waitForTimeout(800)
}

async function scrollToText(page, text, offset = 90) {
  await page.evaluate(({ text, offset }) => {
    const el = [...document.querySelectorAll('span,h2,h3,label,button,td,div')].find((e) => e.textContent.trim() === text)
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - offset)
  }, { text, offset })
  await page.waitForTimeout(400)
}

const SHOTS = [
  ['01_estrattore_fattura', async () => {
    const page = await newPage('dark')
    await openFromHistory(page, FILES.ftMeridiane)
    await addExtractorTabs(page, [FILES.ddt, FILES.cedolino, FILES.locazione])
    await page.locator('.doc-tab', { hasText: FILES.ftMeridiane }).click()
    await loadProfileInExtractor(page, 'Fatture fornitori')
    await settle(page, 1200)
    await shot(page, '01_estrattore_fattura')
  }],
  ['02_estrattore_chat_contratto', async () => {
    const page = await newPage('dark')
    await openFromHistory(page, FILES.locazione)
    await page.getByRole('button', { name: 'Chat' }).first().click()
    await settle(page, 1200)
    await shot(page, '02_estrattore_chat_contratto')
  }],
  ['03_pratica_multidocumento', async () => {
    const page = await newPage('dark')
    await page.goto(`${BASE}/polizza`)
    await settle(page, 1800)
    await shot(page, '03_pratica_multidocumento')
  }],
  ['04_elaborazioni_batch', async () => {
    const page = await newPage('dark')
    await page.goto(`${BASE}/polizza/jobs`)
    await settle(page, 1200)
    await shot(page, '04_elaborazioni_batch')
  }],
  ['05_elaborazioni_dettaglio', async () => {
    const page = await newPage('dark', { height: 1000 })
    await page.goto(`${BASE}/polizza/jobs`)
    await settle(page, 800)
    await page.getByText('Fatture passive · Settembre 2026').first().click()
    await settle(page, 1000)
    await scrollToText(page, '⬇ Esporta risultati (Excel)', 150)
    await shot(page, '05_elaborazioni_dettaglio')
  }],
  ['05b_elaborazioni_valori', async () => {
    const page = await newPage('dark', { height: 1000 })
    await page.goto(`${BASE}/polizza/jobs`)
    await settle(page, 800)
    await page.getByText('Fatture passive · Settembre 2026').first().click()
    await settle(page, 1000)
    await page.locator('button[title]', { hasText: '▸' }).first().click()
    await settle(page, 800)
    await scrollToText(page, '⬇ Esporta risultati (Excel)', 150)
    await shot(page, '05b_elaborazioni_valori')
  }],
  ['05c_elaborazioni_in_corso', async () => {
    const page = await newPage('dark', { height: 1000 })
    await page.goto(`${BASE}/polizza/jobs`)
    await settle(page, 800)
    await page.getByText('Contratti fornitori · rinnovi 2027').first().click()
    await settle(page, 1200)
    await shot(page, '05c_elaborazioni_in_corso')
  }],
  ['06_cartella_bulk', async () => {
    const page = await newPage('dark', { height: 1100 })
    await page.goto(`${BASE}/polizza/bulk`)
    await settle(page, 800)
    // Solo estetica demo: la pagina ha un contenitore di 760px e select profilo strette.
    await page.addStyleTag({ content: 'div[style*="max-width: 760px"]{max-width:1180px!important} td select[style*="max-width: 160px"]{min-width:200px!important;max-width:240px!important}' })
    await page.locator('input[type=file][webkitdirectory]').setInputFiles(join(here, 'bulk', 'Archivio_Documenti_2026'))
    await settle(page, 1500)
    await scrollToText(page, 'Mostra i 2 PDF scartati', 40)
    await shot(page, '06_cartella_bulk')
  }],
  ...[
    ['07_profilo_fatture', 'Fatture fornitori'],
    ['08_profilo_contratti_fornitura', 'Contratti di fornitura'],
    ['09_profilo_locazioni', 'Contratti di locazione'],
    ['10_profilo_ddt', 'Documenti di trasporto (DDT)'],
    ['11_profilo_cedolini', 'Cedolini paga'],
    ['12_profilo_curriculum', 'Curriculum candidati'],
  ].map(([name, profile]) => [name, async () => {
    const page = await newPage('dark', { height: 1000 })
    await page.goto(`${BASE}/settings`)
    await settle(page, 800)
    await applyProfile(page, profile)
    await scrollToText(page, 'Profilo attuale:', 24)
    await settle(page, 2600) // il pulsante «✓ Salvato» torna «Salva campi» dopo 2,5 s
    await shot(page, name)
  }]),
  ['13_profili_elenco', async () => {
    const page = await newPage('dark', { height: 900 })
    await page.goto(`${BASE}/settings`)
    await settle(page, 800)
    await applyProfile(page, 'Fatture fornitori')
    await settle(page, 2600)
    await scrollToText(page, 'Profili documento (JSON)', 260)
    await shot(page, '13_profili_elenco')
  }],
  ['14_cronologia', async () => {
    const page = await newPage('dark')
    await page.goto(`${BASE}/history`)
    await settle(page, 900)
    await shot(page, '14_cronologia')
  }],
  ['15_light_estrattore_fattura', async () => {
    const page = await newPage('light')
    await openFromHistory(page, FILES.ftMeridiane)
    await addExtractorTabs(page, [FILES.preventivo, FILES.bolletta])
    await page.locator('.doc-tab', { hasText: FILES.ftMeridiane }).click()
    await loadProfileInExtractor(page, 'Fatture fornitori')
    await settle(page, 1200)
    await shot(page, '15_light_estrattore_fattura')
  }],
  ['16_light_pratica_multidocumento', async () => {
    const page = await newPage('light')
    await page.goto(`${BASE}/polizza`)
    await settle(page, 1800)
    await shot(page, '16_light_pratica_multidocumento')
  }],
  ['17_light_elaborazioni', async () => {
    const page = await newPage('light')
    await page.goto(`${BASE}/polizza/jobs`)
    await settle(page, 1200)
    await shot(page, '17_light_elaborazioni')
  }],
]

for (const [name, fn] of SHOTS) {
  if (!want(name)) continue
  try { await fn() } catch (err) { console.error('✗', name, err.message) }
}
await browser.close()
console.log('Screenshot in', OUT, '·', readdirSync(OUT).length, 'file')
