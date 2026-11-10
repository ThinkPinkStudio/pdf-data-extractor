'use client'

// Stato di rischio della polizza vita: assicurati per contraente (Amundi SGR e
// Amundi Real Estate), capitale, tasso, premio, garanzie e stato della
// documentazione sanitaria. Scheda dell'assicurato nel pannello laterale.
import { useMemo, useState } from 'react'
import { COMPANIES, ROWS, TODAY, YEAR_START, eur, fmtDate, movements, rate4, statusAt } from '@/lib/vita/demo'
import { CompanyTabs, CoverPill, DocPill, PersonPanel, VitaEmpty, VitaHeader } from '@/components/vita/VitaUi'
import type { CompanyTab } from '@/components/vita/VitaUi'

export default function VitaStatoPage() {
  const [tab, setTab] = useState<CompanyTab>('sgr')
  const [q, setQ] = useState('')
  const [onlyReduced, setOnlyReduced] = useState(false)
  const [showExited, setShowExited] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const covered = useMemo(() => ROWS.filter((r) => statusAt(r, TODAY) === 'attivo'), [])
  // Rateo dell'anno di chi è entrato dopo il 01/01: il premio in colonna è quello pieno.
  const prorataIn = useMemo(() => new Map(movements().filter((m) => m.kind === 'INCLUSIONE').map((m) => [m.row.id, m])), [])
  const counts = { sgr: covered.filter((r) => r.company === 'sgr').length, re: covered.filter((r) => r.company === 're').length, all: covered.length }
  const list = useMemo(() => ROWS
    .filter((r) => (showExited ? true : statusAt(r, TODAY) === 'attivo'))
    .filter((r) => tab === 'all' || r.company === tab)
    .filter((r) => !onlyReduced || r.scopertura > 0)
    .filter((r) => !q || `${r.cognome} ${r.nome} ${r.cf} ${r.level}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => `${a.cognome} ${a.nome}`.localeCompare(`${b.cognome} ${b.nome}`)), [tab, q, onlyReduced, showExited])

  const scope = covered.filter((r) => tab === 'all' || r.company === tab)
  const capTot = scope.reduce((s, r) => s + r.capital, 0)
  const premTot = scope.reduce((s, r) => s + (r.gross || 0), 0)
  const reduced = scope.filter((r) => r.scopertura > 0).length
  const noRate = scope.filter((r) => r.rate == null).length
  const onlyDeath = scope.filter((r) => r.cover === 'SOLO CASO MORTE').length
  const outOfCover = scope.filter((r) => r.cover === 'FUORI COPERTURA').length
  const current = open ? ROWS.find((r) => r.id === open) || null : null

  return (
    <div className="rsm">
      <VitaHeader kicker="Polizza Vita 2026 · situazione di oggi" title="Stato di rischio">
        <a className="btn btn-secondary" href="/vita/movimenti">Registra entrata o uscita</a>
        <button className="btn btn-secondary">Importa lo stato di rischio</button>
        <button className="btn btn-secondary">Esporta Excel</button>
      </VitaHeader>

      {ROWS.length === 0 ? <VitaEmpty what="non è ancora stato caricato lo stato di rischio." /> : <>
      <div className="rsm-kpis">
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>In copertura</span><span>{tab === 'all' ? 'tutte le polizze' : `pol. ${COMPANIES[tab].policy}`}</span></div><div className="rsm-kpi-num">{scope.length}</div><div className="rsm-kpi-line">{onlyDeath} con la sola garanzia caso morte{outOfCover > 0 ? `, ${outOfCover} oltre gli 80 anni` : ''}</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Capitali assicurati</span></div><div className="rsm-kpi-num">{eur(capTot)}</div><div className="rsm-kpi-line">media {eur(capTot / Math.max(1, scope.length))}</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Premio lordo annuo</span></div><div className="rsm-kpi-num">{eur(premTot)}</div><div className="rsm-kpi-line">premio pieno di chi è in copertura; i ratei dell&apos;anno sono in Movimenti{noRate > 0 ? ` · ${noRate} senza tasso in tabella` : ''}</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Capitale sotto il previsto</span></div><div className="rsm-kpi-num" style={{ color: reduced ? 'var(--c-warning)' : undefined }}>{reduced}</div><div className="rsm-kpi-line">documentazione sanitaria incompleta</div></div>
      </div>

      <CompanyTabs value={tab} onChange={setTab} counts={counts} />

      <div className="rsm-box">
        <div className="rsm-box-head">
          <div className="rsm-row">
            <label className="rsm-field">Cerca<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cognome, codice fiscale, livello" style={{ width: 260 }} /></label>
            <label className="rsm-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 12.5 }}><input type="checkbox" checked={onlyReduced} onChange={(e) => setOnlyReduced(e.target.checked)} style={{ height: 16, width: 16 }} />Solo con capitale ridotto</label>
            <label className="rsm-field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontWeight: 400, fontSize: 12.5 }}><input type="checkbox" checked={showExited} onChange={(e) => setShowExited(e.target.checked)} style={{ height: 16, width: 16 }} />Mostra anche gli usciti</label>
          </div>
          <span className="rsm-muted">{list.length} {list.length === 1 ? 'riga' : 'righe'}{showExited ? ` · ${list.filter((r) => statusAt(r, TODAY) === 'attivo').length} in copertura` : ''}</span>
        </div>
        <div className="rsm-scroll">
          <table className="rsm-table">
            <thead><tr><th>Assicurato</th><th>Livello</th><th className="num">Età</th><th className="num">RAL</th><th className="num">Capitale</th><th className="num">Tasso ‰</th><th className="num">Premio lordo</th><th>Garanzie</th><th>Documentazione</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id} className={statusAt(r, TODAY) === 'attivo' ? '' : 'off'}>
                  <td><button className="rsm-who-btn" onClick={() => setOpen(r.id)}>{r.cognome} {r.nome}</button>{r.keyFigure && <> <span className="rsm-pill promo">figura chiave</span></>}<div className="rsm-cf">{r.cf}</div></td>
                  <td className="nowrap">{r.level}</td>
                  <td className="num">{r.age}</td>
                  <td className="num">{eur(r.ral)}</td>
                  <td className="num">{eur(r.capital)}{r.scopertura > 0 && <div className="rsm-sub" style={{ color: 'var(--c-error)' }}>non coperti {eur(r.scopertura)}</div>}</td>
                  <td className="num">{rate4(r.rate)}</td>
                  <td className="num">{r.rate == null ? <span className="rsm-sub">da concordare</span> : eur(r.gross)}{r.sovrPct > 0 && <div className="rsm-sub">sovrappremio {r.sovrPct}%</div>}{r.entry > YEAR_START && prorataIn.has(r.id) && <div className="rsm-sub">dal {fmtDate(r.entry)}: {eur(prorataIn.get(r.id)!.gross)}</div>}</td>
                  <td><CoverPill cover={r.cover} /></td>
                  <td><DocPill r={r} />{statusAt(r, TODAY) === 'uscito' && <div className="rsm-sub">uscito il {fmtDate(r.exit)}</div>}{statusAt(r, TODAY) === 'futuro' && <div className="rsm-sub">in copertura dal {fmtDate(r.entry)}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="rsm-note">Età, tasso, capitale, premio e garanzie non si scrivono: si calcolano da data di nascita, RAL e documentazione, come le formule del file Excel.</p>
      </>}
      {current && <PersonPanel row={current} onClose={() => setOpen(null)} />}
    </div>
  )
}
