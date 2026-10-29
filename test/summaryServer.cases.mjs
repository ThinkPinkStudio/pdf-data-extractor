// Casi delle regole del server dei riepiloghi (web/lib/summaryCompose.ts,
// web/lib/summaryWorkbook.ts, web/lib/excelSheetName.ts). Non si lancia da
// solo: lo esegue summaryServer.test.mjs con --experimental-strip-types;
// l'alias «@/» e gli import senza estensione li risolve
// test/helpers/tsResolveHook.mjs. Database finto: dipendenze iniettate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ExcelJS from 'exceljs'

const here = dirname(fileURLToPath(import.meta.url))
const webRoot = pathToFileURL(join(here, '..', 'web') + '/').href
register(pathToFileURL(join(here, 'helpers', 'tsResolveHook.mjs')).href, { data: { webRoot } })

const svc = await import(pathToFileURL(join(here, '..', 'src', 'services', 'summaryAggregate.js')).href)
const C = await import(pathToFileURL(join(here, '..', 'web', 'lib', 'summaryCompose.ts')).href)
const W = await import(pathToFileURL(join(here, '..', 'web', 'lib', 'summaryWorkbook.ts')).href)
const X = await import(pathToFileURL(join(here, '..', 'web', 'lib', 'excelSheetName.ts')).href)

const TODAY = '26/09/2026'

// Profilo in stile Tutela Legale: descrizioni realistiche, label del cliente.
const FIELDS = [
  { id: 'num', label: 'N° Polizza', description: 'Numero identificativo della polizza: la sequenza alfanumerica accanto a «Polizza n.» (es. 410000880)', type: 'number' },
  { id: 'cmp', label: 'Compagnia', description: 'Nome della compagnia assicuratrice (es. Generali Italia S.p.A.)', type: 'text' },
  { id: 'iva', label: 'P. IVA / Cod. Fiscale', description: 'Partita IVA o codice fiscale del contraente (es. 00151510344)', type: 'text' },
  { id: 'dec', label: 'Decorrenza', description: 'Data di decorrenza della polizza (es. 31/12/2024)', type: 'date' },
  { id: 'sca', label: 'Scadenza', description: 'Data di scadenza della polizza (es. 31/12/2025)', type: 'date' },
  { id: 'fra', label: 'Frazionamento', description: 'Frazionamento del premio come TESTO (es. Annuale, Semestrale)', type: 'text' },
  { id: 'mas', label: 'Massimale per sinistro', description: "Massimale per sinistro: l'importo massimo che la compagnia paga per ogni sinistro (es. 25.000,00)", type: 'number' },
  { id: 'tax', label: 'Imposte', description: 'Imposte sul premio della garanzia (es. 140,00)', type: 'number' },
  { id: 'lor', label: 'Premio lordo', description: 'Premio lordo totale della garanzia (es. 760,00)', type: 'number' },
  { id: 'tas', label: 'Tasso ‰', description: 'Tasso di regolazione per mille (es. 0,245)' },
]
const RC_FIELDS = [
  { id: 'rcn', label: 'Numero', description: 'Numero identificativo della polizza RC (es. 123456)', type: 'text' },
  { id: 'rcm', label: 'Massimale', description: 'Massimale per sinistro della RC (es. 1.000.000,00)', type: 'number' },
]
const PROFILES = [
  { id: 'tl', name: 'Tutela Legale', fields: FIELDS.map((f) => ({ ...f, enabled: true })) },
  { id: 'rc', name: 'RC Professionale', fields: RC_FIELDS.map((f) => ({ ...f, enabled: true })) },
]

const rs = (vals) => Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, { valore: v, data_validita: null }]))
const clone = (x) => JSON.parse(JSON.stringify(x))

function job(id, name, vals, over = {}) {
  return {
    id,
    batch_id: 'B1',
    dossier_name: `LOTTO/PIZZAMIGLIO/${name}`,
    scanned_files: [`${id}.pdf`],
    status: 'done',
    field_defs: clone(FIELDS),
    rolling_state: rs(vals),
    profile_id: 'tl',
    profile_name: 'Tutela Legale',
    precheck: null,
    error: null,
    source_job_id: null,
    duplicate_of: null,
    updated_at: 1790000000,
    batch_label: 'LOTTO',
    ...over,
  }
}

const V = {
  j1: { num: 'TL001', cmp: 'Generali', iva: '00000000001', dec: '31/10/2024', sca: '31/10/2025', fra: 'Annuale', mas: '25.000,00', tax: '130,00', lor: '720,00', tas: '0,245' },
  j2: { num: 'TL002', cmp: 'ARAG', iva: '00000000002', dec: '15/11/2024', sca: '15/11/2025', fra: 'Annuale', mas: '50.000,00', tax: '155,00', lor: '860,00' },
  j6: { num: 'TL001', cmp: 'DAS', iva: '00000000001', dec: '31/10/2025', sca: '31/10/2026', fra: 'Annuale', mas: '25.000,00', tax: '137,00', lor: '760,00', tas: '0,300' },
  j7: { num: 'TL003', cmp: 'ARAG', iva: '00000000003', dec: '01/03/2025', sca: '01/03/2026', fra: 'Semestrale', mas: '10.000,00', tax: '74,00', lor: '410,00' },
}

function world() {
  const jobs = [
    job('j1', 'Condominio Via Verdi 12', V.j1),
    job('j2', 'Condominio Parco Nord', {}, { status: 'running', rolling_state: {} }),
    // j3: eliminato (assente)
    job('j4', 'Quietanza Alzaia', { num: 'X' }, { status: 'mismatch', error: 'Non valido — solo una quietanza', precheck: { notValid: true } }),
    job('j5', 'RC Studio Rossi', { rcn: '999', rcm: '1.000.000,00' }, { profile_id: 'rc', profile_name: 'RC Professionale', field_defs: clone(RC_FIELDS) }),
    job('j6', 'Condominio Via Verdi 12 rinnovo', V.j6, { updated_at: 1790500000 }),
    job('j7', 'Condominio Viale Monza 88', V.j7),
    job('j8', 'Condominio Test', V.j7, { source_job_id: 'j7' }),
  ]
  const runs = [
    { id: 11, job_id: 'j2', batch_id: 'B1', finished_at: 1789000000, status: 'done', profile_id: 'tl', profile_name: 'Tutela Legale', fields: FIELDS.map(({ id, label }) => ({ id, label })), field_values: V.j2, filled: 9, total: 10 },
  ]
  return { jobs, runs }
}

