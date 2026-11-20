import { NextRequest, NextResponse } from 'next/server'
import { logAction } from '@/lib/logger'
import { deleteProgram, listMembers, updateProgram } from '@/lib/rsm/store'
import { LAYOUT_FIELDS, legamiOf } from '@/lib/rsm/rules.js'
import type { ConfigValue, RsmConfig } from '@/lib/rsm/types'
import { fail, guard } from '@/lib/rsm/server'

export const runtime = 'nodejs'

// Un programma con tutte le sue righe. Gli importi li calcola la pagina con le
// stesse regole (lib/rsm/rules.js), così la «situazione al» cambia senza
// richieste al server.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, false)
  if (!g.ok) return g.res
  const members = await listMembers(params.id)
  return NextResponse.json({ program: g.program, members, editor: g.editor })
}

const num = (v: unknown) => (v === '' || v == null ? 0 : Math.max(0, Number(v) || 0))
/** Valore configurabile ripulito: numero, o { mode, value, of } con basi brevi. */
const cval = (v: unknown): ConfigValue => {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as { mode?: string; value?: unknown; of?: unknown }
    if (o.mode === 'percentuale' || o.mode === 'permille') return { mode: o.mode, value: num(o.value), of: (Array.isArray(o.of) ? o.of : []).slice(0, 20).map((x) => String(x).slice(0, 40)).filter(Boolean) }
    return { mode: 'fisso', value: num(o.value) }
  }
  return num(v)
}
const cleanTariffs = (t: unknown, keys: string[]) => Object.fromEntries(keys.map((k) => [k, cval((t as Record<string, unknown> | undefined)?.[k])]))
const str = (v: unknown, max: number) => String(v ?? '').slice(0, max)
const legKey = (v: unknown) => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12)
const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)

/** Tracciato del file della società, ripulito: solo campi noti, stringhe brevi. */
function cleanLayout(l: RsmConfig['fileLayout']): RsmConfig['fileLayout'] {
  if (!l || typeof l !== 'object') return null
  const FIELDS = new Set([...LAYOUT_FIELDS, 'extra', 'skip'])
  const obj = (o: unknown, ok: (v: string) => boolean) => Object.fromEntries(Object.entries((o && typeof o === 'object' ? o : {}) as Record<string, unknown>)
    .slice(0, 200).map(([k, v]) => [String(k).slice(0, 120), String(v ?? '')]).filter(([k, v]) => k && ok(v)))
  const columns = obj(l.columns, (v) => FIELDS.has(v))
  if (!Object.keys(columns).length) return null
  return {
    sheet: String(l.sheet || '').slice(0, 120),
    columns,
    categoryCodes: obj(l.categoryCodes, (v) => /^[a-z0-9-]+(\|Q)?$/.test(v)),
    legameCodes: obj(l.legameCodes, (v) => /^[A-Z0-9]{1,12}$/.test(v)),
    order: (Array.isArray(l.order) ? l.order : []).slice(0, 80).map((h) => String(h).slice(0, 120)),
  }
}

