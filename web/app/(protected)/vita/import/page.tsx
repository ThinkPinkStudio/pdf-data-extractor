'use client'

// Import guidato dello stato di rischio, in tre passi, pensato perché lo facciano
// gli operatori da soli per QUALSIASI anno (il 2027 che verrà, o il 2017 per
// avere lo storico): si sceglie il file, il programma dell'anno si propone o si
// crea con contraenti, polizze e tassi presi dal file, poi si controlla e si
// importa. Niente viene salvato prima dell'ultimo passo, tranne il programma e
// le sue impostazioni al passaggio 2 → 3.
import Link from 'next/link'
import { useRef, useState } from 'react'
import { VitaHeader, api, eur, useFlash, useVita } from '@/components/vita/useVita'
import { CalcModeBox, CategoriesBox, MovementRulesBox } from '@/components/vita/VitaConfigParts'
import { clientOf, defaultVitaConfig } from '@/lib/vita/types'
import type { VitaCategory, VitaConfig, VitaProgram } from '@/lib/vita/types'

interface Inspect {
  sheets: string[]
  years: number[]
  companies: { name: string; policy: string; sheet: string }[]
  rates: Record<string, number>
  ratesFrom: string
  ratesN: number
  ratesMin: number | null
  ratesMax: number | null
  categories: { categories: VitaCategory[]; rights: number; countLastDay: boolean | null; from: string }
  byCategory: boolean
  hrEvents: number
  hrMonths: string[]
}
interface Dry {
  perCategory?: Record<string, number>
  noCategory?: number
  n: number
  perCompany: Record<string, number>
  premium: number
  warnings: string[]
  missingRal: number
  replaces?: number
  aggiornati?: number
  nuovi?: number
  fuoriDalFile?: number
  usciteDalFile?: number
  usciteAMano?: number
  noteAMano?: number
  docAMano?: number
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const n2 = (v: string) => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0
const normName = (v: string) => String(v || '').toUpperCase().replace(/[^A-Z0-9]+/g, '')
const titleCase = (v: string) => v.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())

/** Nome della polizza dal nome del file: «Agos_LTC_2026.xlsx» → «Agos LTC 2026». */
function nameFromFile(f: string, y: number) {
  let n = f.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim()
  n = n.replace(/^anagrafiche\s+/i, '')
  if (!n.includes(String(y))) n = `${n} ${y}`
  return n
}

/**
 * Quale programma dell'anno è quello del file: con più clienti e più polizze
 * nello stesso anno decide la somiglianza (numero di polizza, categorie, nomi
 * dei contraenti, modo di calcolo). Nessuna somiglianza = programma nuovo.
 */
function bestTarget(list: VitaProgram[], y: number, ins: Inspect): string {
  let best = 'new', score = 0
  const pols = new Set(ins.companies.map((c) => c.policy).filter(Boolean))
  const names = ins.companies.map((c) => normName(c.name))
  const cats = new Set(ins.categories.categories.map((c) => normName(c.name)))
  for (const p of list.filter((x) => x.year === y)) {
    const cat = p.config.rules.capitalMode === 'categoria'
    if (cat !== ins.byCategory) continue
    // categorie diverse = polizza diversa (LTC «DIPENDENTI» non è la Vita «QUADRO, DIRIGENTE»)
    const pc = (p.config.rules.categories || []).map((c) => normName(c.name))
    if (cat && cats.size && pc.length && !pc.some((n) => cats.has(n))) continue
    let sc = 1
    if (p.config.companies.some((c) => c.policy && pols.has(c.policy))) sc += 3
    if ((p.config.rules.categories || []).some((c) => cats.has(normName(c.name)))) sc += 2
    if (p.config.companies.some((c) => names.some((n) => n && (n.includes(normName(c.name)) || normName(c.name).includes(n))))) sc += 1
    if (sc > score) { score = sc; best = p.id }
  }
  return score >= 2 || (score === 1 && list.filter((x) => x.year === y).length === 1 && !ins.byCategory) ? best : 'new'
}