function fakeDeps({ jobs = [], runs = [], hashes = {}, latest = null, profiles = PROFILES, clock = 1791000000 } = {}) {
  const calls = { loadJobs: [], loadRuns: [], loadLabels: [], loadHashes: [], latest: [] }
  let tick = 0
  return {
    calls,
    profiles,
    now: () => clock + (tick++),
    newId: () => `sum-${++tick}`,
    loadJobs: async (ids) => { calls.loadJobs.push([...ids]); return clone(jobs.filter((j) => ids.includes(j.id))) },
    loadRuns: async (ids) => { calls.loadRuns.push([...ids]); return new Map(clone(runs.filter((r) => ids.includes(r.job_id))).map((r) => [r.job_id, r])) },
    loadLabels: async (ids) => {
      calls.loadLabels.push([...ids])
      return new Map(jobs.filter((j) => ids.includes(j.id)).map((j) => [j.id, { dossier_name: j.dossier_name, scanned_files: j.scanned_files, batch_label: j.batch_label }]))
    },
    loadHashes: async (ids) => { calls.loadHashes.push([...ids]); return Object.fromEntries(ids.filter((id) => hashes[id]).map((id) => [id, hashes[id]])) },
    latestForProfile: async (key) => { calls.latest.push(key); return latest && latest.key === key ? clone(latest.row) : null },
  }
}

function summaryRow(over = {}) {
  return {
    id: 'S1', name: 'Tutele legali', profile_id: 'tl', profile_name: 'Tutela Legale', year_field_id: 'dec', due_field_id: 'sca',
    mode: 'live', job_ids: ['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7'], snapshot: null, prefs: {},
    created_by: 'a@b.it', created_at: 1790000000, updated_at: 1790000000, ...over,
  }
}

async function detailOf(row, deps, opts = {}) {
  const { jobs, runs } = row.mode === 'live' ? await C.loadLiveMaps(deps, row.job_ids) : { jobs: new Map(), runs: new Map() }
  return C.composeDetail(svc, { row, jobs, runs, profiles: deps.profiles, today: TODAY, ...opts })
}

// ─── Utilità ─────────────────────────────────────────────────────────────────

test('excelSheetName: caratteri vietati, 31 caratteri, «History» riservato, nomi unici', () => {
  const used = X.reservedSheetNames('Risultati')
  assert.equal(X.excelSheetName('Tutela: legale/2024?', used), 'Tutela legale 2024')
  assert.equal(X.excelSheetName('tutela legale 2024', used), 'tutela legale 2024 2')
  assert.equal(X.excelSheetName('History', used), 'History 2')
  assert.equal(X.excelSheetName('risultati', used), 'risultati 2')
  const long = X.excelSheetName('Un nome di foglio davvero troppo lungo per Excel', used)
  assert.ok(long.length <= 31, long)
  const again = X.excelSheetName('Un nome di foglio davvero troppo lungo per Excel', used)
  assert.ok(again.length <= 31 && again !== long, again)
  assert.equal(X.excelSheetName('  [:*?]  ', used, 'Profilo'), 'Profilo')
  assert.equal(X.excelSheetName("'Quoted'", used), 'Quoted')
})

test('todayRome: la data di oggi a Roma, non in UTC', () => {
  assert.equal(C.todayRome(new Date('2026-09-25T22:30:00Z')), '26/09/2026') // CEST, già il 26
  assert.equal(C.todayRome(new Date('2026-12-31T22:59:59Z')), '31/12/2026') // CET
  assert.equal(C.todayRome(new Date('2026-12-31T23:00:00Z')), '01/01/2027')
})

test('parseViewQuery: anno, gruppo, A/B, campo; valori non validi ignorati', () => {
  assert.deepEqual(C.parseViewQuery(new URLSearchParams('anno=2025&gruppo=DAS&a=2024&b=2025&campo=lor')), { year: 2025, group: 'DAS', yearA: 2024, yearB: 2025, field: 'lor' })
  assert.deepEqual(C.parseViewQuery(new URLSearchParams('anno=none')), { year: 'none' })
  assert.deepEqual(C.parseViewQuery(new URLSearchParams('anno=abc&a=24&b=')), {})
})

test('cleanSummaryName: 1–120 caratteri dopo il trim', () => {
  assert.equal(C.cleanSummaryName('  Tutele 2025 '), 'Tutele 2025')
  assert.equal(C.cleanSummaryName('   '), null)
  assert.equal(C.cleanSummaryName('x'.repeat(121)), null)
  assert.equal(C.cleanSummaryName(12), null)
})

// ─── Creazione e anteprima ───────────────────────────────────────────────────

test('creazione: job estratti dello stesso profilo, anno = primo campo data, scadenza = data successiva, nessuna eredità', async () => {
  const { jobs, runs } = world()
  const deps = fakeDeps({ jobs, runs })
  const out = await C.createSummaryCore(svc, deps, { name: ' Tutele ', jobIds: ['j1', 'j6', 'j7'], mode: 'live' }, 'a@b.it')
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.row.name, 'Tutele')
  assert.equal(out.row.profile_id, 'tl')
  assert.equal(out.row.profile_name, 'Tutela Legale')
  assert.deepEqual(out.row.job_ids, ['j1', 'j6', 'j7'])
  assert.equal(out.row.year_field_id, 'dec')
  assert.equal(out.row.due_field_id, 'sca')
  assert.deepEqual(out.row.prefs, {})
  assert.equal(out.row.snapshot, null)
  assert.equal(out.row.created_by, 'a@b.it')
  assert.equal(out.inherited, false)
  // hash chiesti per i job richiesti (niente membri alla creazione)
  assert.deepEqual(deps.calls.loadHashes, [['j1', 'j6', 'j7']])
})

test('creazione: rifiuti (profilo diverso, non estratta, Non valida, run di test, assente) → 409 not-eligible', async () => {
  const { jobs, runs } = world()
  const out = await C.createSummaryCore(svc, fakeDeps({ jobs, runs }), { name: 'X', jobIds: ['j1', 'j5', 'j2', 'j4', 'j8', 'j3'], mode: 'live' }, 'a@b.it')
  assert.equal(out.ok, false)
  assert.equal(out.status, 409)
  assert.equal(out.body.code, 'not-eligible')
  assert.deepEqual(out.body.refused.map((r) => [r.jobId, r.reason]), [
    ['j5', 'other-profile'], ['j2', 'not-done'], ['j4', 'not-valid'], ['j8', 'test-run'], ['j3', 'not-found'],
  ])
})

