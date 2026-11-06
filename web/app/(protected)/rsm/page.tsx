'use client'

// Stato di rischio: assicurati per categoria a una data, nuclei raggruppati
// sotto il titolare, filtri per data di entrata e di uscita, cessazioni e
// correzioni sulla riga, export Excel.
import Link from 'next/link'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useI18n } from '@/lib/i18n/I18nProvider'
import { useConfirmPanel } from '@/components/ConfirmPanel'
import { RsmGate, RsmHeader, api, downloadExport, eur, today, useFlash, useRsm } from '@/components/rsm/useRsm'
import { CeasePanel, EditPanel } from '@/components/rsm/MemberPanels'
import PersonPanel from '@/components/rsm/PersonPanel'
import type { Row } from '@/components/rsm/useRsm'
import { checkPerson, fmtDate, isCovered, statusAt } from '@/lib/rsm/rules.js'
import type { RsmIssue } from '@/lib/rsm/types'

type StateFilter = 'covered' | 'exited' | 'all'
type SortKey = 'name' | 'birth' | 'entry' | 'exit' | 'due'

const PILL: Record<string, string> = { attivo: 'ok', cessazione: 'warn', uscito: 'off', promosso: 'promo', futuro: 'new' }

export default function RsmStatoPage() {
  const { t } = useI18n()
  const rsm = useRsm()
  const { ask, panel } = useConfirmPanel()
  const [at, setAt] = useState(today())
  const [cat, setCat] = useState<string>('all')
  const [q, setQ] = useState('')
  const [entFrom, setEntFrom] = useState('')
  const [entTo, setEntTo] = useState('')
  const [exFrom, setExFrom] = useState('')
  const [exTo, setExTo] = useState('')
  const [stateF, setStateF] = useState<StateFilter>('covered')
  const [showFam, setShowFam] = useState(true)
  const [onlyIssues, setOnlyIssues] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const [open, setOpen] = useState<{ id: string; kind: 'exit' | 'edit' } | null>(null)
  const { setFlash: setMsg, node: flashNode } = useFlash(rsm)
  const [busy, setBusy] = useState(false)
  // Scheda della persona aperta (codice fiscale), anche dall'indirizzo ?p=…
  const [person, setPerson] = useState<string | null>(null)
  useEffect(() => { try { const p = new URLSearchParams(window.location.search).get('p'); if (p) setPerson(p) } catch { /* ignora */ } }, [])
  function openPerson(cf: string | null) {
    setPerson(cf)
    try {
      const u = new URL(window.location.href)
      if (cf) u.searchParams.set('p', cf); else u.searchParams.delete('p')
      window.history.replaceState(null, '', u.toString())
    } catch { /* ignora */ }
  }

  const cfg = rsm.program?.config
  const withState = useMemo(() => (cfg ? rsm.rows.map((r) => ({ ...r, st: statusAt(cfg, r, at) as string })) : []), [rsm.rows, cfg, at])
  // Dati da controllare: errori del codice fiscale (cognome, nome, nascita, controllo).
  const issuesById = useMemo(() => {
    const m = new Map<string, RsmIssue[]>()
    if (!rsm.program) return m
    for (const r of rsm.rows) {
      const is = (checkPerson({ cognome: r.cognome, nome: r.nome, cf: r.cf, birthDate: r.birthDate }, rsm.program.year).issues as RsmIssue[]).filter((i) => i.level === 'error')
      if (is.length) m.set(r.id, is)
    }
    return m
  }, [rsm.rows, rsm.program])

  const kpis = useMemo(() => (cfg ? cfg.categories.map((c) => {
    const rows = withState.filter((r) => r.category === c.key)
    const cov = rows.filter((r) => isCovered(r.st))
    const dovuto = rows.reduce((s, r) => s + r.c.dovuto, 0)
    const rimborsi = rows.reduce((s, r) => s + r.c.rimborso, 0)
    return { c, teste: cov.length, titolari: cov.filter((r) => r.legame === 'TI').length, dovuto, rimborsi }
  }) : []), [cfg, withState])

  const groups = useMemo(() => {
    if (!cfg) return []
    const needle = q.trim().toUpperCase()
    const inRange = (d: string | null, a: string, b: string) => (!a && !b) || (!!d && (!a || d >= a) && (!b || d <= b))
    const pass = (r: (typeof withState)[number]) => {
      if (cat !== 'all' && r.category !== cat) return false
      if (stateF === 'covered' && !isCovered(r.st)) return false
      if (stateF === 'exited' && !r.exitDate) return false
      if ((entFrom || entTo) && (r.entryKind === 'iniziale' || !inRange(r.entryDate, entFrom, entTo))) return false
      if (!inRange(r.exitDate, exFrom, exTo)) return false
      return true
    }
    const flagged = onlyIssues ? new Set(withState.filter((r) => issuesById.has(r.id)).map((r) => `${r.category}|${r.legame === 'TI' ? r.cf : r.cfTitolare}`)) : null
    const base = withState.filter(pass)
    const key = (r: Row) => `${r.category}|${r.legame === 'TI' ? r.cf : r.cfTitolare}`
    let keys: Set<string> | null = null
    if (needle) keys = new Set(base.filter((r) => `${r.cognome} ${r.nome} ${r.nome} ${r.cognome} ${r.cf}`.includes(needle)).map(key))
    const map = new Map<string, typeof base>()
    for (const r of base) {
      const k = key(r)
      if (keys && !keys.has(k)) continue
      if (flagged && !flagged.has(k)) continue
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(r)
    }
    const rank = (r: Row) => (r.legame === 'TI' ? 0 : r.legame === 'CO' ? 1 : 2)
    const catOrder = new Map(cfg.categories.map((c, i) => [c.key, i]))
    // Ordinamento per colonna sul titolare: il nucleo resta unito sotto di lui.
    const val = (r: Row): string | number => sort.key === 'birth' ? r.birthDate || '' : sort.key === 'entry' ? r.entryDate || ''
      : sort.key === 'exit' ? r.exitDate || '9999' : sort.key === 'due' ? r.c.dovuto - r.c.rimborso : `${r.cognome} ${r.nome}`
    const cmp = (a: Row, b: Row) => {
      const x = val(a), y = val(b)
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir
    }
    return [...map.values()]
      .map((rows) => rows.sort((a, b) => rank(a) - rank(b) || a.cognome.localeCompare(b.cognome)))
      .sort((a, b) => (sort.key === 'name' ? (catOrder.get(a[0].category)! - catOrder.get(b[0].category)!) : 0) || cmp(a[0], b[0]) || a[0].cognome.localeCompare(b[0].cognome))
  }, [cfg, withState, cat, q, stateF, entFrom, entTo, exFrom, exTo, onlyIssues, issuesById, sort])

  const visible = groups.flat()
  const total = visible.reduce((s, r) => s + r.c.dovuto - r.c.rimborso, 0)
  const catLabel = (k: string) => cfg?.categories.find((c) => c.key === k)?.label || k

  async function run(fn: () => Promise<{ opId?: string; label?: string } | unknown>, okText: string) {
    setBusy(true)
    setMsg(null)
    try {
      const j = (await fn()) as { opId?: string; label?: string } | undefined
      setMsg({ ok: true, text: j?.label || okText, opId: j?.opId })
      setOpen(null)
      await rsm.reload()
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  async function remove(r: Row) {
    if (!(await ask(t('rsm.st.deleteAsk', { name: `${r.cognome} ${r.nome}` }), { danger: true, okLabel: t('rsm.delete') }))) return
    run(() => api(`/api/rsm/programs/${rsm.programId}/members`, 'DELETE', { ids: [r.id] }), t('rsm.st.deleted'))
  }

  async function exportXlsx(kind: 'stato' | 'situazione') {
    try { await downloadExport(rsm.programId!, { kind, at, ids: kind === 'situazione' ? visible.map((r) => r.id) : undefined }) } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
  }

  return (
    <div className="rsm">
      <RsmHeader rsm={rsm} title={t('rsm.st.title')}>
        {rsm.program && (
          <>
            <label className="rsm-field w-date">{t('rsm.st.at')}<input type="date" value={at} onChange={(e) => setAt(e.target.value || today())} /></label>
            <button className="btn btn-secondary" onClick={() => exportXlsx('situazione')}>{t('rsm.st.exportView')}</button>
            <button className="btn btn-secondary" onClick={() => exportXlsx('stato')}>{t('rsm.st.exportStato')}</button>
            {rsm.editor && <Link className="btn btn-primary" href="/rsm/variazioni">{t('rsm.st.register')}</Link>}
          </>
        )}
      </RsmHeader>
      <RsmGate rsm={rsm}>
        {flashNode}
        <div className="rsm-kpis">
          {kpis.map((k) => (
            <div key={k.c.key} className="rsm-kpi">
              <div className="rsm-kpi-top"><span>{k.c.label}</span><span>{k.c.policy ? t('rsm.pol', { n: k.c.policy }) : ''}</span></div>
              <div className="rsm-kpi-num">{t('rsm.st.heads', { n: k.teste })}</div>
              <div className="rsm-kpi-line">{t(k.c.mode === 'nucleo' ? 'rsm.st.nuclei' : 'rsm.st.titolari', { n: k.titolari })} · {t('rsm.st.atDate', { d: fmtDate(at) })}</div>
              <div className="rsm-kpi-line">{t('rsm.st.premioAnno', { v: eur(k.dovuto) })}{k.rimborsi ? ` · ${t('rsm.st.rimborsi', { v: eur(k.rimborsi) })}` : ''}</div>
            </div>
          ))}
        </div>

        <div className="rsm-box">
          <div className="rsm-box-head">
            <div className="rsm-tabs" role="tablist" aria-label={t('rsm.category')}>
              {[{ key: 'all', label: t('rsm.all') }, ...(cfg?.categories || [])].map((c) => (
                <button key={c.key} role="tab" aria-selected={cat === c.key} className={`rsm-tab${cat === c.key ? ' on' : ''}`} onClick={() => setCat(c.key)}>
                  {c.label}<span className="n">{withState.filter((r) => (c.key === 'all' || r.category === c.key) && isCovered(r.st)).length}</span>
                </button>
              ))}
            </div>
            <div className="rsm-row">
              <label className="rsm-field">{t('rsm.st.search')}<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('rsm.st.searchPh')} style={{ width: 240 }} /></label>
              <label className="rsm-field">{t('rsm.st.state')}
                <select value={stateF} onChange={(e) => setStateF(e.target.value as StateFilter)} style={{ width: 180 }}>
                  <option value="covered">{t('rsm.st.fCovered')}</option>
                  <option value="exited">{t('rsm.st.fExited')}</option>
                  <option value="all">{t('rsm.st.fAll')}</option>
                </select>
              </label>
              <label className="rsm-field w-date">{t('rsm.st.entFrom')}<input type="date" value={entFrom} onChange={(e) => setEntFrom(e.target.value)} /></label>
              <label className="rsm-field w-date">{t('rsm.st.to')}<input type="date" value={entTo} onChange={(e) => setEntTo(e.target.value)} /></label>
              <label className="rsm-field w-date">{t('rsm.st.exFrom')}<input type="date" value={exFrom} onChange={(e) => { setExFrom(e.target.value); if (e.target.value && stateF === 'covered') setStateF('all') }} /></label>
              <label className="rsm-field w-date">{t('rsm.st.to')}<input type="date" value={exTo} onChange={(e) => { setExTo(e.target.value); if (e.target.value && stateF === 'covered') setStateF('all') }} /></label>
              <label className="rsm-muted" style={{ display: 'flex', gap: 6, alignItems: 'center', height: 36 }}>
                <input type="checkbox" checked={showFam} onChange={(e) => setShowFam(e.target.checked)} />{t('rsm.st.showFam')}
              </label>
              {issuesById.size > 0 && (
                <label className="rsm-muted" style={{ display: 'flex', gap: 6, alignItems: 'center', height: 36 }}>
                  <input type="checkbox" checked={onlyIssues} onChange={(e) => { setOnlyIssues(e.target.checked); if (e.target.checked) setStateF('all') }} />{t('rsm.st.onlyIssues', { n: issuesById.size })}
                </label>
              )}
            </div>
          </div>
          <div className="rsm-scroll tall">
            {visible.length === 0 ? <div className="rsm-empty">{rsm.rows.length ? t('rsm.st.noMatch') : <>{t('rsm.st.empty')}{rsm.editor && <div style={{ marginTop: 12 }}><Link className="btn btn-primary" href="/rsm/import">{t('rsm.noProgramImport')}</Link></div>}</>}</div> : (
              <table className="rsm-table">
                <thead><tr>
                  <SortTh k="name" sort={sort} setSort={setSort} label={t('rsm.col.insured')} /><th>{t('rsm.col.legame')}</th>{cat === 'all' && <th>{t('rsm.category')}</th>}
                  <SortTh k="birth" sort={sort} setSort={setSort} label={t('rsm.col.birth')} /><SortTh k="entry" sort={sort} setSort={setSort} label={t('rsm.col.entry')} /><SortTh k="exit" sort={sort} setSort={setSort} label={t('rsm.col.exit')} />
                  <th className="num">{t('rsm.col.annual')}</th><SortTh k="due" sort={sort} setSort={setSort} label={t('rsm.col.due')} num /><th>{t('rsm.col.state')}</th>
                  {rsm.editor && <th />}
                </tr></thead>
                <tbody>
                  {groups.map((g) => g.filter((r, i) => showFam || i === 0 || r.legame === 'TI').map((r) => {
                    const fam = r.legame !== 'TI'
                    const nFam = g.filter((x) => x.legame !== 'TI').length
                    return (
                      <Fragment key={r.id}>
                        <tr className={`${fam ? 'fam' : ''} ${isCovered(r.st) ? '' : 'off'}`}>
                          <td className="who">
                            <div className="rsm-who"><button className="rsm-who-btn" onClick={() => openPerson(r.cf)} title={t('rsm.ps.open')}>{r.cognome} {r.nome}</button>{r.quiescente && !fam && <span className="rsm-pill off" style={{ marginLeft: 6 }}>{t('rsm.quiescente')}</span>}{issuesById.has(r.id) && <button className="rsm-pill warn" style={{ marginLeft: 6, border: 0, cursor: 'pointer' }} title={issuesById.get(r.id)!.map((i) => i.text).join('\n')} onClick={() => openPerson(r.cf)}>{t('rsm.st.toCheck')}</button>}</div>
                            <div className="rsm-cf">{r.cf}{!fam && !showFam && nFam ? ` · ${t('rsm.st.plusFam', { n: nFam })}` : ''}</div>
                          </td>
                          <td className="nowrap">{t(`rsm.leg.${r.legame}`)}</td>
                          {cat === 'all' && <td className="nowrap">{catLabel(r.category)}</td>}
                          <td className="nowrap">{fmtDate(r.birthDate)}</td>
                          <td className="nowrap">{fmtDate(r.entryDate)}<div className="rsm-sub">{t(`rsm.entry.${r.entryKind}`)}{r.entryForced ? ` · ${t('rsm.forced')}` : ''}</div></td>
                          <td className="nowrap">{r.exitDate ? <>{fmtDate(r.exitDate)}<div className="rsm-sub">{t(`rsm.exit.${r.exitKind}`)}</div></> : ''}</td>
                          <td className="num">{r.c.annuo ? eur(r.c.annuo) : '—'}</td>
                          <td className="num">{eur(r.c.dovuto)}{r.c.rimborso ? <div className="rsm-sub">{t('rsm.st.refund', { v: eur(r.c.rimborso) })}</div> : <div className="rsm-sub">{r.c.calc}</div>}</td>
                          <td><span className={`rsm-pill ${PILL[r.st]}`}>{t(`rsm.state.${r.st}`)}</span>{r.note ? <div className="rsm-sub" title={r.note} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.note}</div> : null}</td>
                          {rsm.editor && (
                            <td><div className="rsm-actions">
                              {!r.exitKind && <button className="rsm-mini" onClick={() => setOpen({ id: r.id, kind: 'exit' })}>{t('rsm.st.cease')}</button>}
                              {r.exitKind === 'cessazione' && <button className="rsm-mini" disabled={busy} onClick={() => run(() => api(`/api/rsm/programs/${rsm.programId}/members`, 'PATCH', { action: 'clear-exit', id: r.id }), t('rsm.st.exitCleared'))}>{t('rsm.st.undoCease')}</button>}
                              {!fam && !r.exitKind && <Link className="rsm-mini btn" href={`/rsm/promozioni?m=${r.id}`}>{t('rsm.st.promote')}</Link>}
                              <button className="rsm-mini" onClick={() => setOpen({ id: r.id, kind: 'edit' })}>{t('rsm.edit')}</button>
                              {!r.promotionId && !r.exitPromotionId && <button className="rsm-mini danger" aria-label={t('rsm.delete')} onClick={() => remove(r)}>×</button>}
                            </div></td>
                          )}
                        </tr>
                        {open && open.id === r.id && (
                          <tr><td colSpan={cat === 'all' ? 10 : 9}>
                            {open.kind === 'exit'
                              ? <CeasePanel row={r} nucleus={g} busy={busy} onCancel={() => setOpen(null)}
                                  onSave={(ids, exitDate, exitCommunicated, note) => run(() => api(`/api/rsm/programs/${rsm.programId}/members`, 'PATCH', { action: 'exit', ids, exitDate, exitCommunicated, note }), t('rsm.st.ceased'))} />
                              : <EditPanel row={r} year={rsm.program!.year} busy={busy} onCancel={() => setOpen(null)}
                                  onSave={(patch) => run(() => api(`/api/rsm/programs/${rsm.programId}/members`, 'PATCH', { action: 'update', id: r.id, patch }), t('rsm.saved'))} />}
                          </td></tr>
                        )}
                      </Fragment>
                    )
                  }))}
                </tbody>
              </table>
            )}
          </div>
          <div className="rsm-box-head" style={{ borderTop: '1px solid var(--c-border)', borderBottom: 0 }}>
            <span className="rsm-muted">{t('rsm.st.footer', { n: visible.length, t: visible.filter((r) => r.legame === 'TI').length })}</span>
            <span className="rsm-muted">{t('rsm.st.footerSum', { v: eur(total) })}</span>
          </div>
        </div>
        {person && rsm.program && <PersonPanel rsm={rsm} cf={person} at={at} onClose={() => openPerson(null)} onOpen={(cf) => openPerson(cf)} onDone={(text, opId) => setMsg({ ok: true, text, opId })} />}
      </RsmGate>
      {panel}
    </div>
  )
}

function SortTh({ k, label, sort, setSort, num }: { k: SortKey; label: string; sort: { key: SortKey; dir: 1 | -1 }; setSort: (s: { key: SortKey; dir: 1 | -1 }) => void; num?: boolean }) {
  const on = sort.key === k
  return (
    <th className={num ? 'num' : undefined} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="rsm-sort" onClick={() => setSort({ key: k, dir: on ? (sort.dir === 1 ? -1 : 1) : 1 })}>
        {label}<span aria-hidden="true">{on ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</span>
      </button>
    </th>
  )
}