/** Configurazione dal client, ripulita: numeri, date, categorie con chiave. */
function cleanConfig(c: RsmConfig): RsmConfig | null {
  const periodStart = iso(c?.periodStart), periodEnd = iso(c?.periodEnd)
  if (!periodStart || !periodEnd || periodEnd <= periodStart) return null
  // legami: il titolare c'è sempre; chiavi uniche; tariffa = chiave della colonna
  const legami = legamiOf({ legami: (Array.isArray(c.legami) ? c.legami : []).slice(0, 30).map((l) => ({
    key: legKey(l.key), label: String(l.label || '').trim().slice(0, 60) || legKey(l.key),
    tariff: legKey(l.key) === 'TI' ? 'titolare' : (String(l.tariff || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '') || legKey(l.key).toLowerCase()).slice(0, 30),
    words: String(l.words || '').slice(0, 400), maxAge: l.maxAge == null || (l.maxAge as unknown) === '' ? null : Math.round(num(l.maxAge)) || null,
  })).filter((l) => l.key), rules: c.rules })
  if (new Set(legami.map((l) => l.key)).size !== legami.length || new Set(legami.map((l) => l.tariff)).size !== legami.length) return null
  const tKeys = ['titolare', 'quiescente', ...legami.filter((l) => l.key !== 'TI').map((l) => l.tariff)]
  const categories = (c.categories || []).map((x, i) => ({
    key: String(x.key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || `cat${i + 1}`,
    label: String(x.label || x.key || '').trim(),
    policy: String(x.policy || '').trim(),
    mode: x.mode === 'persona' ? 'persona' as const : 'nucleo' as const,
    rank: Number(x.rank) || i + 1,
    tariffs: cleanTariffs(x.tariffs, tKeys),
    quota: cval(x.quota),
    tariffBy: x.tariffBy === 'eta' ? 'eta' as const : 'unica' as const,
    ageBands: (Array.isArray(x.ageBands) ? x.ageBands : []).slice(0, 20).map((b) => ({
      upTo: b.upTo == null || (b.upTo as unknown) === '' ? null : Math.max(0, Math.round(Number(b.upTo) || 0)),
      ...cleanTariffs(b, tKeys),
    })),
    words: str(x.words, 400),
    // coperture con premio diverso: solo le tariffe indicate (le altre restano quelle della categoria)
    variants: (Array.isArray(x.variants) ? x.variants : []).slice(0, 20).map((v, j) => ({
      key: String(v.key || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || `cop${j + 1}`,
      label: str(v.label, 120).trim(),
      words: str(v.words, 400),
      tariffs: Object.fromEntries(tKeys.filter((k) => v.tariffs && v.tariffs[k] != null && (v.tariffs[k] as unknown) !== '').map((k) => [k, cval(v.tariffs[k])])),
    })).filter((v) => v.label || v.words),
  }))
  if (!categories.length) return null
  // chiavi doppie (categoria aggiunta con la chiave di un'altra): la PRIMA tiene
  // la chiave, che è quella delle righe già registrate; le altre, nuove, la
  // cambiano. Prima il salvataggio si rifiutava e non si salvava più nulla.
  const seen = new Set<string>()
  for (const x of categories) {
    let k = x.key, n = 2
    while (seen.has(k)) k = `${x.key}-${n++}`
    x.key = k
    seen.add(k)
  }
  const r = c.rules || ({} as RsmConfig['rules'])
  return {
    periodStart, periodEnd, categories,
    rules: {
      firstSemesterEnd: /^\d{2}-\d{2}$/.test(String(r.firstSemesterEnd)) ? r.firstSemesterEnd : '06-30',
      secondSemesterPct: Math.min(100, num(r.secondSemesterPct ?? 50)),
      prorata: r.prorata === 'mesi' ? 'mesi' : 'giorni',
      refundTaxPct: num(r.refundTaxPct),
      notifyDays: Math.round(num(r.notifyDays ?? 30)),
      coverUntilPeriodEnd: r.exitMode === 'rimborso' ? false : r.coverUntilPeriodEnd !== false,
      maxAge: Math.round(num(r.maxAge ?? 80)),
      entryMode: r.entryMode === 'prorata' || r.entryMode === 'intero' ? r.entryMode : 'semestri',
      decorrenzaMode: r.decorrenzaMode === 'mese' ? 'mese' : 'data',
      exitMode: r.exitMode === 'rimborso' ? 'rimborso' : 'fineAnno',
      childMaxAge: Math.round(num(r.childMaxAge)),
      ...(Array.isArray(r.entrySteps) && r.entrySteps.length ? { entrySteps: r.entrySteps.slice(0, 24).map((x) => ({ until: /^\d{2}-\d{2}$/.test(String(x.until)) ? x.until : '12-31', value: cval(x.value) })) } : {}),
      ...(r.refundTax != null ? { refundTax: cval(r.refundTax) } : {}),
      quotaWho: r.quotaWho === 'tutti' ? 'tutti' : 'titolare',
      quotaMode: r.quotaMode === 'comePremio' ? 'comePremio' : 'intera',
      quotaRefund: !!r.quotaRefund,
      promotionEntry: r.promotionEntry === 'comeEntrata' ? 'comeEntrata' : 'prorata',
    },
    legami,
    words: {
      yes: str(c.words?.yes, 400), promoNotes: str(c.words?.promoNotes, 400), cessNotes: str(c.words?.cessNotes, 400), varSheet: str(c.words?.varSheet, 200),
      heads: Object.fromEntries(Object.entries((c.words?.heads && typeof c.words.heads === 'object' ? c.words.heads : {}) as Record<string, unknown>)
        .filter(([k]) => (LAYOUT_FIELDS as string[]).includes(k)).map(([k, v]) => [k, str(v, 400)]).filter(([, v]) => v)),
    },
    mail: { cc: String(c.mail?.cc || '').trim(), signature: String(c.mail?.signature || ''), ...Object.fromEntries((['subject', 'greeting', 'intro', 'askAll', 'askSome', 'closing'] as const).map((k) => [k, str(c.mail?.[k], 2000)]).filter(([, v]) => v)) },
    editors: (c.editors || []).map((e) => String(e).trim().toLowerCase()).filter((e) => /@/.test(e)),
    fileCompany: String(c.fileCompany || '').trim().slice(0, 120),
    excelLabels: str(c.excelLabels, 8000),
    fileLayout: cleanLayout(c.fileLayout),
  }
}

/**
 * Perché una configurazione non si può salvare, in parole dell'operatore: cosa
 * non va e dove si corregge. Il pannello di avviso della pagina li mostra uno
 * per uno (20/11/2026: un rifiuto senza spiegazione sembrava una perdita di dati).
 */
function configProblems(c: RsmConfig): { text: string; fix: string }[] {
  const out: { text: string; fix: string }[] = []
  const ps = iso(c?.periodStart), pe = iso(c?.periodEnd)
  if (!ps || !pe) out.push({ text: 'Mancano le date del periodo di polizza.', fix: 'In alto nelle Impostazioni compila «Copertura dal» e «al».' })
  else if (pe <= ps) out.push({ text: `La fine del periodo non viene dopo l'inizio (${ps.split('-').reverse().join('/')}).`, fix: 'In alto nelle Impostazioni metti in «al» una data successiva a «Copertura dal».' })
  const legs = (Array.isArray(c?.legami) ? c.legami : []).map((l) => ({ key: legKey(l.key), label: String(l.label || l.key || '').trim(), tariff: String(l.tariff || '').trim().toLowerCase() }))
  const dupKey = legs.filter((l, i) => l.key && legs.findIndex((x) => x.key === l.key) !== i)
  for (const l of dupKey) out.push({ text: `Due legami del nucleo hanno la stessa sigla «${l.key}».`, fix: 'In «Legami del nucleo» dai a ogni legame una sigla diversa.' })
  const dupTar = legs.filter((l, i) => l.tariff && legs.findIndex((x) => x.tariff === l.tariff) !== i)
  for (const l of dupTar) out.push({ text: `Due legami del nucleo usano la stessa colonna di tariffa («${l.label || l.tariff}»).`, fix: 'In «Legami del nucleo» togli il legame doppio o cambiagli il nome.' })
  if (!Array.isArray(c?.categories) || !c.categories.length) out.push({ text: 'Il programma non ha nessuna categoria.', fix: 'In «Categorie, polizze e tariffe» premi «Aggiungi categoria» e dagli un nome.' })
  return out
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  const body = (await req.json().catch(() => ({}))) as { company?: string; name?: string; year?: number; config?: RsmConfig }
  const config = cleanConfig(body.config as RsmConfig)
  if (!config) {
    const problems = configProblems(body.config as RsmConfig)
    if (!problems.length) problems.push({ text: 'Le impostazioni inviate non sono leggibili.', fix: 'Ricarica la pagina e rifai le modifiche; se succede ancora, scrivi a info@omeganodes.ai.' })
    return NextResponse.json({ error: 'Le impostazioni non sono state salvate.', code: 'invalid', problems }, { status: 400 })
  }
  // chi salva non può togliersi da solo il diritto di modifica
  if (config.editors && config.editors.length && !config.editors.includes(g.email.toLowerCase())) config.editors.push(g.email.toLowerCase())
  const name = String(body.name || g.program.name).trim()
  const year = Number(body.year) || g.program.year
  const company = String(body.company ?? g.program.company).trim() || g.program.company
  const p = await updateProgram(params.id, company, name, year, config)
  await logAction({ email: g.email, action: 'rsm.program.update', resource: params.id })
  return NextResponse.json({ program: p })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(params.id, true)
  if (!g.ok) return g.res
  await deleteProgram(params.id)
  await logAction({ email: g.email, action: 'rsm.program.delete', resource: params.id, metadata: { name: g.program.name } })
  return NextResponse.json({ ok: true })
}