test('creazione: doppione per contenuto (stessi hash) → 409 duplicate col nome del primo', async () => {
  const { jobs, runs } = world()
  const hashes = { j1: ['h1', 'h2'], j6: ['h2', 'h1'] }
  const out = await C.createSummaryCore(svc, fakeDeps({ jobs, runs, hashes }), { name: 'X', jobIds: ['j1', 'j6'], mode: 'live' }, 'a@b.it')
  assert.equal(out.status, 409)
  assert.deepEqual(out.body.refused.map((r) => [r.jobId, r.reason, r.detail]), [['j6', 'duplicate', 'Condominio Via Verdi 12']])
})

test('creazione: validazioni del corpo (nome, modo, elenco, anno non data)', async () => {
  const { jobs, runs } = world()
  const deps = fakeDeps({ jobs, runs })
  assert.equal((await C.createSummaryCore(svc, deps, { name: '', jobIds: ['j1'], mode: 'live' }, 'e')).body.code, 'bad-name')
  assert.equal((await C.createSummaryCore(svc, deps, { name: 'x', jobIds: ['j1'], mode: 'boh' }, 'e')).body.code, 'bad-mode')
  const empty = await C.createSummaryCore(svc, deps, { name: 'x', jobIds: [], mode: 'live' }, 'e')
  assert.equal(empty.body.code, 'bad-job-ids')
  assert.equal(empty.body.reason, 'empty')
  assert.equal((await C.createSummaryCore(svc, deps, { name: 'x', jobIds: Array.from({ length: 2001 }, (_, i) => `id${i}`), mode: 'live' }, 'e')).body.code, 'too-many')
  assert.equal((await C.createSummaryCore(svc, deps, { name: 'x', jobIds: ['j1'], mode: 'live', yearFieldId: 'fra' }, 'e')).body.code, 'bad-year-field')
  assert.equal((await C.createSummaryCore(svc, deps, [], 'e')).body.code, 'bad-body')
})

test('creazione: «Anno da» scelto → la scadenza si ricalcola (mai uguale all\'anno)', async () => {
  const { jobs, runs } = world()
  const out = await C.createSummaryCore(svc, fakeDeps({ jobs, runs }), { name: 'x', jobIds: ['j1', 'j6'], mode: 'live', yearFieldId: 'sca' }, 'e')
  assert.equal(out.row.year_field_id, 'sca')
  assert.equal(out.row.due_field_id, 'dec')
})

test('creazione: preferenze, anno e scadenza ereditati dall\'ultimo riepilogo dello stesso profilo (ripuliti)', async () => {
  const { jobs, runs } = world()
  const latest = { key: 'tl', row: { prefs: { highlights: [{ fieldId: 'lor', op: 'sum' }], groupFieldId: 'cmp', ops: { gone: ['sum'] } }, year_field_id: 'sca', due_field_id: 'dec' } }
  const out = await C.createSummaryCore(svc, fakeDeps({ jobs, runs, latest }), { name: 'x', jobIds: ['j1', 'j6'], mode: 'live' }, 'e')
  assert.equal(out.inherited, true)
  assert.equal(out.row.year_field_id, 'sca')
  assert.equal(out.row.due_field_id, 'dec')
  assert.deepEqual(out.row.prefs, { ops: {}, highlights: [{ fieldId: 'lor', op: 'sum' }], groupFieldId: 'cmp' })
})

test('creazione in fotografia: valori copiati subito, campi congelati', async () => {
  const { jobs, runs } = world()
  const out = await C.createSummaryCore(svc, fakeDeps({ jobs, runs }), { name: 'x', jobIds: ['j1', 'j6'], mode: 'snapshot' }, 'e')
  const s = out.row.snapshot
  assert.equal(out.row.mode, 'snapshot')
  assert.equal(s.takenAt, out.row.created_at)
  assert.deepEqual(s.fieldDefs.map((f) => f.id), FIELDS.map((f) => f.id))
  assert.deepEqual(Object.keys(s.jobs).sort(), ['j1', 'j6'])
  assert.equal(s.jobs.j6.values.lor, '760,00')
  assert.equal(s.jobs.j6.batchLabel, 'LOTTO')
  assert.equal(s.jobs.j6.dossierName, 'LOTTO/PIZZAMIGLIO/Condominio Via Verdi 12 rinnovo')
})

test('anteprima: profilo, ammessi e rifiutati, campi data coi valori, default', async () => {
  const { jobs, runs } = world()
  const out = await C.previewCore(svc, fakeDeps({ jobs, runs }), { jobIds: ['j1', 'j6', 'j5', 'j7'] })
  assert.equal(out.ok, true)
  const p = out.preview
  assert.equal(p.profileId, 'tl')
  assert.equal(p.profileName, 'Tutela Legale')
  assert.equal(p.fieldCount, FIELDS.length)
  assert.deepEqual(p.eligible.map((e) => e.jobId), ['j1', 'j6', 'j7'])
  assert.deepEqual(p.refused.map((r) => [r.jobId, r.reason, r.detail]), [['j5', 'other-profile', 'RC Professionale']])
  assert.deepEqual(p.dateFields, [{ id: 'dec', label: 'Decorrenza', filled: 3 }, { id: 'sca', label: 'Scadenza', filled: 3 }])
  assert.deepEqual(p.defaults, { yearFieldId: 'dec', dueFieldId: 'sca' })
  assert.equal(p.inherited, false)
  const none = await C.previewCore(svc, fakeDeps({ jobs, runs }), { jobIds: ['j2'] })
  assert.equal(none.preview.profileId, null)
  assert.deepEqual(none.preview.refused.map((r) => r.reason), ['not-done'])
})

// ─── Dettaglio ───────────────────────────────────────────────────────────────