export default function VitaImportPage() {
  const vita = useVita()
  const [step, setStep] = useState(1)
  const [file, setFile] = useState<File | null>(null)
  const [insp, setInsp] = useState<Inspect | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [target, setTarget] = useState<string>('new')
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [cfg, setCfg] = useState<VitaConfig | null>(null)
  const [dry, setDry] = useState<Dry | null>(null)
  const [busy, setBusy] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [drag, setDrag] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const { setFlash, node: flashNode } = useFlash(vita)

  const editable = (vita.programs || []).filter((p) => p.editor)

  /** Configurazione di partenza: quella del programma scelto, o una nuova col file. */
  function draftFor(targetId: string, y: number, ins: Inspect): VitaConfig {
    const base = targetId === 'new'
      ? defaultVitaConfig(y)
      : clone(editable.find((p) => p.id === targetId)!.config)
    if (ins.byCategory) {
      // File per categoria (Agos): capitali, premi, diritti e scadenza letti dal file
      const c = ins.categories
      if (targetId === 'new') {
        base.rules = { ...base.rules, capitalMode: 'categoria', categories: c.categories, rights: c.rights, grossRounding: 'nessuno', rightsProRata: true, countLastDay: c.countLastDay ?? false, exitNextDay: true, minAge: 0, deathMaxAge: 99, ipMaxAge: 99 }
        base.rates = {}
        base.hrMonthly = true
        const seen = new Set<string>()
        base.companies = ins.companies.filter((f) => { const k = normName(f.name); if (seen.has(k)) return false; seen.add(k); return true })
          .map((f, i) => ({ key: `c${i + 1}`, name: titleCase(f.name), policy: f.policy }))
        if (!base.companies.length) base.companies = [{ key: 'c1', name: '', policy: '' }]
      } else if (!(base.rules.categories || []).length) {
        base.rules = { ...base.rules, capitalMode: 'categoria', categories: c.categories }
      }
      return base
    }
    // Contraenti e polizze dal file, dove mancano
    if (ins.companies.length) {
      const used = new Set<string>()
      base.companies = base.companies.map((c, i) => {
        const f = ins.companies[i]
        if (!f || used.has(f.sheet)) return c
        used.add(f.sheet)
        return { ...c, name: c.name || f.name, policy: c.policy || f.policy }
      })
      // Contraenti in più nel file (una terza società): si aggiungono
      for (const f of ins.companies) {
        if (used.has(f.sheet)) continue
        if (base.companies.some((c) => c.policy && c.policy === f.policy)) continue
        if (base.companies.length >= ins.companies.length) break
        base.companies.push({ key: `c${base.companies.length + 1}`, name: f.name, policy: f.policy })
      }
    }
    // Tassi dal file: senza, restano quelli copiati o quelli di base
    if (ins.ratesN > 0) base.rates = { ...ins.rates }
    return base
  }

  async function pick(f: File | null) {
    if (!f) return
    setFile(f); setErr(null); setBusy(true); setDry(null)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await fetch('/api/vita/inspect', { method: 'POST', body: fd })
      const j = (await r.json()) as Inspect & { error?: string }
      if (!r.ok) throw new Error(j.error || 'Errore')
      // Il file mensile delle risorse umane non è uno stato di rischio: va caricato da «File mensile».
      if (j.hrEvents > 0 && !j.companies.length) {
        setErr(null)
        setInsp(null)
        setStep(1)
        setFlash({ ok: false, text: `«${f.name}» è il file mensile del cliente (assunti, cessati, passaggi: ${j.hrMonths.join(', ')}). Si carica da «File mensile del cliente», non da qui.` })
        return
      }
      // L'anno del file: il più alto nominato dalle colonne RAL («RAL 2026 FULL TIME») o dai fogli («Rinnovo 2026»).
      const y = j.years.length ? j.years[j.years.length - 1] : new Date().getFullYear()
      const tgt = bestTarget(editable, y, j)
      const last = [...(vita.programs || [])].sort((a, b) => b.year - a.year)[0]
      setInsp(j); setYear(y); setTarget(tgt)
      const first = j.companies[0]?.name || ''
      setClient(j.byCategory ? titleCase(first.split(/\s+/)[0] || '') : (last ? clientOf(last) : ''))
      setName(j.byCategory ? nameFromFile(f.name, y) : last ? last.name.replace(/\b(19|20)\d{2}\b/, String(y)) : `Polizza Vita ${y}`)
      setCfg(draftFor(tgt, y, j))
      setStep(2)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  function changeTarget(id: string) {
    setTarget(id)
    const p = editable.find((x) => x.id === id)
    const y = p ? p.year : year
    if (p) setYear(y)
    if (insp) setCfg(draftFor(id, y, insp))
  }

  function changeYear(y: number) {
    setYear(y)
    const tgt = insp ? bestTarget(editable, y, insp) : 'new'
    setTarget(tgt)
    if (insp) setCfg(draftFor(tgt, y, insp))
    setName((n) => n.replace(/\b(19|20)\d{2}\b/, String(y)))
  }

  function copyFrom(id: string) {
    const src = editable.find((p) => p.id === id)
    if (!src || !cfg) return
    setCfg({ ...cfg, rules: clone(src.config.rules), rates: clone(src.config.rates), companies: clone(src.config.companies), mail: clone(src.config.mail), editors: src.config.editors })
  }

  const setCompany = (i: number, patch: Partial<VitaConfig['companies'][number]>) =>
    setCfg((c) => (c ? { ...c, companies: c.companies.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : c))
  const setRule = (k: keyof VitaConfig['rules'], v: number) => setCfg((c) => (c ? { ...c, rules: { ...c.rules, [k]: v } } : c))

  /** Passo 2 → 3: qui il programma si crea (o si aggiorna) davvero. */
  async function toCheck() {
    if (!cfg || !file) return
    setBusy(true); setErr(null)
    try {
      let id = target
      if (target === 'new') {
        const j = await api('/api/vita/programs', 'POST', { name: name.trim() || `Polizza Vita ${year}`, year, company: client.trim() })
        id = j.program.id
      }
      await api(`/api/vita/programs/${id}`, 'PUT', { name: target === 'new' ? name.trim() || `Polizza Vita ${year}` : undefined, year, config: cfg, company: target === 'new' ? client.trim() : undefined })
      await vita.reload()
      vita.setProgramId(id)
      setTarget(id)
      const fd = new FormData()
      fd.append('file', file)
      const r = await fetch(`/api/vita/programs/${id}/import`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Errore')
      setDry(j); setStep(3)
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  async function confirm() {
    if (!file || target === 'new') return
    setBusy(true); setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('confirm', '1')
      fd.append('mode', mode)
      const r = await fetch(`/api/vita/programs/${target}/import`, { method: 'POST', body: fd })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Errore')
      await vita.reload()
      setFlash({ ok: true, text: j.label || `Caricati ${j.n} assicurati`, opId: j.opId })
      setStep(1); setFile(null); setInsp(null); setDry(null); setCfg(null); setUnderstood(false); setMode('merge')
      if (fileRef.current) fileRef.current.value = ''
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  const gravi = dry ? dry.warnings.filter((w) => /RAL|tassi|contraente|intestazione|categoria/i.test(w) && !/numero di polizza/.test(w)) : []
  const altri = dry ? dry.warnings.filter((w) => !gravi.includes(w)) : []
  const catMode = cfg?.rules.capitalMode === 'categoria'
  const noRates = cfg && !catMode ? Object.keys(cfg.rates).length === 0 : false
  const badCats = catMode && (cfg?.rules.categories || []).some((c) => !c.name.trim() || !(c.capital > 0) || (!(Number(c.premium) > 0) && !(c.rate > 0)))
  const sameKind = editable.filter((p) => p.year !== year && (p.config.rules.capitalMode === 'categoria') === !!catMode && (!client.trim() || clientOf(p).toLowerCase() === client.trim().toLowerCase()))
  const prev = [...sameKind].sort((a, b) => Math.abs(a.year - year) - Math.abs(b.year - year))[0]

  return (
    <div className="rsm">
      <VitaHeader vita={vita} title="Importa lo stato di rischio">
        <Link className="btn btn-secondary" href="/vita">Vai allo stato di rischio</Link>
      </VitaHeader>
      {flashNode}
      {err && <div className="alert alert-error">{err}</div>}

      <ol className="rsm-steps">
        {['Scegli il file', 'Anno, polizze e tassi', 'Controlla e importa'].map((t, i) => (
          <li key={t} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}><span className="n">{step > i + 1 ? '✓' : i + 1}</span>{t}</li>
        ))}
      </ol>

      {step === 1 && (
        <div className="rsm-box">
          <div className="rsm-box-body">
            <p className="rsm-muted">Il file dell&apos;Azienda con un foglio per contraente. Dal file il programma legge l&apos;anno, i numeri di polizza e, se c&apos;è il foglio TASSI, anche i tassi per età. Vale per qualsiasi anno: quello nuovo o uno passato, per avere lo storico.</p>
            <div className={`rsm-drop${drag ? ' on' : ''}`} role="button" tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileRef.current?.click() }}
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] || null) }}>
              <p><b>Trascina qui il file Excel, oppure fai clic per sceglierlo</b></p>
              <p className="rsm-note">Es. «Elenco assicurati VITA 2026.xlsx»</p>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0] || null)} />
            {busy && <p className="rsm-note"><span className="spinner" /> Leggo il file…</p>}
          </div>
        </div>
      )}

      {step === 2 && insp && cfg && (
        <>
          <div className="rsm-box">
            <div className="rsm-box-body">
              {insp.byCategory ? (
                <p>«{file?.name}»: {insp.companies.length} {insp.companies.length === 1 ? 'contraente' : 'contraenti'}, capitali e premi per categoria dal foglio «{insp.categories.from}» ({insp.categories.categories.map((c) => c.name).join(', ')}). Niente RAL né tassi per età: il programma calcola per categoria.</p>
              ) : (
                <p>«{file?.name}»: {insp.companies.length} {insp.companies.length === 1 ? 'contraente' : 'contraenti'}{insp.years.length ? `, RAL ${insp.years.join(' e ')}` : ''}{insp.ratesN ? `, ${insp.ratesN} tassi per età (${insp.ratesMin}-${insp.ratesMax}) dal foglio «${insp.ratesFrom}»` : ', nessun foglio dei tassi'}.</p>
              )}
            </div>
          </div>

          <div className="rsm-grid2">
            <div className="rsm-box">
              <div className="rsm-box-head"><span className="rsm-box-title">Anno e programma</span></div>
              <div className="rsm-box-body">
                <div className="rsm-row">
                  <label className="rsm-field">Anno della polizza<input value={year} onChange={(e) => changeYear(Number(e.target.value) || year)} style={{ width: 100 }} /></label>
                  <label className="rsm-field" style={{ minWidth: 260 }}>Carica in
                    <select value={target} onChange={(e) => changeTarget(e.target.value)}>
                      {editable.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.year})</option>)}
                      <option value="new">Un programma nuovo…</option>
                    </select>
                  </label>
                </div>
                {target === 'new' && (
                  <div className="rsm-row">
                    <label className="rsm-field">Cliente<input value={client} onChange={(e) => setClient(e.target.value)} placeholder="es. Agos" style={{ width: 140 }} /></label>
                    <label className="rsm-field" style={{ minWidth: 260 }}>Nome della polizza<input value={name} onChange={(e) => setName(e.target.value)} /></label>
                  </div>
                )}
                {prev && <div className="rsm-row"><button className="btn btn-secondary" onClick={() => copyFrom(prev.id)}>Copia regole, tassi e polizze da «{prev.name}»</button></div>}
                <p className="rsm-note">Un programma per polizza e per anno; il cliente le raggruppa in una scheda. Scrivendo un anno che non esiste ancora si crea: così gli anni nuovi, o quelli passati per lo storico, si fanno da qui senza chiedere niente a nessuno.</p>
              </div>
            </div>

            <div className="rsm-box">
              <div className="rsm-box-head"><span className="rsm-box-title">Contraenti e polizze</span></div>
              <div className="rsm-box-body">
                {cfg.companies.map((c, i) => (
                  <div className="rsm-row" key={c.key}>
                    <label className="rsm-field">Contraente<input value={c.name} onChange={(e) => setCompany(i, { name: e.target.value })} style={{ width: 210 }} /></label>
                    <label className="rsm-field">Numero di polizza<input value={c.policy} onChange={(e) => setCompany(i, { policy: e.target.value })} style={{ width: 130 }} /></label>
                    {insp.companies[i]?.policy && insp.companies[i].policy !== c.policy && (
                      <button type="button" className="rsm-mini" style={{ alignSelf: 'flex-end', marginBottom: 2 }} onClick={() => setCompany(i, { policy: insp.companies[i].policy, name: insp.companies[i].name })}>dal file: {insp.companies[i].policy}</button>
                    )}
                  </div>
                ))}
                <p className="rsm-note">Il contraente di ogni riga si riconosce dal numero di polizza: se non combacia, la riga viene saltata e lo diciamo al passo dopo.</p>
              </div>
            </div>

            {catMode && <CalcModeBox cfg={cfg} setCfg={setCfg} />}
            {catMode && <MovementRulesBox cfg={cfg} setCfg={setCfg} />}
            {!catMode && <div className="rsm-box">
              <div className="rsm-box-head"><span className="rsm-box-title">Tassi per età</span><span className="rsm-note">{Object.keys(cfg.rates).length} età</span></div>
              <div className="rsm-box-body">
                {noRates ? (
                  <div className="rsm-issue error">Nessun tasso: senza non si calcolano i premi. Copiali da un altro anno o aggiungi al file il foglio TASSI (due colonne: età e tasso ‰).</div>
                ) : (
                  <p className="rsm-muted">{insp.ratesN ? `Presi dal foglio «${insp.ratesFrom}» del file.` : 'Quelli del programma: nel file non c’è il foglio dei tassi.'} Si correggono uno per uno in «Tassi e regole».</p>
                )}
                {insp.ratesN > 0 && <div className="rsm-row"><button className="btn btn-secondary" onClick={() => setCfg({ ...cfg, rates: { ...insp.rates } })}>Usa i {insp.ratesN} tassi del file</button></div>}
              </div>
            </div>}

            {!catMode && <div className="rsm-box">
              <div className="rsm-box-head"><span className="rsm-box-title">Regole del capitale</span></div>
              <div className="rsm-box-body">
                <div className="rsm-row">
                  <label className="rsm-field">Moltiplicatore RAL<input value={String(cfg.rules.multiplier).replace('.', ',')} onChange={(e) => setRule('multiplier', n2(e.target.value))} style={{ width: 90 }} /></label>
                  <label className="rsm-field">Figura chiave<input value={eur(cfg.rules.keyFigureCapital)} onChange={(e) => setRule('keyFigureCapital', n2(e.target.value))} style={{ width: 140 }} /></label>
                  <label className="rsm-field">Diritti<input value={String(cfg.rules.rights).replace('.', ',')} onChange={(e) => setRule('rights', n2(e.target.value))} style={{ width: 90 }} /></label>
                </div>
                <div className="rsm-row">
                  <label className="rsm-field">Senza documenti fino a<input value={eur(cfg.rules.noDocUpTo)} onChange={(e) => setRule('noDocUpTo', n2(e.target.value))} style={{ width: 140 }} /></label>
                  <label className="rsm-field">Visita fino a<input value={eur(cfg.rules.visitUpTo)} onChange={(e) => setRule('visitUpTo', n2(e.target.value))} style={{ width: 140 }} /></label>
                </div>
                <p className="rsm-note">Il resto (limiti di età, rimborsi, mail, accessi) si cambia in «Tassi e regole», anche dopo l&apos;import.</p>
              </div>
            </div>}
          </div>

          {catMode && <CategoriesBox cfg={cfg} setCfg={setCfg} />}
          {catMode && insp.byCategory && (
            <label className="rsm-rule" style={{ margin: '4px 0 12px' }}>
              <input type="checkbox" checked={!!cfg.hrMonthly} onChange={(e) => setCfg({ ...cfg, hrMonthly: e.target.checked })} />
              <span>La polizza si aggiorna col file mensile del cliente (assunti, cessati, passaggi di livello)<span className="rsm-help">Dopo questo import, ogni mese basta caricare il loro file in «File mensile del cliente».</span></span>
            </label>
          )}

          <div className="rsm-row">
            <button className="btn btn-primary" disabled={busy || noRates || !!badCats || (target === 'new' && !name.trim())} onClick={toCheck}>{busy ? <span className="spinner" /> : 'Avanti: controlla gli assicurati'}</button>
            <button className="btn btn-secondary" disabled={busy} onClick={() => { setStep(1); setFile(null); setInsp(null); setCfg(null) }}>Indietro</button>
          </div>
        </>
      )}

      {step === 3 && dry && (
        <>
          <div className="rsm-kpis">
            {(vita.cfg?.companies || []).map((c) => (
              <div className="rsm-kpi" key={c.key}>
                <div className="rsm-kpi-top"><span>{c.name}</span><span>{c.policy ? `pol. ${c.policy}` : ''}</span></div>
                <div className="rsm-kpi-num">{dry.perCompany[c.key] || 0}</div>
                <div className="rsm-kpi-line">assicurati nel file</div>
              </div>
            ))}
            {Object.entries(dry.perCategory || {}).map(([k, n]) => (
              <div className="rsm-kpi" key={`cat-${k}`}><div className="rsm-kpi-top"><span>{k}</span><span>categoria</span></div><div className="rsm-kpi-num">{n}</div><div className="rsm-kpi-line">in copertura oggi</div></div>
            ))}
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Premio lordo annuo</span></div><div className="rsm-kpi-num">{eur(dry.premium)}</div><div className="rsm-kpi-line">chi è nello stato di rischio a inizio anno, {catMode ? 'con capitali e premi delle categorie' : 'coi tassi del programma'}</div></div>
          </div>

          {gravi.map((w, i) => <div key={i} className="alert alert-error">{w}</div>)}

          {altri.length > 0 && (
            <div className="rsm-box">
              <details>
                <summary className="rsm-box-head" style={{ cursor: 'pointer', borderBottom: 0 }}>
                  <span className="rsm-box-title">{altri.length} {altri.length === 1 ? 'avviso' : 'avvisi'} sui dati del file</span>
                  <span className="rsm-note">Codici fiscali che non tornano: si importano lo stesso, conviene correggerli dopo.</span>
                </summary>
                <div className="rsm-box-body">{altri.map((w, i) => <div key={i} className="rsm-issue warning">{w}</div>)}</div>
              </details>
            </div>
          )}

          <div className="rsm-box">
            <div className="rsm-box-body">
              {dry.usciteDalFile ? <p>Nel file ci sono <b>{dry.usciteDalFile}</b> {dry.usciteDalFile === 1 ? 'uscita' : 'uscite'} dell&apos;anno, dai fogli delle movimentazioni.</p> : <p className="rsm-note">Nel file non ci sono uscite nei fogli delle movimentazioni.</p>}
              {!dry.replaces ? (
                <p>Pronti <b>{dry.n}</b> assicurati da caricare in «{vita.program?.name}».</p>
              ) : (
                <>
                  <p>In «{vita.program?.name}» ci sono già {dry.replaces} assicurati. Che cosa ne facciamo?</p>
                  <label className="rsm-field" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 13 }}>
                    <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} style={{ height: 16, width: 16, marginTop: 2 }} />
                    <span><b>Aggiorna</b> — {dry.aggiornati} assicurati si aggiornano col file, {dry.nuovi} sono nuovi{dry.fuoriDalFile ? `, ${dry.fuoriDalFile} non sono nel file e restano come sono` : ''}.
                      <span className="rsm-note" style={{ display: 'block' }}>Quello che il file non porta resta dov&apos;è: promemoria, accertamenti e check-up, RAL dell&apos;anno dopo, note scritte qui{dry.usciteAMano ? `, ${dry.usciteAMano} ${dry.usciteAMano === 1 ? 'uscita registrata' : 'uscite registrate'} a mano` : ''}{dry.noteAMano ? `, ${dry.noteAMano} ${dry.noteAMano === 1 ? 'nota scritta' : 'note scritte'} qui dentro` : ''}{dry.docAMano ? `, la documentazione segnata qui per ${dry.docAMano} ${dry.docAMano === 1 ? 'assicurato' : 'assicurati'}` : ''}. Se nel file cambiano due date non si rifà tutto.</span>
                    </span>
                  </label>
                  <label className="rsm-field" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 13 }}>
                    <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} style={{ height: 16, width: 16, marginTop: 2 }} />
                    <span><b>Sostituisci</b> — i {dry.replaces} assicurati di adesso vengono buttati e restano solo i {dry.n} del file.
                      <span className="rsm-note" style={{ display: 'block' }}>Si perde tutto quello che è stato scritto qui dentro.</span>
                    </span>
                  </label>
                  {mode === 'replace' && (
                    <label className="rsm-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 12.5, color: 'var(--c-error)' }}>
                      <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} style={{ height: 16, width: 16 }} />
                      Ho capito: sostituisce i {dry.replaces} assicurati già registrati in questo programma.
                    </label>
                  )}
                </>
              )}
              <div className="rsm-row">
                <button className="btn btn-primary" disabled={busy || !dry.n || (mode === 'replace' && !!dry.replaces && !understood)} onClick={confirm}>
                  {!dry.replaces ? `Importa ${dry.n} assicurati` : mode === 'merge' ? `Aggiorna ${dry.aggiornati}${dry.nuovi ? ` e aggiungi ${dry.nuovi}` : ''}` : `Sostituisci con ${dry.n} assicurati`}
                </button>
                <button className="btn btn-secondary" disabled={busy} onClick={() => setStep(2)}>Indietro</button>
              </div>
              <p className="rsm-note">Il programma e le sue impostazioni sono già salvati; gli assicurati si caricano solo adesso. L&apos;import si annulla dal messaggio di conferma, finché è l&apos;ultima operazione.</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
