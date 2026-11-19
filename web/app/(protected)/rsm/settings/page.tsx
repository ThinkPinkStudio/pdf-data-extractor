'use client'

// Impostazioni RSM: programmi (un cliente per un anno), categorie con polizza
// e tariffe, regole di calcolo, mail, chi può modificare, import dello stato
// di rischio dal file del cliente.
import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { useConfirmPanel } from '@/components/ConfirmPanel'
import { RsmHeader, api, useRsm } from '@/components/rsm/useRsm'
import ValueInput from '@/components/ValueInput'
import { AgeBands, ComparePanel, EntrySteps, ExampleBox, LayoutSummary, LegamiBox, MailTexts, RuleChoices, WordsBox, tariffColumns } from '@/components/rsm/SettingsParts'
import { addDays, legamiOf, refundTaxOf } from '@/lib/rsm/rules.js'
import Link from 'next/link'
import { programName } from '@/lib/rsm/types'
import type { ConfigValue, RsmCategory, RsmConfig } from '@/lib/rsm/types'


export default function RsmSettingsPage() {
  const { t } = useI18n()
  const rsm = useRsm()
  const { ask, panel } = useConfirmPanel()
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [year, setYear] = useState(0)
  const [cfg, setCfg] = useState<RsmConfig | null>(null)
  const [editors, setEditors] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [nw, setNw] = useState({ company: '', name: '', year: new Date().getFullYear(), copyFrom: '' })
  const [nwTouched, setNwTouched] = useState(false)
  // Prova prima di salvare: la configurazione nuova in attesa di conferma.
  const [pending, setPending] = useState<RsmConfig | null>(null)
  /** Nuovo programma: il nome segue società e anno finché non lo si scrive a mano. */
  const setNew = (p: Partial<typeof nw>) => setNw((x) => {
    const n = { ...x, ...p }
    if (!nwTouched && ('company' in p || 'year' in p)) n.name = n.company.trim() ? programName(n.company, n.year) : ''
    return n
  })

  useEffect(() => {
    if (!rsm.program) return
    setCompany(rsm.program.company)
    setName(rsm.program.name)
    setYear(rsm.program.year)
    setCfg(JSON.parse(JSON.stringify(rsm.program.config)))
    setEditors((rsm.program.config.editors || []).join('\n'))
  }, [rsm.program])

  const ro = !!rsm.program && !rsm.editor
  // «Copia dall'anno precedente»: un altro programma, di default quello dell'anno prima.
  const others = (rsm.programs || []).filter((p) => p.id !== rsm.programId)
  const [copySrc, setCopySrc] = useState('')
  useEffect(() => {
    const prev = others.find((p) => p.year === year - 1) || others.sort((a, b) => b.year - a.year)[0]
    setCopySrc(prev?.id || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rsm.programs, rsm.programId, year])

  /** Mette nel modulo (non salva) tariffe, quote, polizze e regole di un altro programma. */
  function copyFrom(id: string) {
    const src = others.find((p) => p.id === id)
    if (!src || !cfg) return
    const byKey = new Map(src.config.categories.map((c) => [c.key, c]))
    const categories = cfg.categories.map((c) => {
      const o = byKey.get(c.key)
      return o ? { ...c, tariffs: { ...o.tariffs }, quota: o.quota, mode: o.mode, policy: o.policy, rank: o.rank, tariffBy: o.tariffBy, ageBands: (o.ageBands || []).map((b) => ({ ...b })) } : c
    })
    for (const o of src.config.categories) if (!categories.some((c) => c.key === o.key)) categories.push({ ...o, tariffs: { ...o.tariffs } })
    setCfg({ ...cfg, categories, rules: { ...src.config.rules }, legami: legamiOf(src.config) })
    setMsg({ ok: true, text: t('rsm.set.copied', { name: src.name }) })
  }

  const setRule = (k: keyof RsmConfig['rules'], v: unknown) => setCfg((c) => c && { ...c, rules: { ...c.rules, [k]: v } })
  const setCat = (i: number, p: Partial<RsmCategory>) => setCfg((c) => c && { ...c, categories: c.categories.map((x, j) => (j === i ? { ...x, ...p } : x)) })
  const setTariff = (i: number, k: string, v: ConfigValue) => setCfg((c) => c && { ...c, categories: c.categories.map((x, j) => (j === i ? { ...x, tariffs: { ...x.tariffs, [k]: v } } : x)) })

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg(null)
    try { await fn(); setMsg({ ok: true, text: ok }); await rsm.reload() } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  const fullConfig = (): RsmConfig => ({ ...cfg!, editors: editors.split(/[\s,;]+/).filter(Boolean) })
  const doSave = (config: RsmConfig) => run(async () => {
    await api(`/api/rsm/programs/${rsm.programId}`, 'PUT', { company, name, year, config })
    setPending(null)
  }, t('rsm.saved'))
  /** Salva: con assicurati registrati e importi che cambiano, prima mostra cosa cambia. */
  function save() {
    const next = fullConfig()
    if (rsm.program && rsm.members.length && JSON.stringify({ c: next.categories, r: next.rules, p: [next.periodStart, next.periodEnd] }) !== JSON.stringify({ c: rsm.program.config.categories, r: rsm.program.config.rules, p: [rsm.program.config.periodStart, rsm.program.config.periodEnd] })) {
      setPending(next)
      return
    }
    doSave(next)
  }

  async function create() {
    setBusy(true); setMsg(null)
    try {
      const j = await api('/api/rsm/programs', 'POST', { company: nw.company, name: nw.name, year: nw.year, copyFrom: nw.copyFrom || undefined })
      rsm.setProgramId(j.program.id)
      setNw({ ...nw, company: '', name: '' }); setNwTouched(false)
      setMsg({ ok: true, text: t('rsm.set.created') })
      await rsm.reload()
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }


  async function remove() {
    if (!(await ask(t('rsm.set.deleteAsk', { name: rsm.program!.name }), { danger: true, okLabel: t('rsm.delete') }))) return
    run(async () => { await api(`/api/rsm/programs/${rsm.programId}`, 'DELETE'); try { localStorage.removeItem('rsmProgram') } catch { /* ignora */ } window.location.reload() }, t('rsm.set.deleted'))
  }

  return (
    <div className="rsm">
      <RsmHeader rsm={rsm} title={t('rsm.set.title')} />
      {msg && <div className={`alert ${msg.ok ? 'alert-success' : 'alert-error'}`}>{msg.text}</div>}

      {rsm.program && cfg && (
        <>
          <div className="rsm-box">
            <div className="rsm-box-head"><div className="rsm-box-title">{t('rsm.set.program')}</div>{ro && <span className="rsm-pill off">{t('rsm.readOnly')}</span>}</div>
            <div className="rsm-box-body">
              <div className="rsm-row">
                <label className="rsm-field" style={{ minWidth: 260 }}>{t('rsm.company')}<input value={company} disabled={ro} list="rsm-companies-set" onChange={(e) => setCompany(e.target.value)} /></label>
                <datalist id="rsm-companies-set">{rsm.companies.map((c) => <option key={c} value={c} />)}</datalist>
                <label className="rsm-field" style={{ minWidth: 300 }}>{t('rsm.set.name')}<input value={name} disabled={ro} onChange={(e) => setName(e.target.value)} /></label>
                <label className="rsm-field">{t('rsm.set.year')}<input type="number" value={year} disabled={ro} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 100 }} /></label>
                <label className="rsm-field w-date">{t('rsm.set.from')}<input type="date" value={cfg.periodStart} disabled={ro} onChange={(e) => setCfg({ ...cfg, periodStart: e.target.value })} /></label>
                <label className="rsm-field w-date">{t('rsm.set.until')}<input type="date" value={addDays(cfg.periodEnd, -1) || ''} disabled={ro} onChange={(e) => e.target.value && setCfg({ ...cfg, periodEnd: addDays(e.target.value, 1)! })} /></label>
              </div>
            </div>
          </div>

          <LegamiBox cfg={cfg} ro={ro} onChange={(legami) => setCfg({ ...cfg, legami })} />

          <div className="rsm-box">
            <div className="rsm-box-head">
              <div><div className="rsm-box-title">{t('rsm.set.cats')}</div><span className="rsm-note">{t('rsm.set.catsHint')}</span></div>
              {!ro && others.length > 0 && (
                <div className="rsm-row" style={{ alignItems: 'center' }}>
                  <select aria-label={t('rsm.set.copyFrom')} value={copySrc} onChange={(e) => setCopySrc(e.target.value)} style={{ height: 34, width: 240, fontSize: 12.5, padding: '0 8px' }}>
                    {others.map((p) => <option key={p.id} value={p.id}>{p.company} · {p.year}</option>)}
                  </select>
                  <button className="btn btn-secondary" disabled={!copySrc} onClick={() => copyFrom(copySrc)}>{t('rsm.set.copyBtn')}</button>
                </div>
              )}
            </div>
            <div className="rsm-box-body rsm-scroll">
              <table className="rsm-cats">
                <thead><tr>
                  <th>{t('rsm.set.label')}</th><th>{t('rsm.set.policy')}</th><th>{t('rsm.set.mode')}</th><th>{t('rsm.set.tariffBy')}</th>{tariffColumns(cfg, t).map((c) => <th key={c.key}>{c.label}</th>)}<th>{t('rsm.set.quota')}</th><th>{t('rsm.set.rank')}</th><th />
                </tr></thead>
                <tbody>
                  {cfg.categories.map((c, i) => (
                    <tr key={i}>
                      <td><input value={c.label} disabled={ro} onChange={(e) => setCat(i, { label: e.target.value })} style={{ width: 130 }} /></td>
                      <td><input value={c.policy} disabled={ro} onChange={(e) => setCat(i, { policy: e.target.value })} style={{ width: 100 }} /></td>
                      <td><select value={c.mode} disabled={ro} onChange={(e) => setCat(i, { mode: e.target.value as RsmCategory['mode'] })} style={{ width: 120 }}>
                        <option value="nucleo">{t('rsm.set.nucleo')}</option><option value="persona">{t('rsm.set.persona')}</option>
                      </select></td>
                      <td><select value={c.tariffBy === 'eta' ? 'eta' : 'unica'} disabled={ro} onChange={(e) => setCat(i, e.target.value === 'eta' ? { tariffBy: 'eta', ageBands: c.ageBands && c.ageBands.length ? c.ageBands : [{ ...c.tariffs, upTo: null }] } : { tariffBy: 'unica' })} style={{ width: 120 }} aria-label={`${c.label} ${t('rsm.set.tariffBy')}`}>
                        <option value="unica">{t('rsm.set.byOne')}</option><option value="eta">{t('rsm.set.byAge')}</option>
                      </select></td>
                      {c.tariffBy === 'eta' ? <td colSpan={tariffColumns(cfg, t).length} className="rsm-sub">{t('rsm.ab.title', { c: c.label })} ↓</td> : tariffColumns(cfg, t).map((col) => (
                        <td key={col.key}><ValueInput value={c.tariffs[col.key]} disabled={ro || (c.mode === 'nucleo' && col.family)} onChange={(v) => setTariff(i, col.key, v)} width={64}
                          bases={tariffColumns(cfg, t).filter((o) => o.key !== col.key).map((o) => ({ key: o.key, label: o.label }))} label={`${c.label} ${col.label}`} /></td>
                      ))}
                      <td><ValueInput value={c.quota} disabled={ro} onChange={(v) => setCat(i, { quota: v })} width={60} bases={[{ key: 'premio', label: t('rsm.set.premioTit') }]} label={`${c.label} ${t('rsm.set.quota')}`} /></td>
                      <td><input type="number" value={c.rank} disabled={ro} onChange={(e) => setCat(i, { rank: Number(e.target.value) })} style={{ width: 60 }} /></td>
                      <td>{!ro && cfg.categories.length > 1 && <button className="rsm-mini danger" aria-label={t('rsm.delete')} onClick={() => setCfg({ ...cfg, categories: cfg.categories.filter((_, j) => j !== i) })}>×</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cfg.categories.map((c, i) => c.tariffBy === 'eta' ? <AgeBands key={`ab${i}`} cfg={cfg} cat={c} ro={ro} onChange={(ageBands) => setCat(i, { ageBands })} /> : null)}
              {!ro && <div><button className="btn btn-secondary" onClick={() => setCfg({ ...cfg, categories: [...cfg.categories, { key: `cat${cfg.categories.length + 1}`, label: '', policy: '', mode: 'persona', rank: cfg.categories.length + 1, tariffs: {}, quota: 0 }] })}>{t('rsm.set.addCat')}</button></div>}
            </div>
          </div>

          <div className="rsm-grid2">
            <div className="rsm-box">
              <div className="rsm-box-head"><div className="rsm-box-title">{t('rsm.set.rules')}</div></div>
              <div className="rsm-box-body">
                <div className="rsm-row">
                  <label className="rsm-field">{t('rsm.set.notify')}<input type="number" value={cfg.rules.notifyDays} disabled={ro} onChange={(e) => setRule('notifyDays', Number(e.target.value))} style={{ width: 90 }} /></label>
                  <label className="rsm-field" title={t('rsm.set.maxAgeHint')}>{t('rsm.set.maxAge')}<input type="number" value={cfg.rules.maxAge ?? 80} disabled={ro} onChange={(e) => setRule('maxAge', Number(e.target.value))} style={{ width: 90 }} /></label>
                </div>
                <div className="rsm-row">
                  <label className="rsm-field">{t('rsm.set.prorata')}
                    <select value={cfg.rules.prorata} disabled={ro} onChange={(e) => setRule('prorata', e.target.value)} style={{ width: 200 }}>
                      <option value="giorni">{t('rsm.set.prDays')}</option><option value="mesi">{t('rsm.set.prMonths')}</option>
                    </select>
                  </label>
                  <label className="rsm-field">{t('rsm.set.tax')}<ValueInput value={refundTaxOf(cfg)} disabled={ro} onChange={(v) => setRule('refundTax', v)} bases={[{ key: 'rimborso', label: t('rsm.set.refundGross') }]} /></label>
                </div>
                {(cfg.rules.entryMode || 'semestri') === 'semestri' && <EntrySteps cfg={cfg} ro={ro} onChange={(steps) => setRule('entrySteps', steps)} />}
                <RuleChoices cfg={cfg} ro={ro} setRule={setRule} />
                <div className="rsm-note">{t('rsm.set.rulesHint')}</div>
              </div>
            </div>
            <div className="rsm-box">
              <div className="rsm-box-head"><div className="rsm-box-title">{t('rsm.set.mailAccess')}</div></div>
              <div className="rsm-box-body">
                <label className="rsm-field">{t('rsm.set.cc')}<input value={cfg.mail.cc} disabled={ro} onChange={(e) => setCfg({ ...cfg, mail: { ...cfg.mail, cc: e.target.value } })} placeholder="nome@csabroker.it, altro@csabroker.it" /></label>
                <MailTexts cfg={cfg} ro={ro} onChange={(mail) => setCfg({ ...cfg, mail })} />
                <label className="rsm-field">{t('rsm.set.signature')}<textarea rows={3} value={cfg.mail.signature} disabled={ro} onChange={(e) => setCfg({ ...cfg, mail: { ...cfg.mail, signature: e.target.value } })} /></label>
                <label className="rsm-field">{t('rsm.set.editors')}<textarea rows={3} value={editors} disabled={ro} onChange={(e) => setEditors(e.target.value)} placeholder="nome@csabroker.it" /></label>
                <div className="rsm-note">{t('rsm.set.editorsHint')}</div>
              </div>
            </div>
          </div>

          <WordsBox cfg={cfg} ro={ro} onChange={(words) => setCfg({ ...cfg, words })} onExcel={(excelLabels) => setCfg({ ...cfg, excelLabels })} />

          <ExampleBox cfg={cfg} />
          <LayoutSummary cfg={cfg} ro={ro} onForget={() => { setCfg({ ...cfg, fileLayout: null }); setMsg({ ok: true, text: t('rsm.lay.forgot') }) }} />

          {!ro && (
            <div className="rsm-row">
              <button className="btn btn-primary" disabled={busy} onClick={save}>{t('rsm.save')}</button>
            </div>
          )}
          {pending && rsm.program && (
            <ComparePanel before={rsm.program.config} after={pending} members={rsm.members} busy={busy} onCancel={() => setPending(null)} onSave={() => doSave(pending)} />
          )}

          {!ro && (
            <div className="rsm-box">
              <div className="rsm-box-head"><div className="rsm-box-title">{t('rsm.set.importTitle')}</div></div>
              <div className="rsm-box-body">
                <p className="rsm-muted" style={{ margin: 0 }}>{t('rsm.set.importHint')}</p>
                <div className="rsm-row"><Link className="btn btn-primary" href="/rsm/import">{t('rsm.noProgramImport')}</Link></div>
              </div>
            </div>
          )}
        </>
      )}

      <div className="rsm-box">
        <div className="rsm-box-head"><div className="rsm-box-title">{t('rsm.set.newTitle')}</div></div>
        <div className="rsm-box-body">
          <div className="rsm-row">
            <label className="rsm-field" style={{ minWidth: 240 }}>{t('rsm.company')}<input value={nw.company} list="rsm-companies-set" placeholder={t('rsm.companyPh')} onChange={(e) => setNew({ company: e.target.value })} /></label>
            <label className="rsm-field">{t('rsm.set.year')}<input type="number" value={nw.year} onChange={(e) => setNew({ year: Number(e.target.value) })} style={{ width: 100 }} /></label>
            <label className="rsm-field" style={{ minWidth: 280 }}>{t('rsm.set.name')}<input value={nw.name} onChange={(e) => { setNwTouched(true); setNw({ ...nw, name: e.target.value }) }} /></label>
            {rsm.programs && rsm.programs.length > 0 && (
              <label className="rsm-field">{t('rsm.set.copyFrom')}
                <select value={nw.copyFrom} onChange={(e) => setNw({ ...nw, copyFrom: e.target.value })} style={{ width: 260 }}>
                  <option value="">{t('rsm.set.blank')}</option>
                  {rsm.programs.filter((p) => p.editor).map((p) => <option key={p.id} value={p.id}>{p.company} · {p.year}</option>)}
                </select>
              </label>
            )}
            <button className="btn btn-primary" disabled={!nw.name.trim() || !nw.company.trim() || busy} onClick={create}>{t('rsm.set.create')}</button>
          </div>
          <div className="rsm-note">{t('rsm.set.newHint')}</div>
        </div>
      </div>

      {rsm.program && !ro && (
        <div className="rsm-row"><button className="btn btn-secondary" style={{ color: 'var(--c-error)' }} onClick={remove}>{t('rsm.set.delete')}</button></div>
      )}
      {panel}
    </div>
  )
}