test('dettaglio live: ok, in ri-estrazione (run), eliminata, Non valida, altro profilo', async () => {
  const { jobs, runs } = world()
  const deps = fakeDeps({ jobs, runs })
  const d = await detailOf(summaryRow(), deps)
  // la run si legge SOLO per i job non estratti e non bloccati (j2 running)
  assert.deepEqual(deps.calls.loadRuns, [['j2']])
  const st = Object.fromEntries(d.members.map((m) => [m.jobId, m.reason ? `${m.state}/${m.reason}` : m.state]))
  assert.deepEqual(st, { j1: 'ok', j2: 'stale', j3: 'missing', j4: 'excluded/notValid', j5: 'excluded/otherProfile', j6: 'ok', j7: 'ok' })
  // prima mancanti ed esclusi, poi per nome
  assert.deepEqual(d.members.map((m) => m.state), ['missing', 'excluded', 'excluded', 'stale', 'ok', 'ok', 'ok'])
  assert.equal(d.members.find((m) => m.jobId === 'j2').valuesAt, 1789000000)
  assert.equal(d.members.find((m) => m.jobId === 'j2').status, 'running')
  assert.equal(d.members.find((m) => m.jobId === 'j6').year, 2025)
  assert.equal(d.members.find((m) => m.jobId === 'j3').name, 'j3')
  assert.deepEqual(d.policies.map((p) => p.jobId).sort(), ['j1', 'j2', 'j6', 'j7'])
  const codes = Object.fromEntries(d.warnings.map((w) => [w.code, w.jobIds]))
  assert.deepEqual(codes.missing, ['j3'])
  assert.deepEqual(codes.stale, ['j2'])
  assert.deepEqual(codes.excluded.sort(), ['j4', 'j5'])
  assert.deepEqual(d.warnings.find((w) => w.code === 'excluded').byReason, { notValid: ['j4'], otherProfile: ['j5'] })
  assert.equal(codes.samePolicy, undefined) // TL001 in anni diversi: è un rinnovo, non un doppione
  assert.equal(d.summary.fieldCount, FIELDS.length)
  assert.equal(d.summary.yearFieldId, 'dec')
  assert.equal(d.summary.dueFieldId, 'sca')
  assert.equal(d.summary.jobCount, 7)
  assert.equal(d.summary.snapshotAt, null)
  // valori per polizza: di default solo i campi «per polizza» (identificativi)
  assert.deepEqual(Object.keys(d.policies.find((p) => p.jobId === 'j1').values).sort(), ['iva', 'num'])
  const all = await detailOf(summaryRow(), fakeDeps({ jobs, runs }), { values: 'all' })
  assert.equal(all.policies.find((p) => p.jobId === 'j1').values.lor, '720,00')
  // gli aggregati non vedono i campi del job di un altro profilo
  assert.ok(!('rcm' in all.fieldStats))
})

test('dettaglio: campi di riferimento = membro «ok» più recente; i campi tolti restano fuori da N', async () => {
  const { jobs, runs } = world()
  const old = jobs.find((j) => j.id === 'j1')
  old.field_defs = [...clone(FIELDS), { id: 'old', label: 'Vecchio campo', description: 'Nota libera (es. testo)', type: 'text' }]
  old.rolling_state = rs({ ...V.j1, old: 'qualcosa' })
  old.updated_at = 1780000000
  const d = await detailOf(summaryRow({ job_ids: ['j1', 'j6', 'j7'] }), fakeDeps({ jobs, runs }))
  assert.deepEqual(d.fields.map((f) => f.id), FIELDS.map((f) => f.id))
  assert.deepEqual(d.removedFields.map((f) => f.id), ['old'])
  assert.equal(d.summary.fieldCount, FIELDS.length)
  assert.equal(d.dashboard.completeness.total, FIELDS.length * 3)
})

test('dettaglio: «Anno da» salvato non più data del profilo → default; scadenza null resta «nessuna»', async () => {
  const { jobs, runs } = world()
  const d = await detailOf(summaryRow({ job_ids: ['j1', 'j6'], year_field_id: 'sparito', due_field_id: null }), fakeDeps({ jobs, runs }))
  assert.equal(d.summary.yearFieldId, 'dec')
  assert.equal(d.summary.dueFieldId, null)
})

test('dettaglio: nessun membro disponibile → i campi del profilo delle impostazioni (ripiego)', async () => {
  const { jobs, runs } = world()
  const d = await detailOf(summaryRow({ job_ids: ['j3', 'j4'] }), fakeDeps({ jobs, runs }))
  assert.equal(d.policies.length, 0)
  assert.deepEqual(d.fields.map((f) => f.id), FIELDS.map((f) => f.id))
})

test('dettaglio in fotografia: nessuna lettura dei job, voci conservate → avviso keptOld', async () => {
  const { jobs, runs } = world()
  const deps = fakeDeps({ jobs, runs })
  const created = await C.createSummaryCore(svc, deps, { name: 'x', jobIds: ['j1', 'j6', 'j7'], mode: 'snapshot' }, 'e')
  const row = created.row
  row.snapshot.jobs.j7.kept = true
  deps.calls.loadJobs.length = 0
  const d = C.composeDetail(svc, { row, jobs: new Map(), runs: new Map(), profiles: PROFILES, today: TODAY })
  assert.deepEqual(d.members.map((m) => m.state), ['ok', 'ok', 'ok'])
  assert.equal(d.members.find((m) => m.jobId === 'j7').kept, true)
  assert.deepEqual(d.warnings.filter((w) => w.code === 'keptOld').map((w) => w.jobIds), [['j7']])
  assert.equal(d.summary.snapshotAt, row.snapshot.takenAt)
  assert.equal(d.members.find((m) => m.jobId === 'j6').name, 'Condominio Via Verdi 12 rinnovo')
  assert.equal(d.members.find((m) => m.jobId === 'j6').path, 'PIZZAMIGLIO')
})

test('dettaglio: le label non decidono niente (stessi default e stessi numeri con label sostituite)', async () => {
  const { jobs, runs } = world()
  const renamed = clone(jobs).map((j) => ({ ...j, field_defs: (j.field_defs || []).map((f) => ({ ...f, label: 'X' })) }))
  const a = await detailOf(summaryRow(), fakeDeps({ jobs, runs }))
  const b = await detailOf(summaryRow(), fakeDeps({ jobs: renamed, runs, profiles: PROFILES.map((p) => ({ ...p, fields: p.fields.map((f) => ({ ...f, label: 'X' })) })) }))
  assert.deepEqual(b.prefs, a.prefs)
  assert.deepEqual(b.table, a.table)
  assert.deepEqual(b.dashboard, a.dashboard)
  assert.deepEqual([b.summary.yearFieldId, b.summary.dueFieldId], [a.summary.yearFieldId, a.summary.dueFieldId])
})

