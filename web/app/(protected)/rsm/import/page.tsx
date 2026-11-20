'use client'

// Import guidato dello stato di rischio, in tre passi:
//  1) si sceglie il file: il programma legge anno, categorie, tariffe e polizze;
//  2) si controlla dove va (programma dell'anno, o uno nuovo) e con quali
//     tariffe, già compilate dal file o dall'anno precedente;
//  3) si vedono assicurati, avvisi e anomalie da chiarire, poi si importa.
import Link from 'next/link'
import { useRef, useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { RsmHeader, api, eur, useFlash, useRsm } from '@/components/rsm/useRsm'
import NumInput from '@/components/rsm/NumInput'
import ValueInput from '@/components/ValueInput'
import { describeValue } from '@/lib/configValue.js'
import { AddVariant, Variants, tariffColumns } from '@/components/rsm/SettingsParts'
import { buildLayout, defaultProgramConfig, legamiOf, normCategory, normHeadText, normLegame, sameFileCompany, sheetCategory, tariffKeys, refundTaxOf } from '@/lib/rsm/rules.js'
import { ColumnMap, missingFields, type MapCol } from '@/components/rsm/ColumnMap'
import { programName } from '@/lib/rsm/types'
import type { RsmAnomaly, RsmCategory, RsmConfig, RsmFileLayout } from '@/lib/rsm/types'

type FileTariffs = Record<string, { tariffs: RsmCategory['tariffs']; policy: string }>
interface InspectCols { sheet: string | null; guessed?: boolean; columns: { col: number; head: string; norm: string; field: string | null; saved: boolean; samples: string[]; values: string[] }[] }
interface Inspect { year: number | null; company: string; categories: string[]; fileCategories: RsmCategory[]; tariffs: FileTariffs; sheets: string[]; columns: InspectCols }
interface Dry {
  total: number
  counts: Record<string, { righe: number; titolari: number; entrate: number; uscite: number }>
  warnings: string[]
  anomalies: RsmAnomaly[]
}
type TKey = string
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
// Avvisi da mostrare SUBITO, non fra quelli minori: riguardano come il file è stato
// letto o numeri che non tornano con il programma, non il singolo dato di una persona.
const TOP = /fuori dal periodo|Tariffa del titolare|intestazione|numero di polizza/

export default function RsmImportPage() {
  const { t } = useI18n()
  const rsm = useRsm()
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [file, setFile] = useState<File | null>(null)
  const [drag, setDrag] = useState(false)
  const [insp, setInsp] = useState<Inspect | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [target, setTarget] = useState<string>('new')
  const [newName, setNewName] = useState('')
  const [newCompany, setNewCompany] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [copySrc, setCopySrc] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  // Colonne del file e codici della società (tracciato, ricordato per i file dopo)
  const [cols, setCols] = useState<MapCol[]>([])
  const [catCodes, setCatCodes] = useState<Record<string, string>>({})
  const [legCodes, setLegCodes] = useState<Record<string, string>>({})
  const [colOpen, setColOpen] = useState(false)
  const [cfg, setCfg] = useState<RsmConfig | null>(null)
  const [dry, setDry] = useState<Dry | null>(null)
  const [choices, setChoices] = useState<Record<string, string>>({})
  const [replaceOk, setReplaceOk] = useState(false)
  const [existing, setExisting] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<Dry | null>(null)
  const { setFlash, node: flashNode } = useFlash(rsm)
  const programs = rsm.programs || []
  const editable = programs.filter((p) => p.editor)

  /**
   * Tracciato di partenza: quello del programma scelto, altrimenti l'ultimo
   * della stessa società. Le colonne che il programma riconosce da solo restano
   * scelte; le altre (e i codici mai visti) le indica l'operatore.
   */
  function layoutFor(targetId: string, co: string): RsmFileLayout | null {
    const t0 = programs.find((p) => p.id === targetId)
    if (t0?.config.fileLayout) return t0.config.fileLayout
    return [...programs].filter((p) => p.company === co && p.config.fileLayout).sort((a, b) => b.year - a.year)[0]?.config.fileLayout || null
  }
  function initMap(ic: InspectCols, layout: RsmFileLayout | null, categories: RsmCategory[]) {
    const lc = (layout && layout.columns) || {}
    const next: MapCol[] = ic.columns.map((c) => ({ ...c, auto: c.field, field: lc[c.norm] || c.field, saved: !!lc[c.norm] }))
    setCols(next)
    const catCol = next.find((c) => c.field === 'categoria'), legCol = next.find((c) => c.field === 'legame')
    const cc: Record<string, string> = {}
    for (const v of catCol ? catCol.values : []) {
      const saved = layout?.categoryCodes?.[normHeadText(v)]
      const auto = normCategory(v, categories)
      cc[v] = saved || (auto.key ? `${auto.key}${auto.quiescente ? '|Q' : ''}` : '')
    }
    const lg: Record<string, string> = {}
    for (const v of legCol ? legCol.values : []) lg[v] = layout?.legameCodes?.[normHeadText(v)] || normLegame(v, null, cfg) || ''
    setCatCodes(cc); setLegCodes(lg)
    setColOpen(!!ic.guessed || next.some((c) => !c.field && c.values.length > 0) || missingFields(next, true).length > 0)
  }
  // codici delle colonne ricalcolati quando l'operatore cambia la colonna di categoria o legame
  function setColsAndCodes(next: MapCol[]) {
    setCols(next)
    const catCol = next.find((c) => c.field === 'categoria'), legCol = next.find((c) => c.field === 'legame')
    if (catCol) setCatCodes(Object.fromEntries(catCol.values.map((v) => { const a = normCategory(v, cfg?.categories || []); return [v, catCodes[v] ?? (a.key ? `${a.key}${a.quiescente ? '|Q' : ''}` : '')] })))
    if (legCol) setLegCodes(Object.fromEntries(legCol.values.map((v) => [v, legCodes[v] ?? (normLegame(v, null, cfg) || '')])))
  }

  /**
   * Categoria del file (un foglio di assicurati) che corrisponde a una
   * categoria del programma: nome del foglio contro etichetta e nomi nei file.
   */
  const fileFor = (c: RsmCategory, conf: RsmConfig | null = cfg, ins: Inspect | null = insp) =>
    (ins?.fileCategories || []).find((fc) => conf && sheetCategory(fc.label, conf).key === c.key) || null

  /**
   * Configurazione di partenza per il programma scelto, con le tariffe del file
   * dove mancano. Un programma NUOVO le cui categorie di partenza non
   * corrispondono a nessun foglio del file prende le categorie del file
   * (Amundi: «SGR Dipendenti», «Real Estate Dirigenti»…).
   */
  function draftFor(targetId: string, y: number, ins: Inspect) {
    const base: RsmConfig = targetId === 'new'
      ? (defaultProgramConfig(y) as RsmConfig)
      : clone(programs.find((p) => p.id === targetId)!.config)
    // file con categorie sue: un foglio senza corrispondenza esatta, o due fogli
    // sulla stessa categoria («SGR Dirigenti» e «Real Estate Dirigenti» su «Dirigenti»)
    const fc = ins.fileCategories || []
    const strictKeys = fc.map((x) => sheetCategory(x.label, base, true).key)
    if (targetId === 'new' && fc.length && (strictKeys.some((k) => !k) || new Set(strictKeys).size < strictKeys.length)) {
      base.categories = fc.map((x) => ({ ...clone(x), words: x.words || x.label }))
      return base
    }
    base.categories = base.categories.map((c) => {
      const f = fileFor(c, base, ins)
      if (!f) return c
      const tariffs = { ...c.tariffs }
      for (const k of tariffKeys(base) as string[]) if (!tariffs[k] && f.tariffs[k]) tariffs[k] = f.tariffs[k]
      return { ...c, tariffs, policy: c.policy || f.policy || '', variants: c.variants && c.variants.length ? c.variants : f.variants }
    })
    return base
  }

  async function pick(f: File | null) {
    if (!f) return
    setFile(f); setErr(null); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await fetch('/api/rsm/inspect', { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Errore')
      const y = j.year || new Date().getFullYear()
      // Società di partenza: quella che il file nomina (colonna AZIENDA), se un
      // programma l'ha già vista; il file senza società va nella società aperta;
      // un nome mai visto propone una società nuova, mai quella aperta.
      const fileCo = String(j.company || '').trim()
      const known = fileCo ? programs.find((p) => sameFileCompany(p.config.fileCompany || '', fileCo)) : null
      // Un file che non dice di chi è non va mai, di default, a sostituire gli
      // assicurati di un programma che ne ha già: si propone un programma nuovo
      // e la società la scrive l'operatore (17/11/2026, file senza AZIENDA).
      const open = rsm.company || ''
      const openSame = editable.find((p) => p.year === y && p.company === open)
      const openHasRows = !!openSame && (openSame.id !== rsm.programId || rsm.members.length > 0)
      const co = known ? known.company : fileCo ? fileCo : (openHasRows ? '' : open)
      const same = editable.find((p) => p.year === y && p.company === co)
      const tgt = same && (known || !co || same.id !== openSame?.id || !openHasRows) ? same.id : 'new'
      setInsp(j); setYear(y); setTarget(tgt)
      setNewCompany(co); setNameTouched(false); setCopied(null)
      setNewName(co ? programName(co, y) : `RSM ${y}`)
      setCopySrc(defaultSource(tgt, co, y))
      const draft = draftFor(tgt, y, j)
      setCfg(draft)
      initMap(j.columns || { sheet: null, columns: [] }, layoutFor(tgt, co), draft.categories)
      setStep(2)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  function changeTarget(id: string) {
    setTarget(id)
    setCopied(null)
    const p = programs.find((x) => x.id === id)
    if (p) setYear(p.year)
    setCopySrc(defaultSource(id, p ? p.company : newCompany, p ? p.year : year))
    if (insp) {
      const draft = draftFor(id, p ? p.year : year, insp)
      setCfg(draft)
      initMap(insp.columns || { sheet: null, columns: [] }, layoutFor(id, p ? p.company : newCompany), draft.categories)
    }
  }

  /**
   * Da dove copiare di default: l'anno prima della stessa società, altrimenti
   * il programma più recente di un'altra società del gruppo (stessi conteggi).
   */
  function defaultSource(targetId: string, co: string, y: number) {
    const others = programs.filter((p) => p.id !== targetId)
    const sameCo = others.filter((p) => p.company === co && p.year < y).sort((a, b) => b.year - a.year)[0]
    if (sameCo) return sameCo.id
    return [...others].sort((a, b) => b.year - a.year)[0]?.id || ''
  }
  const sources = programs.filter((p) => p.id !== target)

  /**
   * Copia da un altro programma tutto ciò che decide i conteggi: categorie
   * (nomi, polizze, premio a nucleo o a persona, tariffe, quote), regole di
   * calcolo, mail e chi può modificare. Le persone no: arrivano dal file.
   */
  function copyFromProgram(id: string) {
    const src = programs.find((p) => p.id === id)
    if (!src || !cfg) return
    setCfg({
      ...cfg,
      categories: src.config.categories.map((c) => ({ ...c, tariffs: { ...c.tariffs } })),
      rules: { ...src.config.rules },
      mail: { ...src.config.mail },
      editors: [...(src.config.editors || [])],
      fileCompany: cfg.fileCompany, // come il file chiama QUESTA società: non si copia
    })
    setCopied(src.name)
  }

  function changeCompany(v: string) {
    setNewCompany(v)
    if (!nameTouched) setNewName(v.trim() ? programName(v, year) : `RSM ${year}`)
    setCopySrc(defaultSource(target, v.trim(), year))
  }
  function changeYear(y: number) {
    setYear(y)
    if (!nameTouched && newCompany.trim()) setNewName(programName(newCompany, y))
  }

  function useFile() {
    if (!cfg || !insp) return
    setCfg({ ...cfg, categories: cfg.categories.map((c) => {
      const f = fileFor(c)
      return f ? { ...c, tariffs: { ...c.tariffs, ...f.tariffs }, policy: f.policy || c.policy, variants: f.variants && f.variants.length ? f.variants : c.variants } : c
    }) })
  }

  /** Categorie del file che il programma non ha: si aggiungono (o, per un programma nuovo, sostituiscono quelle di partenza). */
  function addFileCategories(replace: boolean) {
    if (!cfg) return
    const taken = new Set(replace ? [] : cfg.categories.map((c) => c.key))
    const add = missingCats.map((x) => {
      let key = x.key, n = 2
      while (taken.has(key)) key = `${x.key}-${n++}`
      taken.add(key)
      return { ...clone(x), key, words: x.words || x.label }
    })
    setCfg({ ...cfg, categories: replace ? add : [...cfg.categories, ...add] })
  }

  const setCat = (i: number, p: Partial<RsmCategory>) => setCfg((c) => c && { ...c, categories: c.categories.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  const codedCats = new Set(Object.values(catCodes).filter(Boolean).map((v) => v.split('|')[0]))
  // categorie del programma che hanno un foglio nel file (con le regole del programma: nomi, sigle, nomi nei file)
  const sheetKeys = new Set(cfg && insp ? (insp.sheets || []).map((n) => sheetCategory(n, cfg).key).filter(Boolean) as string[] : [])
  const missingCats = cfg && insp ? (insp.fileCategories || []).filter((fc) => !sheetCategory(fc.label, cfg, true).key) : []
  const usedCats = cfg ? cfg.categories.filter((c) => !insp || sheetKeys.has(c.key) || codedCats.has(c.key)) : []
  const categorySheets = sheetKeys.size > 0
  const colsMissing = cols.length ? missingFields(cols, categorySheets) : []
  const missingTariff = usedCats.some((c) => !c.tariffs.titolare)

  /** Passo 2 → 3: crea o aggiorna il programma con queste tariffe, poi prova l'import. */
  async function toCheck() {
    if (!cfg || !file) return
    setBusy(true); setErr(null)
    try {
      let id = target
      const shift = (iso: string) => `${year}${iso.slice(4)}`
      const fileLayout = cols.length ? buildLayout({
        sheet: insp?.columns?.sheet || '', columns: cols,
        categoryCodes: categorySheets ? {} : catCodes, legameCodes: legCodes,
      }) as RsmFileLayout : cfg.fileLayout || null
      const base = { ...cfg, fileCompany: insp?.company || cfg.fileCompany || '', fileLayout }
      const config = target === 'new' ? { ...base, periodStart: shift(cfg.periodStart), periodEnd: `${year + 1}${cfg.periodEnd.slice(4)}` } : base
      if (target === 'new') {
        const j = await api('/api/rsm/programs', 'POST', { company: newCompany.trim(), name: newName.trim() || `RSM ${year}`, year })
        id = j.program.id
        await api(`/api/rsm/programs/${id}`, 'PUT', { company: j.program.company, name: j.program.name, year, config })
      } else {
        const p = programs.find((x) => x.id === id)!
        await api(`/api/rsm/programs/${id}`, 'PUT', { name: p.name, year: p.year, config })
      }
      rsm.setProgramId(id)
      setTarget(id)
      const cur = await api(`/api/rsm/programs/${id}`, 'GET')
      setExisting(cur.members.length)
      await runDry(id, {})
      await rsm.reload()
      setStep(3)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function runDry(id: string, res: Record<string, string>, confirm = false) {
    const fd = new FormData()
    fd.append('file', file!)
    fd.append('resolutions', JSON.stringify(res))
    if (confirm) fd.append('confirm', '1')
    const r = await fetch(`/api/rsm/programs/${id}/import`, { method: 'POST', body: fd })
    const j = await r.json()
    if (!r.ok) throw new Error(j.error || 'Errore')
    if (confirm) return j as Dry
    setDry(j); setReplaceOk(false)
    // risposte proposte dalle note del file: pre-selezionate, l'operatore le vede e può cambiarle
    setChoices(Object.fromEntries((j.anomalies as RsmAnomaly[]).filter((a) => a.suggest).map((a) => [a.key, a.suggest as string])))
    return j as Dry
  }

  async function doImport() {
    setBusy(true); setErr(null)
    try {
      const j = await runDry(target, choices, true) as Dry & { opId?: string }
      setDone(j)
      setFlash({ ok: true, text: t('rsm.imp.done', { n: j.total }), opId: j.opId })
      await rsm.reload()
      setStep(4)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const label = (k: string) => cfg?.categories.find((c) => c.key === k)?.label || k
  const open = dry ? dry.anomalies.filter((a) => !choices[a.key]).length : 0
  const topWarnings = dry ? dry.warnings.filter((w) => TOP.test(w)) : []
  const otherWarnings = dry ? dry.warnings.filter((w) => !TOP.test(w)) : []
  const canImport = !!dry && open === 0 && (existing === 0 || replaceOk) && !busy

  const steps = [t('rsm.imp.s1'), t('rsm.imp.s2'), t('rsm.imp.s3')]
  return (
    <div className="rsm">
      <RsmHeader rsm={rsm} title={t('rsm.imp.title')} />
      <ol className="rsm-steps" aria-label={t('rsm.imp.title')}>
        {steps.map((s, i) => (
          <li key={s} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined}>
            <span className="n">{step > i + 1 ? '✓' : i + 1}</span>{s}
          </li>
        ))}
      </ol>
      {err && <div className="alert alert-error">{err}</div>}

      {step === 1 && (
        <div className="rsm-box"><div className="rsm-box-body">
          <p className="rsm-muted" style={{ margin: 0 }}>{t('rsm.imp.intro')}</p>
          <div
            className={`rsm-drop${drag ? ' on' : ''}`}
            role="button" tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] || null) }}
          >
            {busy ? <span className="spinner" /> : <><b>{t('rsm.imp.drop')}</b><span className="rsm-note">{t('rsm.imp.dropHint')}</span></>}
          </div>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => pick(e.target.files?.[0] || null)} />
        </div></div>
      )}

      {step === 2 && cfg && insp && (
        <>
          <div className="rsm-box"><div className="rsm-box-body">
            <div className="rsm-muted">{t('rsm.imp.fileIs', { f: file?.name || '', y: insp.year ?? '—', c: [...new Set([...sheetKeys, ...codedCats])].map(label).join(', ') || '—' })}</div>
            <div className="rsm-row">
              <label className="rsm-field">{t('rsm.imp.into')}
                <select value={target} onChange={(e) => changeTarget(e.target.value)} style={{ width: 300 }}>
                  {editable.map((p) => <option key={p.id} value={p.id}>{p.company} · {p.year}</option>)}
                  <option value="new">{t('rsm.imp.newProgram')}</option>
                </select>
              </label>
              {target === 'new' && (
                <>
                  <label className="rsm-field" style={{ minWidth: 260 }}>{t('rsm.company')}
                    <input value={newCompany} list="rsm-companies" placeholder={t('rsm.companyPh')} onChange={(e) => changeCompany(e.target.value)} />
                  </label>
                  <datalist id="rsm-companies">{rsm.companies.map((c) => <option key={c} value={c} />)}</datalist>
                  <label className="rsm-field">{t('rsm.set.year')}<input type="number" value={year} onChange={(e) => changeYear(Number(e.target.value))} style={{ width: 100 }} /></label>
                  <label className="rsm-field" style={{ minWidth: 300 }}>{t('rsm.set.name')}<input value={newName} onChange={(e) => { setNameTouched(true); setNewName(e.target.value) }} /></label>
                </>
              )}
            </div>
            {target === 'new' && insp.company && !rsm.companies.includes(newCompany.trim()) && rsm.companies.length > 0 && (
              <div className="rsm-note">{t('rsm.imp.fileCompany', { c: insp.company })}</div>
            )}
            {target !== 'new' && insp.year && programs.find((p) => p.id === target)?.year !== insp.year && (
              <div className="rsm-issue error">{t('rsm.imp.yearMismatch', { f: insp.year, p: programs.find((p) => p.id === target)?.year ?? '' })}</div>
            )}
          </div></div>

          {cols.length > 0 && (
            <ColumnMap legami={legamiOf(cfg)} cols={cols} setCols={setColsAndCodes} cats={cfg.categories} catCodes={catCodes} setCatCodes={setCatCodes}
              legCodes={legCodes} setLegCodes={setLegCodes} guessed={!!insp.columns?.guessed} categorySheets={categorySheets}
              open={colOpen} setOpen={setColOpen} />
          )}

          {sources.length > 0 && (
            <div className="rsm-box">
              <div className="rsm-box-head">
                <div><div className="rsm-box-title">{t('rsm.imp.copyTitle')}</div><span className="rsm-note">{t('rsm.imp.copyHint')}</span></div>
              </div>
              <div className="rsm-box-body">
                <div className="rsm-row" style={{ alignItems: 'center' }}>
                  <select aria-label={t('rsm.set.copyFrom')} value={copySrc} onChange={(e) => setCopySrc(e.target.value)} style={{ height: 36, width: 320, fontSize: 13, padding: '0 10px' }}>
                    {sources.map((p) => <option key={p.id} value={p.id}>{p.company} · {p.year}</option>)}
                  </select>
                  <button className="btn btn-primary" disabled={!copySrc} onClick={() => copyFromProgram(copySrc)}>{t('rsm.set.copyBtn')}</button>
                </div>
                {copied && <div className="alert alert-success" style={{ margin: 0 }}>{t('rsm.imp.copied', { name: copied })}</div>}
              </div>
            </div>
          )}

          <div className="rsm-box">
            <div className="rsm-box-head">
              <div><div className="rsm-box-title">{t('rsm.imp.tariffs')}</div><span className="rsm-note">{t('rsm.imp.tariffsHint')}</span></div>
              <div className="rsm-row" style={{ alignItems: 'center' }}>
                {cfg.categories.some((c) => fileFor(c)) && <button className="btn btn-secondary" onClick={useFile}>{t('rsm.set.useFileTariffs')}</button>}
              </div>
            </div>
            <div className="rsm-box-body rsm-scroll">
              {missingCats.length > 0 && (
                <div className="rsm-issue warning" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>{t('rsm.imp.fileCats', { c: missingCats.map((x) => x.label).join(', ') })}</span>
                  <button className="rsm-mini" onClick={() => addFileCategories(false)}>{t('rsm.imp.fileCatsAdd')}</button>
                  {target === 'new' && <button className="rsm-mini" onClick={() => addFileCategories(true)}>{t('rsm.imp.fileCatsUse')}</button>}
                </div>
              )}
              {!missingCats.length && target === 'new' && (insp.fileCategories || []).length > 0 && cfg.categories.every((c) => (insp.fileCategories || []).some((x) => x.label === c.label)) && (
                <div className="rsm-note">{t('rsm.imp.fileCatsAuto', { c: cfg.categories.map((c) => c.label).join(', ') })}</div>
              )}
              <table className="rsm-cats">
                <thead><tr>
                  <th>{t('rsm.set.label')}</th><th>{t('rsm.set.policy')}</th><th>{t('rsm.set.mode')}</th>
                  {tariffColumns(cfg, t).map((col) => <th key={col.key}>{col.label}</th>)}<th>{t('rsm.set.quota')}</th>
                </tr></thead>
                <tbody>
                  {cfg.categories.map((c, i) => {
                    const f = fileFor(c)
                    const inFile = sheetKeys.has(c.key) || codedCats.has(c.key)
                    const cols = tariffColumns(cfg, t)
                    const cell = (k: TKey, disabled = false) => {
                      const v = c.tariffs[k]
                      const fv = f?.tariffs[k] as number | undefined
                      return (
                        <td key={k}>
                          <ValueInput value={v} disabled={disabled} width={80}
                            bases={cols.filter((o) => o.key !== k).map((o) => ({ key: o.key, label: o.label }))}
                            label={`${c.label} ${cols.find((o) => o.key === k)?.label || k}`}
                            onChange={(n) => setCat(i, { tariffs: { ...c.tariffs, [k]: n } })} />
                          {inFile && k === 'titolare' && !v ? <div className="rsm-sub" style={{ color: 'var(--c-error)' }}>!</div> : null}
                          {fv && fv !== v ? <button type="button" className="rsm-mini" style={{ marginTop: 4 }} onClick={() => setCat(i, { tariffs: { ...c.tariffs, [k]: fv } })}>{t('rsm.imp.fileVal', { v: eur(fv) })}</button> : null}
                        </td>
                      )
                    }
                    return (
                      <tr key={c.key} style={{ opacity: inFile ? 1 : 0.55 }}>
                        <td><b>{c.label}</b>{!inFile && <div className="rsm-sub">{t('rsm.imp.notInFile')}</div>}</td>
                        <td>
                          <input value={c.policy} onChange={(e) => setCat(i, { policy: e.target.value })} style={{ width: 120 }} aria-label={`${c.label} ${t('rsm.set.policy')}`} />
                          {f?.policy && f.policy !== c.policy ? <button type="button" className="rsm-mini" style={{ marginTop: 4 }} onClick={() => setCat(i, { policy: f.policy })}>{t('rsm.imp.fileVal', { v: f.policy })}</button> : null}
                        </td>
                        <td>{t(c.mode === 'nucleo' ? 'rsm.set.nucleo' : 'rsm.set.persona')}</td>
                        {cols.map((col) => cell(col.key, c.mode === 'nucleo' && col.family))}
                        <td><ValueInput value={c.quota} onChange={(n) => setCat(i, { quota: n })} width={60} bases={[{ key: 'premio', label: t('rsm.set.premioTit') }]} label={`${c.label} ${t('rsm.set.quota')}`} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {cfg.categories.map((c, i) => c.variants && c.variants.length ? <Variants key={`cv${i}`} cfg={cfg} cat={c} ro={false} onChange={(variants) => setCat(i, { variants })} /> : null)}
              <AddVariant cfg={cfg} ro={false} onAdd={(i) => setCat(i, { variants: [...(cfg.categories[i].variants || []), { key: `cop${Date.now().toString(36)}`, label: '', words: '', tariffs: {} }] })} />
              {missingTariff && <div className="rsm-issue error" style={{ marginTop: 8 }}>{t('rsm.imp.missingTariff')}</div>}
              <div className="rsm-note" style={{ marginTop: 8 }}>{t('rsm.imp.rulesNote', { m: cfg.rules.prorata === 'mesi' ? t('rsm.pr.months') : t('rsm.pr.days'), tax: describeValue(refundTaxOf(cfg), { rimborso: t('rsm.set.refundGross') }) })}</div>
            </div>
          </div>
          <div className="rsm-row">
            <button className="btn btn-secondary" onClick={() => { setStep(1); setFile(null); setInsp(null) }}>{t('rsm.imp.back')}</button>
            <button className="btn btn-primary" disabled={busy || missingTariff || colsMissing.length > 0 || (target === 'new' && (!newName.trim() || !newCompany.trim()))} onClick={toCheck}>{busy ? <span className="spinner" /> : t('rsm.imp.next')}</button>
          </div>
        </>
      )}

      {step === 3 && dry && cfg && (
        <>
          <div className="rsm-kpis">
            {Object.entries(dry.counts).map(([k, c]) => (
              <div key={k} className="rsm-kpi">
                <div className="rsm-kpi-top"><span>{label(k)}</span><span>{cfg.categories.find((x) => x.key === k)?.policy ? t('rsm.pol', { n: cfg.categories.find((x) => x.key === k)!.policy }) : ''}</span></div>
                <div className="rsm-kpi-num">{t('rsm.st.heads', { n: c.righe })}</div>
                <div className="rsm-kpi-line">{t('rsm.imp.kpi', { t: c.titolari, e: c.entrate, u: c.uscite })}</div>
              </div>
            ))}
          </div>
          {topWarnings.map((w, i) => <div key={i} className="alert alert-error">{w}</div>)}

          {dry.anomalies.length > 0 && (
            <div className="rsm-box">
              <div className="rsm-box-head"><div className="rsm-box-title" style={{ color: 'var(--c-warning)' }}>{t('rsm.set.anomTitle', { n: dry.anomalies.length })}</div><span className="rsm-note">{t('rsm.set.anomHint')}</span></div>
              <div className="rsm-box-body">
                {dry.anomalies.length > 1 && (
                  <div className="rsm-row" style={{ alignItems: 'center' }}>
                    <span className="rsm-note">{t('rsm.imp.allAs')}</span>
                    {[...new Set(dry.anomalies.flatMap((a) => a.options))].map((o) => (
                      <button key={o} className="rsm-mini" onClick={() => setChoices(Object.fromEntries(dry.anomalies.filter((a) => a.options.includes(o)).map((a) => [a.key, o])))}>{t(`rsm.imp.opt.${o}`)}</button>
                    ))}
                  </div>
                )}
                {dry.anomalies.map((a) => (
                  <div key={a.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 10, borderBottom: '1px solid var(--c-separator)' }}>
                    <div style={{ fontSize: 13 }}>{a.text}</div>
                    {a.people.length > 1 && <div className="rsm-sub">{t('rsm.set.anomPeople', { p: a.people.join(', ') })}</div>}
                    {a.suggest && <div className="rsm-sub" style={{ color: 'var(--c-info)' }}>{t('rsm.imp.suggested', { o: t(`rsm.imp.opt.${a.suggest}`), n: a.suggestNote || '' })}</div>}
                    <div className="rsm-row" role="radiogroup" aria-label={a.text}>
                      {a.options.map((o) => (
                        <label key={o} className="rsm-muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input type="radio" name={a.key} checked={choices[a.key] === o} onChange={() => setChoices((c) => ({ ...c, [a.key]: o }))} />
                          {t(`rsm.set.anom.${a.type}.${o}`)}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {otherWarnings.length > 0 && (
            <div className="rsm-box">
              <details>
                <summary className="rsm-box-head" style={{ cursor: 'pointer', borderBottom: 0 }}>
                  <span className="rsm-box-title">{t('rsm.imp.warnTitle', { n: otherWarnings.length })}</span>
                  <span className="rsm-note">{t('rsm.imp.warnHint')}</span>
                </summary>
                <div className="rsm-box-body">{otherWarnings.map((w, i) => <div key={i} className="rsm-issue warning">{w}</div>)}</div>
              </details>
            </div>
          )}

          <div className="rsm-box"><div className="rsm-box-body">
            <div className="rsm-sum"><span>{t('rsm.imp.ready', { n: dry.total, p: rsm.programs?.find((p) => p.id === target)?.name || '' })}</span></div>
            {existing > 0 && (
              <label className="rsm-muted" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--c-error)' }}>
                <input type="checkbox" checked={replaceOk} onChange={(e) => setReplaceOk(e.target.checked)} />{t('rsm.imp.replace', { n: existing })}
              </label>
            )}
            {open > 0 && <div className="rsm-issue warning">{t('rsm.imp.openLeft', { n: open })}</div>}
            <div className="rsm-row">
              <button className="btn btn-secondary" onClick={() => setStep(2)}>{t('rsm.imp.back')}</button>
              <button className="btn btn-primary" disabled={!canImport} onClick={doImport}>{busy ? <span className="spinner" /> : t('rsm.imp.go', { n: dry.total })}</button>
            </div>
          </div></div>
        </>
      )}

      {step === 4 && done && (
        <div className="rsm-box"><div className="rsm-box-body">
          {flashNode}
          <div className="rsm-sum">{Object.entries(done.counts).map(([k, c]) => <span key={k}>{label(k)}: <b>{c.righe}</b></span>)}</div>
          <div className="rsm-row">
            <Link className="btn btn-primary" href="/rsm">{t('rsm.imp.toStato')}</Link>
            <Link className="btn btn-secondary" href="/rsm/variazioni">{t('rsm.st.register')}</Link>
          </div>
        </div></div>
      )}
    </div>
  )
}
