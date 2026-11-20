'use client'

// Stato di rischio della polizza vita: assicurati per contraente, capitale,
// tasso, premio, garanzie e stato della documentazione sanitaria. Il premio in
// colonna è quello ANNUO; per chi entra a metà anno si mostra anche il rateo.
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { CompanyTabs, CoverPill, DocPill, PersonPanel } from '@/components/vita/VitaUi'
import type { CompanyTab } from '@/components/vita/VitaUi'
import { VitaEmpty, VitaGate, VitaHeader, downloadExport, eur, fmtDate, rate4, statusAt, today, useFlash, useVita } from '@/components/vita/useVita'

export default function VitaStatoPage() {
  const vita = useVita()
  const cfg = vita.cfg
  const catMode = cfg?.rules.capitalMode === 'categoria'
  const [tab, setTab] = useState<CompanyTab>('all')
  const [q, setQ] = useState('')
  const [at, setAt] = useState(today())
  const [onlyReduced, setOnlyReduced] = useState(false)
  const [showExited, setShowExited] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { setFlash, node: flashNode } = useFlash(vita)

  const covered = useMemo(() => vita.rows.filter((r) => statusAt(r, at) === 'attivo'), [vita.rows, at])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: covered.length }
    for (const comp of cfg?.companies || []) c[comp.key] = covered.filter((r) => r.company === comp.key).length
    return c
  }, [covered, cfg])
  const prorataIn = useMemo(() => new Map(vita.movements().filter((m) => m.kind === 'INCLUSIONE').map((m) => [m.row.id, m])), [vita])

  const list = useMemo(() => vita.rows
    .filter((r) => (showExited ? true : statusAt(r, at) === 'attivo'))
    .filter((r) => tab === 'all' || r.company === tab)
    .filter((r) => !onlyReduced || r.c.scopertura > 0)
    .filter((r) => !q || `${r.cognome} ${r.nome} ${r.cf} ${r.level} ${r.c.category || ''} ${Object.values(r.extra || {}).join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`)), [vita.rows, tab, q, onlyReduced, showExited, at])

  const scope = covered.filter((r) => tab === 'all' || r.company === tab)
  const capTot = scope.reduce((s, r) => s + r.c.capital, 0)
  const premTot = scope.reduce((s, r) => s + (r.c.gross || 0), 0)
  const reduced = scope.filter((r) => r.c.scopertura > 0).length
  const onlyDeath = scope.filter((r) => r.c.cover === 'SOLO CASO MORTE').length
  const outOfCover = scope.filter((r) => r.c.cover === 'FUORI COPERTURA').length
  const noRate = scope.filter((r) => r.c.rate == null).length
  const perCat = new Map<string, { n: number; cap: number; prem: number }>()
  for (const r of scope) { const k = r.c.category || 'senza categoria'; const v = perCat.get(k) || { n: 0, cap: 0, prem: 0 }; v.n++; v.cap += r.c.capital; v.prem += r.c.gross || 0; perCat.set(k, v) }
  // Uscite dell'anno: si vedono anche senza spuntare «mostra gli usciti».
  const usciti = vita.rows.filter((r) => r.exitDate && (tab === 'all' || r.company === tab))
  const entrati = vita.rows.filter((r) => r.entryKind !== 'iniziale' && (tab === 'all' || r.company === tab))
  const current = open ? vita.rows.find((r) => r.id === open) || null : null

  async function exportExcel(kind: 'stato' | 'situazione') {
    setBusy(true)
    try { await downloadExport(vita.programId!, { kind, at }) } catch (e) { setFlash({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  return (
    <div className="rsm">
      <VitaHeader vita={vita} title="Stato di rischio" kicker={`situazione al ${fmtDate(at)}`}>
        {vita.editor && <Link className="btn btn-secondary" href="/vita/movimenti">Registra entrata o uscita</Link>}
        {vita.editor && cfg?.hrMonthly && <Link className="btn btn-secondary" href="/vita/mensile">Carica il file mensile</Link>}
        {vita.editor && <Link className="btn btn-secondary" href="/vita/import">Importa lo stato di rischio</Link>}
        <button className="btn btn-secondary" disabled={busy || !vita.rows.length} onClick={() => exportExcel('stato')}>Esporta Excel</button>
      </VitaHeader>

      <VitaGate vita={vita}>
        {flashNode}
        {vita.rows.length === 0 ? <VitaEmpty what="non è ancora stato caricato lo stato di rischio." /> : <>
          <div className="rsm-kpis">
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>In copertura</span><span>{tab === 'all' ? 'tutte le polizze' : cfg?.companies.find((c) => c.key === tab)?.name}</span></div><div className="rsm-kpi-num">{scope.length}</div><div className="rsm-kpi-line">{catMode ? [...perCat.entries()].map(([k, v]) => `${v.n} ${k.toLowerCase()}`).join(' · ') : `${onlyDeath} con la sola garanzia caso morte${outOfCover > 0 ? `, ${outOfCover} oltre gli ${cfg?.rules.deathMaxAge} anni` : ''}`}</div></div>
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Capitali assicurati</span></div><div className="rsm-kpi-num">{eur(capTot)}</div><div className="rsm-kpi-line">media {eur(capTot / Math.max(1, scope.length))}</div></div>
            <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Premio lordo annuo</span></div><div className="rsm-kpi-num">{eur(premTot)}</div><div className="rsm-kpi-line">premio pieno di chi è in copertura; i ratei dell&apos;anno sono in Movimenti{noRate > 0 ? ` · ${noRate} senza tasso in tabella` : ''}</div></div>
            {!catMode && <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Capitale sotto il previsto</span></div><div className="rsm-kpi-num" style={{ color: reduced ? 'var(--c-warning)' : undefined }}>{reduced}</div><div className="rsm-kpi-line">documentazione sanitaria incompleta</div></div>}
            <div className="rsm-kpi">
              <div className="rsm-kpi-top"><span>Movimenti dell&apos;anno</span><span>{vita.program?.year}</span></div>
              <div className="rsm-kpi-num">{entrati.length} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--c-text-muted)' }}>entrate</span> · {usciti.length} <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--c-text-muted)' }}>uscite</span></div>
              <div className="rsm-kpi-line">{usciti.length ? <button className="rsm-link" onClick={() => setShowExited(true)}>mostra chi è uscito</button> : 'nessuna uscita registrata'}</div>
            </div>
          </div>

          {cfg && <CompanyTabs cfg={cfg} value={tab} onChange={setTab} counts={counts} />}

          <div className="rsm-box">
            <div className="rsm-box-head">
              <div className="rsm-row">
                <label className="rsm-field">Cerca<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cognome, codice fiscale, livello" style={{ width: 240 }} /></label>
                <label className="rsm-field w-date">Situazione al<input type="date" value={at} onChange={(e) => setAt(e.target.value)} /></label>
                {!catMode && <label className="rsm-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 12.5 }}><input type="checkbox" checked={onlyReduced} onChange={(e) => setOnlyReduced(e.target.checked)} style={{ height: 16, width: 16 }} />Solo con capitale ridotto</label>}
                <label className="rsm-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 12.5 }}><input type="checkbox" checked={showExited} onChange={(e) => setShowExited(e.target.checked)} style={{ height: 16, width: 16 }} />Mostra anche gli usciti</label>
              </div>
              <span className="rsm-muted">{list.length} {list.length === 1 ? 'riga' : 'righe'}{showExited ? ` · ${list.filter((r) => statusAt(r, at) === 'attivo').length} in copertura` : ''}</span>
            </div>
            <div className="rsm-scroll tall">
              <table className="rsm-table">
                {catMode
                  ? <thead><tr><th>Assicurato</th><th>Categoria</th><th className="num">Età</th><th className="num">Capitale</th><th className="num">Premio annuo</th><th>Decorrenza</th><th>Stato</th></tr></thead>
                  : <thead><tr><th>Assicurato</th><th>Livello</th><th className="num">Età</th><th className="num">RAL</th><th className="num">Capitale</th><th className="num">Tasso ‰</th><th className="num">Premio lordo</th><th>Garanzie</th><th>Documentazione</th></tr></thead>}
                <tbody>
                  {list.map((r) => {
                    const st = statusAt(r, at)
                    if (catMode) return (
                      <tr key={r.id} className={st === 'attivo' ? '' : 'off'}>
                        <td><button className="rsm-who-btn" onClick={() => setOpen(r.id)}>{r.cognome} {r.nome}</button><div className="rsm-cf">{r.cf}{r.extra?.MATRICOLA ? ` · matr. ${r.extra.MATRICOLA}` : ''}</div></td>
                        <td>{r.c.category ? <b>{r.c.category}</b> : <span className="rsm-pill err">nessuna categoria</span>}{r.level && r.level.toUpperCase() !== String(r.c.category || '').toUpperCase() && <div className="rsm-sub">{r.level}</div>}</td>
                        <td className="num">{r.c.age ?? '—'}</td>
                        <td className="num">{eur(r.c.capital)}</td>
                        <td className="num">{eur(r.c.gross)}{prorataIn.has(r.id) && <div className="rsm-sub">dal {fmtDate(r.entryDate)}: {eur(prorataIn.get(r.id)!.gross)}</div>}</td>
                        <td className="nowrap">{fmtDate(r.entryDate)}{r.entryKind === 'passaggio' && <div className="rsm-sub">passaggio di categoria</div>}</td>
                        <td>{st === 'attivo' ? <span className="rsm-pill ok">In copertura</span> : st === 'uscito' ? <span className="rsm-pill off">Uscito il {fmtDate(r.exitDate)}</span> : <span className="rsm-pill new">Dal {fmtDate(r.entryDate)}</span>}</td>
                      </tr>
                    )
                    return (
                      <tr key={r.id} className={st === 'attivo' ? '' : 'off'}>
                        <td><button className="rsm-who-btn" onClick={() => setOpen(r.id)}>{r.cognome} {r.nome}</button>{r.keyFigure && <> <span className="rsm-pill promo">figura chiave</span></>}<div className="rsm-cf">{r.cf}</div></td>
                        <td className="nowrap">{r.level}</td>
                        <td className="num">{r.c.age ?? '—'}</td>
                        <td className="num">{eur(r.ral)}</td>
                        <td className="num">{eur(r.c.capital)}{r.c.scopertura > 0 && <div className="rsm-sub" style={{ color: 'var(--c-error)' }}>non coperti {eur(r.c.scopertura)}</div>}</td>
                        <td className="num">{rate4(r.c.rate)}</td>
                        <td className="num">{r.c.rate == null ? <span className="rsm-sub">da concordare</span> : eur(r.c.gross)}{r.sovrPct > 0 && <div className="rsm-sub">sovrappremio {r.sovrPct}%</div>}{prorataIn.has(r.id) && <div className="rsm-sub">dal {fmtDate(r.entryDate)}: {eur(prorataIn.get(r.id)!.gross)}</div>}</td>
                        <td><CoverPill cover={r.c.cover} /></td>
                        <td><DocPill r={r} />{st === 'uscito' && <div className="rsm-sub">uscito il {fmtDate(r.exitDate)}</div>}{st === 'futuro' && <div className="rsm-sub">in copertura dal {fmtDate(r.entryDate)}</div>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="rsm-note">{catMode
            ? 'Capitale e premio non si scrivono: vengono dalla categoria, che si legge dal livello della persona. Si cambiano in «Tassi e regole» e valgono anche per il passato.'
            : 'Età, tasso, capitale, premio e garanzie non si scrivono: si calcolano da data di nascita, RAL e documentazione, con i tassi del programma.'}</p>
        </>}
        {current && cfg && <PersonPanel vita={vita} row={current} at={at} onClose={() => setOpen(null)} onDone={(text, opId) => setFlash({ ok: true, text, opId })} />}
      </VitaGate>
    </div>
  )
}