// ─── PATCH ───────────────────────────────────────────────────────────────────

test('PATCH: voci sconosciute, corpo vuoto, nome', async () => {
  const deps = fakeDeps(world())
  assert.equal((await C.patchSummaryCore(svc, deps, summaryRow(), { foo: 1 })).body.code, 'unknown-key')
  assert.equal((await C.patchSummaryCore(svc, deps, summaryRow(), {})).body.code, 'empty')
  assert.equal((await C.patchSummaryCore(svc, deps, summaryRow(), { name: ' ' })).body.code, 'bad-name')
  const ok = await C.patchSummaryCore(svc, deps, summaryRow(), { name: 'Nuovo' })
  assert.equal(ok.row.name, 'Nuovo')
  assert.deepEqual(ok.keys, ['name'])
})

test('PATCH: togli e aggiungi (già presenti contati, altro profilo → 409, tetto di 2000)', async () => {
  const { jobs, runs } = world()
  jobs.push(job('j9', 'Condominio Nuovo', { ...V.j7, num: 'TL009', iva: '00000000009' }))
  const deps = fakeDeps({ jobs, runs })
  const out = await C.patchSummaryCore(svc, deps, summaryRow({ job_ids: ['j1', 'j6'] }), { removeJobIds: ['j1', 'zzz'], addJobIds: ['j6', 'j9', 'j7'] })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.deepEqual(out.result.removed, ['j1'])
  assert.deepEqual(out.result.already, ['j6'])
  assert.deepEqual(out.result.added, ['j9', 'j7'])
  assert.deepEqual(out.row.job_ids, ['j6', 'j9', 'j7'])
  // gli hash si chiedono anche per i membri (doppioni per contenuto)
  assert.deepEqual(deps.calls.loadHashes.at(-1).sort(), ['j6', 'j7', 'j9'])
  const bad = await C.patchSummaryCore(svc, deps, summaryRow({ job_ids: ['j6'] }), { addJobIds: ['j5'] })
  assert.equal(bad.status, 409)
  assert.deepEqual(bad.body.refused.map((r) => r.reason), ['other-profile'])
  const many = Array.from({ length: 1999 }, (_, i) => `m${i}`)
  const full = await C.patchSummaryCore(svc, deps, summaryRow({ job_ids: many }), { addJobIds: ['j7', 'j9'] })
  assert.equal(full.body.code, 'too-many')
})

test('PATCH: doppione di un membro per contenuto → 409 duplicate', async () => {
  const { jobs, runs } = world()
  const deps = fakeDeps({ jobs, runs, hashes: { j1: ['h1'], j6: ['h1'] } })
  const out = await C.patchSummaryCore(svc, deps, summaryRow({ job_ids: ['j1'] }), { addJobIds: ['j6'] })
  assert.equal(out.status, 409)
  assert.deepEqual(out.body.refused.map((r) => [r.reason, r.detail]), [['duplicate', 'Condominio Via Verdi 12']])
})

test('PATCH: da live a fotografia → non disponibili tolti (dropped), in ri-estrazione fotografati coi valori della run', async () => {
  const { jobs, runs } = world()
  const out = await C.patchSummaryCore(svc, fakeDeps({ jobs, runs }), summaryRow(), { mode: 'snapshot' })
  assert.equal(out.ok, true)
  assert.equal(out.row.mode, 'snapshot')
  assert.deepEqual(out.result.dropped.sort(), ['j3', 'j4', 'j5'])
  assert.deepEqual(out.row.job_ids, ['j1', 'j2', 'j6', 'j7'])
  assert.equal(out.row.snapshot.jobs.j2.values.lor, '860,00')
  assert.equal(out.row.snapshot.jobs.j2.jobUpdatedAt, 1789000000)
  const back = await C.patchSummaryCore(svc, fakeDeps({ jobs, runs }), out.row, { mode: 'live' })
  assert.equal(back.row.mode, 'live')
  assert.equal(back.row.snapshot, null)
})

test('PATCH: refreshSnapshot solo in fotografia; Non valida esce, non disponibile tiene la voce (kept), estratta si aggiorna', async () => {
  const { jobs, runs } = world()
  assert.equal((await C.patchSummaryCore(svc, fakeDeps({ jobs, runs }), summaryRow(), { refreshSnapshot: true })).body.code, 'not-snapshot')
  assert.equal((await C.patchSummaryCore(svc, fakeDeps({ jobs, runs }), summaryRow(), { refreshSnapshot: 'si' })).body.code, 'bad-body')
  // fotografia di j1, j6, j7 con un campo in più (poi tolto dal profilo)
  const deps0 = fakeDeps({ jobs, runs })
  const created = (await C.createSummaryCore(svc, deps0, { name: 'x', jobIds: ['j1', 'j6', 'j7'], mode: 'snapshot' }, 'e')).row
  created.snapshot.fieldDefs.push({ id: 'old', label: 'Vecchio campo', description: 'Nota libera (es. testo)', type: 'text' })
  created.snapshot.jobs.j1.values.old = 'qualcosa'
  // oggi: j1 in ri-estrazione senza run completate, j7 Non valida, j6 ri-estratta con un premio nuovo
  const now = clone(jobs)
  now.find((j) => j.id === 'j1').status = 'running'
  Object.assign(now.find((j) => j.id === 'j7'), { status: 'mismatch', precheck: { notValid: true } })
  now.find((j) => j.id === 'j6').rolling_state = rs({ ...V.j6, lor: '800,00' })
  const out = await C.patchSummaryCore(svc, fakeDeps({ jobs: now, runs: [], clock: 1792000000 }), created, { refreshSnapshot: true })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.deepEqual(out.result.dropped, ['j7'])
  assert.deepEqual(out.result.keptOld, ['j1'])
  assert.deepEqual(out.row.job_ids, ['j1', 'j6'])
  assert.equal(out.row.snapshot.jobs.j1.kept, true)
  assert.equal(out.row.snapshot.jobs.j1.values.old, 'qualcosa')
  assert.equal(out.row.snapshot.jobs.j6.values.lor, '800,00')
  assert.equal(out.row.snapshot.jobs.j6.kept, undefined)
  assert.ok(out.row.snapshot.takenAt > created.snapshot.takenAt)
  // il campo tolto resta tra i campi fuori da N, con i valori conservati
  assert.deepEqual(out.row.snapshot.removedFieldDefs.map((f) => f.id), ['old'])
  assert.ok(!out.row.snapshot.fieldDefs.some((f) => f.id === 'old'))
})

