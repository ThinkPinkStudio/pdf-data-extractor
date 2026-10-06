// [flag rigaparte] (06/10/2026) Schede DAS Drive (P03, P04, P12): lo Stadio A.7
// proponeva come Frazionamento «Rata Successiva», un PEZZO dell'etichetta della
// riga «PREMIO RATA SUCCESSIVA» letto nella colonna NETTO IMPONIBILE (24,88).
// «premio» della testa della descrizione («Frazionamento del premio») dava alla
// riga un'evidenza strutturale, il campo era pieno e la cascata non lo chiedeva
// più; «Annuale» sta sotto FRAZIONAMENTO nei dati contrattuali.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { A7_SYSTEM_PROMPT, extractPolizzaStaged, isRowLabelPart } from '../src/services/polizzaService.js'
import { normForMatch } from '../src/services/polizzaValidation.js'
import { tableRowsWithHeaders } from '../src/services/ocrLayout.js'

const PROFILES = JSON.parse(readFileSync(new URL('../polizze_test/profili-polizza-riconoscimento.json', import.meta.url), 'utf8'))
const TL = PROFILES.find((p) => p.name === 'Tutela Legale 3').fields
const byLabel = (label) => TL.find((f) => String(f.label).trim() === label)
const TIPOLOGIA = { ...byLabel('Tipologia tutela legale'), description: 'Tipologia della copertura di tutela legale: la categoria prevalente del soggetto o del rischio coperto, una tra Azienda, Professionista/Studio professionale, Auto/Circolazione, Condominio, Altra tipologia.' }

const TABLE = [
  '| PREMIO TOTALE | NETTO IMPONIBILE | INTERESSE DI FRAZIONAMENTO | DIRITTI | IMPOSTE | PREMIO LORDO |',
  '| --- | --- | --- | --- | --- | --- |',
  '| PREMIO ALLA FIRMA | 12,44 | 0,00 | 0,00 | 1,56 | 14,00 |',
  '| PREMIO RATA SUCCESSIVA | 24,88 | 0,00 | 0,00 | 3,12 | 28,00 |',
].join('\n')
const rowsOf = (t) => tableRowsWithHeaders(t).map((r) => ({ page: 1, key: normForMatch(r.label), row: r }))

test('isRowLabelPart: pezzo dell\'etichetta letto in una colonna di importi; non l\'etichetta intera, non le scelte chiuse né gli elenchi', () => {
  const hit = rowsOf(TABLE)[1]
  const fraz = byLabel('Frazionamento')
  assert.equal(isRowLabelPart('Rata Successiva', hit, 'NETTO IMPONIBILE', fraz, ['frazionamento']), true)
  assert.equal(isRowLabelPart('Rata Successiva', hit, 'col1', fraz, ['frazionamento']), true)
  // l'etichetta intera è la regola di sempre (isRowLabelValue)
  assert.equal(isRowLabelPart('PREMIO RATA SUCCESSIVA', hit, 'NETTO IMPONIBILE', fraz, ['frazionamento']), false)
  // il resto dell'etichetta nomina il campo: la riga è «Frazionamento Annuale»
  const named = rowsOf('| VOCE | PREMIO |\n| --- | --- |\n| Frazionamento Annuale | 28,00 |')[0]
  assert.equal(isRowLabelPart('Annuale', named, 'PREMIO', fraz, ['frazionamento']), false)
  // colonna dell'etichetta (testo), non di importi
  const garanzie = rowsOf('| GARANZIE PRESCELTE | TUTELA LEGALE |\n| --- | --- |\n| Difesa Condominio - ed.2019 | 159,99 |')[0]
  assert.equal(isRowLabelPart('Difesa Condominio', garanzie, 'GARANZIE PRESCELTE', byLabel('Attività assicurata'), []), false)
  // scelta chiusa: «Condominio» dalla riga «Difesa Condominio - ed.2019» è la categoria
  assert.equal(isRowLabelPart('Condominio', garanzie, 'TUTELA LEGALE', TIPOLOGIA, []), false)
  // elenco: le garanzie sono le etichette delle righe
  assert.equal(isRowLabelPart('Difesa Condominio', garanzie, 'TUTELA LEGALE', byLabel('Garanzie scelte/operanti'), []), false)
})

const PAGE = [
  'POLIZZA N. 01469DAS00076          DAS Drive',
  'DATI CONTRATTUALI',
  'DECORRENZA   SCADENZA      FRAZIONAMENTO      SCADENZA 1^ QUIETANZA',
  '30/06/2025   31/12/2026    Annuale             31/12/2025',
  '',
  TABLE,
].join('\n')

async function withFakeOllama(fn) {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      if (req.url !== '/api/chat') { res.writeHead(404); res.end('no'); return }
      const p = JSON.parse(body)
      const sys = String(p.messages?.find((m) => m.role === 'system')?.content || '')
      const user = String(p.messages?.find((m) => m.role === 'user')?.content || '')
      const idx = (list, head) => {
        const l = list.split('\n').find((x) => x.replace(/^\d+\.\s*/, '').startsWith(head))
        return l ? Number(l.match(/^(\d+)\./)[1]) : -1
      }
      let content = '{}'
      if (sys.startsWith(A7_SYSTEM_PROMPT.slice(0, 60))) {
        const list = user.split('CAMPI DA ESTRARRE (numerati):\n')[1]?.split('\n\nRispondi')[0] || ''
        const fz = idx(list, 'Frazionamento del premio')
        content = JSON.stringify({ voci: fz >= 0 ? [{ campo: fz, valore: 'Rata Successiva', riga: 'PREMIO RATA SUCCESSIVA', colonna: 'NETTO IMPONIBILE' }] : [] })
      } else if (user.includes('CAMPI ANCORA MANCANTI DA CERCARE IN QUESTO DOCUMENTO')) {
        const list = user.split('rispondi con chiavi c0, c1, …):\n')[1] || ''
        const fz = idx(list, 'Frazionamento del premio')
        content = JSON.stringify(fz >= 0 ? { [`c${fz}`]: { valore: 'Annuale', evidenza: 'FRAZIONAMENTO      SCADENZA 1^ QUIETANZA' } } : {})
      }
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.write(JSON.stringify({ message: { content }, done: false }) + '\n')
      res.end(JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: 100, eval_count: 10 }) + '\n')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

test('rigaparte: «Rata Successiva» dalla riga dei premi cade, la cascata trova «Annuale»', async () => {
  await withFakeOllama(async (url) => {
    const run = (flags) => extractPolizzaStaged([{ name: 'Polizza Das In Movimento.pdf', pages: [PAGE] }], {
      ollamaUrl: url, ollamaModel: 'fake', polizzaFields: TL, polizzaAutoVerify: false, polizzaStagedCascade: true, polizzaEngineFlags: flags,
    })
    const fz = byLabel('Frazionamento').id
    const base = await run('')
    assert.equal(base.data[fz], 'Rata Successiva', base.diag.filter((l) => /Tabella-focus|Frazionamento/.test(l)).join('\n'))
    const out = await run('rigaparte')
    assert.equal(out.data[fz], 'Annuale', out.diag.filter((l) => /Tabella-focus|Cascata|Frazionamento/.test(l)).join('\n'))
    assert.ok(out.diag.some((l) => /Tabella-focus\[Frazionamento\]: "Rata Successiva" scartato — è un pezzo dell'etichetta della riga/.test(l)))
  })
})
