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
import { defaultProgramConfig } from '@/lib/rsm/rules.js'
import type { RsmAnomaly, RsmCategory, RsmConfig } from '@/lib/rsm/types'

type FileTariffs = Record<string, { tariffs: RsmCategory['tariffs']; policy: string }>
interface Inspect { year: number | null; categories: string[]; tariffs: FileTariffs }
interface Dry {
  total: number
  counts: Record<string, { righe: number; titolari: number; entrate: number; uscite: number }>
  warnings: string[]
  anomalies: RsmAnomaly[]
}
type TKey = keyof RsmCategory['tariffs']
const TKEYS: TKey[] = ['titolare', 'quiescente', 'coniuge', 'figlio']
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x))
const TOP = /fuori dal periodo|Tariffa del titolare/

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

  /** Configurazione di partenza per il programma scelto, con le tariffe del file dove mancano. */
  function draftFor(targetId: string, y: number, ft: FileTariffs) {
    const base: RsmConfig = targetId === 'new'
      ? (defaultProgramConfig(y) as RsmConfig)
      : clone(programs.find((p) => p.id === targetId)!.config)
    base.categories = base.categories.map((c) => {
      const f = ft[c.key]
      if (!f) return c
      const tariffs = { ...c.tariffs }
      for (const k of TKEYS) if (!tariffs[k] && f.tariffs[k]) tariffs[k] = f.tariffs[k]
      return { ...c, tariffs, policy: c.policy || f.policy || '' }
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
      const same = editable.find((p) => p.year === y)
      const tgt = same ? same.id : 'new'
      const last = [...programs].sort((a, b) => b.year - a.year)[0]
      setInsp(j); setYear(y); setTarget(tgt)
      setNewName(last ? last.name.replace(/\b(19|20)\d{2}\b/, String(y)) : `RSM ${y}`)
      setCfg(draftFor(tgt, y, j.tariffs))
      setStep(2)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  function changeTarget(id: string) {
    setTarget(id)
    const p = programs.find((x) => x.id === id)
    if (p) setYear(p.year)
    if (insp) setCfg(draftFor(id, p ? p.year : year, insp.tariffs))
  }

  function copyPrev() {
    const prev = [...programs].filter((p) => p.year < year).sort((a, b) => b.year - a.year)[0]
    if (!prev || !cfg) return
    const by = new Map(prev.config.categories.map((c) => [c.key, c]))
    setCfg({ ...cfg, rules: { ...prev.config.rules }, categories: cfg.categories.map((c) => {
      const o = by.get(c.key)
      return o ? { ...c, tariffs: { ...o.tariffs }, quota: o.quota, mode: o.mode, policy: o.policy } : c
    }) })
  }
  const prevProgram = [...programs].filter((p) => p.year < year).sort((a, b) => b.year - a.year)[0]

  function useFile() {
    if (!cfg || !insp) return
    setCfg({ ...cfg, categories: cfg.categories.map((c) => {
      const f = insp.tariffs[c.key]
      return f ? { ...c, tariffs: { ...c.tariffs, ...f.tariffs }, policy: f.policy || c.policy } : c
    }) })
  }

  const setCat = (i: number, p: Partial<RsmCategory>) => setCfg((c) => c && { ...c, categories: c.categories.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  const usedCats = cfg ? cfg.categories.filter((c) => !insp || insp.categories.includes(c.key)) : []
  const missingTariff = usedCats.some((c) => !c.tariffs.titolare)

  /** Passo 2 → 3: crea o aggiorna il programma con queste tariffe, poi prova l'import. */
  async function toCheck() {
    if (!cfg || !file) return
    setBusy(true); setErr(null)
    try {
      let id = target
      const shift = (iso: string) => `${year}${iso.slice(4)}`
      const config = target === 'new' ? { ...cfg, periodStart: shift(cfg.periodStart), periodEnd: `${year + 1}${cfg.periodEnd.slice(4)}` } : cfg
      if (target === 'new') {
        const j = await api('/api/rsm/programs', 'POST', { name: newName.trim() || `RSM ${year}`, year })
        id = j.program.id
        await api(`/api/rsm/programs/${id}`, 'PUT', { name: j.program.name, year, config })
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
    setDry(j); setChoices({}); setReplaceOk(false)
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
            <div className="rsm-muted">{t('rsm.imp.fileIs', { f: file?.name || '', y: insp.year ?? '—', c: insp.categories.map(label).join(', ') })}</div>
            <div className="rsm-row">
              <label className="rsm-field">{t('rsm.imp.into')}
                <select value={target} onChange={(e) => changeTarget(e.target.value)} style={{ width: 300 }}>
                  {editable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value="new">{t('rsm.imp.newProgram')}</option>
                </select>
              </label>
              {target === 'new' && (
                <>
                  <label className="rsm-field" style={{ minWidth: 300 }}>{t('rsm.set.name')}<input value={newName} onChange={(e) => setNewName(e.target.value)} /></label>
                  <label className="rsm-field">{t('rsm.set.year')}<input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }} /></label>
                </>
              )}
            </div>
            {target !== 'new' && insp.year && programs.find((p) => p.id === target)?.year !== insp.year && (
              <div className="rsm-issue error">{t('rsm.imp.yearMismatch', { f: insp.year, p: programs.find((p) => p.id === target)?.year ?? '' })}</div>
            )}
          </div></div>

          <div className="rsm-box">
            <div className="rsm-box-head">
              <div><div className="rsm-box-title">{t('rsm.imp.tariffs')}</div><span className="rsm-note">{t('rsm.imp.tariffsHint')}</span></div>
              <div className="rsm-row" style={{ alignItems: 'center' }}>
                {Object.keys(insp.tariffs).length > 0 && <button className="btn btn-secondary" onClick={useFile}>{t('rsm.set.useFileTariffs')}</button>}
                {prevProgram && <button className="btn btn-secondary" onClick={copyPrev}>{t('rsm.imp.copyPrev', { name: prevProgram.name })}</button>}
              </div>
            </div>
            <div className="rsm-box-body rsm-scroll">
              <table className="rsm-cats">
                <thead><tr>
                  <th>{t('rsm.set.label')}</th><th>{t('rsm.set.policy')}</th><th>{t('rsm.set.mode')}</th>
                  <th>{t('rsm.set.tTit')}</th><th>{t('rsm.set.tQui')}</th><th>{t('rsm.set.tCo')}</th><th>{t('rsm.set.tFi')}</th><th>{t('rsm.set.quota')}</th>
                </tr></thead>
                <tbody>
                  {cfg.categories.map((c, i) => {
                    const f = insp.tariffs[c.key]
                    const inFile = insp.categories.includes(c.key)
                    const cell = (k: TKey, disabled = false) => {
                      const v = c.tariffs[k]
                      const fv = f?.tariffs[k]
                      return (
                        <td>
                          <input inputMode="decimal" aria-label={`${c.label} ${t(`rsm.set.t${k === 'titolare' ? 'Tit' : k === 'quiescente' ? 'Qui' : k === 'coniuge' ? 'Co' : 'Fi'}`)}`}
                            value={v ? String(v).replace('.', ',') : ''} disabled={disabled}
                            onChange={(e) => setCat(i, { tariffs: { ...c.tariffs, [k]: e.target.value === '' ? 0 : Number(e.target.value.replace(/\./g, '').replace(',', '.')) || 0 } })}
                            style={{ width: 92, borderColor: inFile && k === 'titolare' && !v ? 'var(--c-error)' : undefined }} />
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
                        {cell('titolare')}{cell('quiescente')}{cell('coniuge', c.mode === 'nucleo')}{cell('figlio', c.mode === 'nucleo')}
                        <td><input inputMode="decimal" value={c.quota ? String(c.quota).replace('.', ',') : ''} onChange={(e) => setCat(i, { quota: Number(e.target.value.replace(',', '.')) || 0 })} style={{ width: 70 }} aria-label={`${c.label} ${t('rsm.set.quota')}`} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {missingTariff && <div className="rsm-issue error" style={{ marginTop: 8 }}>{t('rsm.imp.missingTariff')}</div>}
              <div className="rsm-note" style={{ marginTop: 8 }}>{t('rsm.imp.rulesNote', { m: cfg.rules.prorata === 'mesi' ? t('rsm.pr.months') : t('rsm.pr.days'), tax: String(cfg.rules.refundTaxPct).replace('.', ',') })}</div>
            </div>
          </div>
          <div className="rsm-row">
            <button className="btn btn-secondary" onClick={() => { setStep(1); setFile(null); setInsp(null) }}>{t('rsm.imp.back')}</button>
            <button className="btn btn-primary" disabled={busy || missingTariff || (target === 'new' && !newName.trim())} onClick={toCheck}>{busy ? <span className="spinner" /> : t('rsm.imp.next')}</button>
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