test('PATCH: aggiunta in fotografia → fotografata subito, campi nuovi accodati', async () => {
  const { jobs, runs } = world()
  const extra = { id: 'nuovo', label: 'Nuovo', description: 'Nota del cliente (es. testo)', type: 'text' }
  jobs.push(job('j9', 'Condominio Nuovo', { ...V.j7, num: 'TL009', nuovo: 'ciao' }, { field_defs: [...clone(FIELDS), extra] }))
  const deps = fakeDeps({ jobs, runs })
  const created = (await C.createSummaryCore(svc, deps, { name: 'x', jobIds: ['j1', 'j6'], mode: 'snapshot' }, 'e')).row
  const out = await C.patchSummaryCore(svc, deps, created, { addJobIds: ['j9'] })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.equal(out.row.snapshot.jobs.j9.values.nuovo, 'ciao')
  assert.equal(out.row.snapshot.fieldDefs.at(-1).id, 'nuovo')
  assert.equal(out.row.snapshot.takenAt, created.snapshot.takenAt)
  assert.equal(created.snapshot.jobs.j9, undefined, 'la riga di partenza non si tocca')
})

test('PATCH: anno e scadenza solo campi data; preferenze unite e validate; null = ripristino', async () => {
  const { jobs, runs } = world()
  const deps = fakeDeps({ jobs, runs })
  const row = summaryRow({ job_ids: ['j1', 'j6', 'j7'], prefs: { groupFieldId: 'cmp', ops: { lor: ['sum'] } } })
  assert.equal((await C.patchSummaryCore(svc, deps, row, { yearFieldId: 'fra' })).body.code, 'bad-year-field')
  assert.equal((await C.patchSummaryCore(svc, deps, row, { yearFieldId: null })).body.code, 'bad-year-field')
  assert.equal((await C.patchSummaryCore(svc, deps, row, { dueFieldId: 'lor' })).body.code, 'bad-due-field')
  const due = await C.patchSummaryCore(svc, deps, row, { yearFieldId: 'sca', dueFieldId: null })
  assert.equal(due.row.year_field_id, 'sca')
  assert.equal(due.row.due_field_id, null)
  const bad = await C.patchSummaryCore(svc, deps, row, { prefs: { highlights: [{ fieldId: 'cmp', op: 'sum' }] } })
  assert.equal(bad.status, 400)
  assert.equal(bad.body.code, 'bad-prefs')
  assert.deepEqual(bad.body.errors, [{ key: 'highlights', reason: 'not-numeric', fieldId: 'cmp' }])
  const merged = await C.patchSummaryCore(svc, deps, row, { prefs: { ops: { tax: ['sum', 'avg'] }, tableRows: 'all' } })
  assert.deepEqual(merged.row.prefs, { groupFieldId: 'cmp', ops: { lor: ['sum'], tax: ['sum', 'avg'] }, tableRows: 'all' })
  const reset = await C.patchSummaryCore(svc, deps, row, { prefs: null })
  assert.deepEqual(reset.row.prefs, {})
  assert.deepEqual(row.prefs, { groupFieldId: 'cmp', ops: { lor: ['sum'] } }, 'la riga di partenza non si tocca')
})

// ─── Export Excel ────────────────────────────────────────────────────────────

async function reload(wb) {
  const buf = await wb.xlsx.writeBuffer()
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(buf)
  return back
}

test('export: quattro fogli tradotti, numeri veri, date vere, P.IVA come testo, tutti i campi del profilo', async () => {
  const { jobs, runs } = world()
  // «raggruppa per» Compagnia scelto dall'utente (il default qui è Frazionamento: §7.2 della specifica)
  const d = await detailOf(summaryRow({ prefs: { groupFieldId: 'cmp' } }), fakeDeps({ jobs, runs }), { values: 'all', prefsOverride: { tableRows: 'all' } })
  const it = await reload(W.buildSummaryWorkbook({ detail: d, lang: 'it', svc, exportedAt: new Date('2026-09-26T10:00:00Z') }))
  assert.deepEqual(it.worksheets.map((w) => w.name), ['Per anno', 'Polizze', 'Confronto 2024-2025', 'Info'])
  const en = await reload(W.buildSummaryWorkbook({ detail: d, lang: 'en', svc }))
  assert.deepEqual(en.worksheets.map((w) => w.name), ['By year', 'Policies', 'Comparison 2024-2025', 'Info'])

  // Per anno: intestazioni, gruppo Portafoglio, conteggi numerici, delta in %
  const y = it.getWorksheet('Per anno')
  assert.deepEqual(y.getRow(1).values.slice(1), ['Campo', 'Calcolo', '2024', '2025', 'Totale', '2025 vs 2024'])
  assert.equal(y.getRow(2).getCell(1).value, 'Portafoglio')
  assert.deepEqual(y.getRow(3).values.slice(1, 6), ['Polizze', 'numero', 2, 2, 4])
  const labels = []
  y.eachRow((r) => labels.push(r.getCell(1).value))
  assert.ok(labels.includes('Importi') && labels.includes('Condizioni: massimali, franchigie, scoperti') && labels.includes('Tassi (medie)'), labels.join(' | '))
  const lorRow = []
  y.eachRow((r) => { if (r.getCell(1).value === 'Premio lordo' && r.getCell(2).value === 'Σ somma') lorRow.push(r) })
  assert.equal(lorRow.length, 1)
  assert.equal(lorRow[0].getCell(3).value, 720 + 860)
  assert.equal(lorRow[0].getCell(4).value, 760 + 410)
  assert.equal(lorRow[0].getCell(3).numFmt, '#,##0.00')
  assert.ok(Math.abs(lorRow[0].getCell(6).value - ((1170 - 1580) / 1580)) < 1e-9)
  assert.equal(lorRow[0].getCell(6).numFmt, '0.0%')

  // Polizze: tutte le colonne del profilo, tipi veri
  const p = it.getWorksheet('Polizze')
  const head = p.getRow(1).values.slice(1)
  assert.deepEqual(head.slice(0, 5), ['Polizza', 'Percorso', 'Batch', 'Anno', 'Stato'])
  assert.deepEqual(head.slice(5), FIELDS.map((f) => f.label))
  const rows = []
  p.eachRow((r, i) => { if (i > 1) rows.push(r) })
  assert.equal(rows.length, 4)
  const verdi = rows.find((r) => r.getCell(1).value === 'Condominio Via Verdi 12')
  const col = (id) => 6 + FIELDS.findIndex((f) => f.id === id)
  assert.equal(verdi.getCell(2).value, 'PIZZAMIGLIO')
  assert.equal(verdi.getCell(3).value, 'LOTTO')
  assert.equal(verdi.getCell(4).value, 2024)
  assert.equal(verdi.getCell(5).value, 'estratta')
  assert.equal(verdi.getCell(col('iva')).value, '00000000001')
  assert.equal(verdi.getCell(col('num')).value, 'TL001')
  assert.equal(verdi.getCell(col('lor')).value, 720)
  assert.equal(verdi.getCell(col('tas')).value, 0.245)
  assert.equal(verdi.getCell(col('dec')).value.toISOString(), '2024-10-31T00:00:00.000Z')
  assert.equal(verdi.getCell(col('dec')).numFmt, 'dd/mm/yyyy')
  const parco = rows.find((r) => r.getCell(1).value === 'Condominio Parco Nord')
  assert.match(parco.getCell(5).value, /^valori della run completata il \d\d\/\d\d\/\d{4} \(ora: In corso\)$/)

  // Confronto: rinnovata per numero di polizza, compagnia cambiata
  const c = it.getWorksheet('Confronto 2024-2025')
  const texts = []
  c.eachRow((r) => texts.push(r.values.slice(1).map((v) => (v == null ? '' : String(v))).join(' | ')))
  assert.ok(texts.some((t) => t.startsWith('rinnovate nel 2025 | 1')), texts.join('\n'))
  assert.ok(texts.some((t) => t.includes('Generali → DAS') && t.includes('abbinata per N° Polizza')), texts.join('\n'))

  // Info
  const info = it.getWorksheet('Info')
  const kv = {}
  info.eachRow((r) => { kv[r.getCell(1).value] = r.getCell(2).value })
  assert.equal(kv.Riepilogo, 'Tutele legali')
  assert.equal(kv.Profilo, 'Tutela Legale')
  assert.equal(kv.Valori, 'Valori aggiornati')
  assert.equal(kv['Polizze nel riepilogo'], 7)
  assert.equal(kv['Polizze nei calcoli'], 4)
  assert.equal(kv['Anno da'], 'Decorrenza')
  const infoTexts = []
  info.eachRow((r) => infoTexts.push(String(r.getCell(1).value)))
  assert.ok(infoTexts.some((t) => t.startsWith('1 polizze non sono più in Elaborazioni')), infoTexts.join('\n'))
})

test('export: confronto impossibile con un solo anno, fotografia nelle info', async () => {
  const { jobs, runs } = world()
  const deps = fakeDeps({ jobs, runs })
  const row = (await C.createSummaryCore(svc, deps, { name: 'Solo 2024', jobIds: ['j1'], mode: 'snapshot' }, 'e')).row
  const d = C.composeDetail(svc, { row, jobs: new Map(), runs: new Map(), profiles: PROFILES, today: TODAY, values: 'all', prefsOverride: { tableRows: 'all' } })
  const wb = await reload(W.buildSummaryWorkbook({ detail: d, lang: 'it', svc }))
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Per anno', 'Polizze', 'Confronto A-B', 'Info'])
  assert.equal(wb.getWorksheet('Confronto A-B').getRow(1).getCell(1).value, 'Servono polizze di almeno due anni per il confronto')
  const kv = {}
  wb.getWorksheet('Info').eachRow((r) => { kv[r.getCell(1).value] = r.getCell(2).value })
  assert.match(kv.Valori, /^Fotografia del \d\d\/\d\d\/\d{4}$/)
})

test('export: nome del file e lingua', () => {
  assert.equal(W.summaryFileName('Tutele legali 2025/Lucchese', new Date('2026-09-25T22:30:00Z')), 'riepilogo_Tutele_legali_2025_Lucchese_2026-09-26.xlsx')
  assert.equal(W.exportLang('en', 'it'), 'en')
  assert.equal(W.exportLang(null, 'en'), 'en')
  assert.equal(W.exportLang('fr', undefined), 'it')
  assert.equal(W.tr('en', 'rp.cmp.colYear', { field: 'Premium', year: 2025 }), 'Premium 2025')
  assert.equal(W.tr('en', 'chiave.inesistente'), 'chiave.inesistente')
})

// ─── Revisione 26/09/2026 ────────────────────────────────────────────────────

test('PATCH: aggiunta parziale — le ammissibili entrano, le altre tornano col motivo', async () => {
  const { jobs, runs } = world()
  jobs.push(job('j9', 'Condominio Nuovo', { ...V.j7, num: 'TL009', iva: '00000000009' }))
  const out = await C.patchSummaryCore(svc, fakeDeps({ jobs, runs }), summaryRow({ job_ids: ['j6'] }), { addJobIds: ['j9', 'j5', 'j2'] })
  assert.equal(out.ok, true, JSON.stringify(out))
  assert.deepEqual(out.result.added, ['j9'])
  assert.deepEqual(out.result.refused.map((r) => [r.jobId, r.reason]), [['j5', 'other-profile'], ['j2', 'not-done']])
  assert.deepEqual(out.row.job_ids, ['j6', 'j9'])
})

test('estrazioni singole: firme dei campi salvate, la chiave resta stabile se le Impostazioni cambiano', async () => {
  const { runs } = world()
  const single = (id, name, vals) => job(id, name, vals, { profile_id: null, profile_name: null })
  const jobs = [single('s1', 'Singola 1', V.j1), single('s2', 'Singola 2', V.j6)]
  const created = await C.createSummaryCore(svc, fakeDeps({ jobs, runs }), { name: 'Singole', jobIds: ['s1', 's2'], mode: 'live' }, 'e')
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(created.row.profile_id, 'tl', 'stessi campi del profilo Tutela Legale')
  assert.deepEqual(created.row.field_sigs, [svc.fieldSig(FIELDS)])
  // oggi: nelle Impostazioni una copia non attiva del profilo e un campo tolto dall'originale
  const changed = [
    { ...PROFILES[0], fields: PROFILES[0].fields.filter((f) => f.id !== 'tas') },
    { id: 'tl-copia', name: 'Tutela Legale copia', enabled: false, fields: PROFILES[0].fields },
    PROFILES[1],
  ]
  const d = await detailOf(created.row, fakeDeps({ jobs, runs, profiles: changed }))
  assert.deepEqual(d.members.map((m) => m.state), ['ok', 'ok'], 'nessuna singola esce per «altro profilo»')
  // senza firme salvate (riepiloghi di prima) sarebbero uscite
  const before = await detailOf({ ...created.row, field_sigs: [] }, fakeDeps({ jobs, runs, profiles: changed }))
  assert.deepEqual(before.members.map((m) => `${m.state}/${m.reason}`), ['excluded/otherProfile', 'excluded/otherProfile'])
})

test('in ri-estrazione su un altro profilo: i campi della run (senza descrizioni) si completano dal profilo del riepilogo', async () => {
  const { jobs, runs } = world()
  // j2 rimesso in coda con «Riabbina» su Automatico: la chiave del job non c'è più, resta la run
  Object.assign(jobs.find((j) => j.id === 'j2'), { profile_id: 'auto', field_defs: [] })
  const d = await detailOf(summaryRow({ job_ids: ['j2'] }), fakeDeps({ jobs, runs }))
  assert.equal(d.members[0].state, 'stale')
  assert.equal(d.fields.find((f) => f.id === 'lor').kind, 'amount', 'senza descrizione sarebbe un testo')
  assert.equal(d.summary.yearFieldId, 'dec', '«Anno da» resta una data')
  // e la fotografia scattata ora ha i campi descritti (e congelati)
  const snap = await C.patchSummaryCore(svc, fakeDeps({ jobs, runs }), summaryRow({ job_ids: ['j2'] }), { mode: 'snapshot' })
  const lor = snap.row.snapshot.fieldDefs.find((f) => f.id === 'lor')
  assert.ok(lor.description, 'descrizione presente')
  assert.deepEqual(lor.frozen, { kind: 'amount', unit: 'eur', structural: false })
})

test('fotografia: i campi portano la classificazione congelata e i numeri non la rileggono dalla descrizione', async () => {
  const { jobs, runs } = world()
  const row = (await C.createSummaryCore(svc, fakeDeps({ jobs, runs }), { name: 'x', jobIds: ['j1', 'j6'], mode: 'snapshot' }, 'e')).row
  assert.ok(row.snapshot.fieldDefs.every((f) => f.frozen && f.frozen.kind), 'ogni campo congelato')
  const a = C.composeDetail(svc, { row, jobs: new Map(), runs: new Map(), profiles: PROFILES, today: TODAY })
  // un ritocco del motore/descrizione dopo la consegna: il campo congelato resta un importo
  const edited = clone(row)
  for (const f of edited.snapshot.fieldDefs) { f.description = 'Nota libera (es. testo)'; f.type = 'text' }
  const b = C.composeDetail(svc, { row: edited, jobs: new Map(), runs: new Map(), profiles: PROFILES, today: TODAY })
  assert.deepEqual(b.table, a.table)
  assert.deepEqual(b.dashboard.kpis, a.dashboard.kpis)
  assert.equal(b.fields.find((f) => f.id === 'lor').kind, 'amount')
})

test('changedColumns e memoDeps: un cambio di calcolo non riscrive fotografia ed elenco; letture una volta', async () => {
  const { jobs, runs } = world()
  const deps = fakeDeps({ jobs, runs })
  const row = (await C.createSummaryCore(svc, deps, { name: 'x', jobIds: ['j1', 'j6'], mode: 'snapshot' }, 'e')).row
  const out = await C.patchSummaryCore(svc, deps, row, { prefs: { tableRows: 'all' } })
  assert.deepEqual(Object.keys(C.changedColumns(row, out.row)), ['prefs'])
  const m = C.memoDeps(fakeDeps({ jobs, runs }))
  await m.loadJobs(['j1', 'j6'])
  await m.loadJobs(['j6', 'j1'])
  const inner = fakeDeps({ jobs, runs })
  const m2 = C.memoDeps(inner)
  await m2.loadJobs(['j1']); await m2.loadJobs(['j1']); await m2.loadRuns(['j2']); await m2.loadRuns(['j2'])
  assert.equal(inner.calls.loadJobs.length, 1)
  assert.equal(inner.calls.loadRuns.length, 1)
})

test('export: righe «polizze con il valore» dove mancano valori; cambio di gruppo per chiave', async () => {
  const { jobs, runs } = world()
  // 2025: j7 senza premio lordo; j6 con la compagnia scritta diversa da j1 (stessa chiave)
  jobs.find((j) => j.id === 'j7').rolling_state = rs({ ...V.j7, lor: '' })
  jobs.find((j) => j.id === 'j6').rolling_state = rs({ ...V.j6, cmp: 'G.E.N.E.R.A.L.I.' })
  jobs.find((j) => j.id === 'j1').rolling_state = rs({ ...V.j1, cmp: 'Generali' })
  const d = await detailOf(summaryRow({ prefs: { groupFieldId: 'cmp' } }), fakeDeps({ jobs, runs }), { values: 'all', prefsOverride: { tableRows: 'all' } })
  const wb = await reload(W.buildSummaryWorkbook({ detail: d, lang: 'it', svc }))
  const y = wb.getWorksheet('Per anno')
  const rows = []
  y.eachRow((r) => rows.push(r.values.slice(1)))
  const i = rows.findIndex((r) => r[0] === 'Premio lordo' && r[1] === 'polizze con il valore')
  assert.ok(i > 0, rows.map((r) => r.slice(0, 2).join(' | ')).join('\n'))
  assert.deepEqual(rows[i].slice(2, 5), [2, 1, 3], '2024: 2 su 2; 2025: 1 su 2; totale 3')
  assert.equal(rows[i][5], 'totali incompleti')
  assert.equal(rows[i - 1][0], 'Premio lordo', 'subito dopo le righe del campo')
  assert.ok(!rows.some((r) => r[0] === 'Imposte' && r[1] === 'polizze con il valore'), 'niente riga dove non manca nulla')
  const c = wb.getWorksheet('Confronto 2024-2025')
  const texts = []
  c.eachRow((r) => texts.push(r.values.slice(1).map((v) => (v == null ? '' : String(v))).join(' | ')))
  assert.ok(!texts.some((t) => t.includes('→ G.E.N.E.R.A.L.I.')), texts.join('\n'))
})
