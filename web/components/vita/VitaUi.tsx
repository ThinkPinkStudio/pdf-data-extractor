'use client'

// Pezzi comuni delle pagine Polizza Vita: intestazione, schede per contraente,
// pillole di stato e scheda dell'assicurato (pannello laterale).
import { useMemo } from 'react'
import { COMPANIES, RULES, eur, fmtDate, movements, rate4, ROWS } from '@/lib/vita/demo'
import type { CompanyKey, Computed } from '@/lib/vita/demo'
import { checkPerson } from '@/lib/rsm/rules.js'

export function VitaHeader({ title, kicker, children }: { title: string; kicker: string; children?: React.ReactNode }) {
  return (
    <div className="rsm-head">
      <div>
        <div className="rsm-kicker">{kicker}</div>
        <h1 className="page-title">{title}</h1>
      </div>
      <div className="rsm-row">{children}</div>
    </div>
  )
}

export type CompanyTab = 'all' | CompanyKey

export function CompanyTabs({ value, onChange, counts }: { value: CompanyTab; onChange: (v: CompanyTab) => void; counts: Record<CompanyTab, number> }) {
  const tabs: { key: CompanyTab; label: string }[] = [
    { key: 'sgr', label: `${COMPANIES.sgr.name} · pol. ${COMPANIES.sgr.policy}` },
    { key: 're', label: `${COMPANIES.re.name} · pol. ${COMPANIES.re.policy}` },
    { key: 'all', label: 'Tutte' },
  ]
  return (
    <div className="rsm-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} className={`rsm-tab${value === t.key ? ' on' : ''}`} onClick={() => onChange(t.key)}>
          {t.label}<span className="n">{counts[t.key]}</span>
        </button>
      ))}
    </div>
  )
}

/** Stato della documentazione sanitaria di una persona. */
export function docState(r: Computed): { tone: 'off' | 'ok' | 'warn' | 'err'; label: string; need: string } {
  const band = r.band
  if (band === 'nessuna') return { tone: 'off', label: 'Non richiesta', need: '' }
  const need = band === 'visita' ? 'Rapporto di visita medica' : 'Visita + accertamenti o check-up'
  if (r.doc.visit && r.doc.ok) return { tone: 'ok', label: 'Accettata', need }
  if (r.doc.visit) return { tone: 'warn', label: 'Attende ok C.A. Vita', need }
  return { tone: 'err', label: 'Mancante', need }
}

export function DocPill({ r }: { r: Computed }) {
  const d = docState(r)
  return <span className={`rsm-pill ${d.tone}`}>{d.label}</span>
}

export function CoverPill({ cover }: { cover: string }) {
  const tone = cover === 'MORTE + IPT' ? 'ok' : cover === 'SOLO CASO MORTE' ? 'warn' : 'err'
  const label = cover === 'MORTE + IPT' ? 'Morte + IPT' : cover === 'SOLO CASO MORTE' ? 'Solo morte' : cover === 'FUORI COPERTURA' ? 'Fuori copertura' : '—'
  return <span className={`rsm-pill ${tone}`}>{label}</span>
}

const BAND_LABEL: Record<string, string> = { nessuna: 'fino a 400.000: nessun documento', visita: 'da 400.000 a 800.000: rapporto di visita', 'visita+accertamenti': 'oltre 800.000: visita e accertamenti' }

export function PersonPanel({ row, onClose }: { row: Computed; onClose: () => void }) {
  const issues = useMemo(() => checkPerson({ cognome: row.cognome, nome: row.nome, cf: row.cf, birthDate: row.birthDate }, 2026).issues.filter((i: { level: string }) => i.level === 'error'), [row])
  const d = docState(row)
  const mv = useMemo(() => movements().filter((m) => m.row.id === row.id), [row])
  const sameCf = ROWS.filter((r) => r.cf === row.cf && r.id !== row.id)
  const events: { date: string; tone: string; title: string; lines: string[] }[] = []
  events.push({ date: row.entry, tone: row.entry > '2026-01-01' ? 'new' : 'new', title: row.transferFrom ? `Entra in ${COMPANIES[row.company].name} da ${COMPANIES[row.transferFrom].name}` : row.entry > '2026-01-01' ? `Inclusione in ${COMPANIES[row.company].name}` : `Stato di rischio al 01/01/2026 · ${COMPANIES[row.company].name}`, lines: [`Capitale ${eur(row.capital)} · premio lordo ${eur(row.gross)}`] })
  if (row.warn) events.push({ date: '2026-03-15', tone: 'promo', title: 'Sollecito documentazione', lines: [row.warn] })
  for (const m of mv) if (m.kind === 'ESCLUSIONE') events.push({ date: m.date, tone: 'off', title: m.title, lines: [m.source, `Rimborso ${eur(m.gross)} (${m.days}/365)`].filter(Boolean) })
  events.sort((a, b) => a.date.localeCompare(b.date))

  return (
    <>
      <div className="rsm-drawer-veil" onClick={onClose} aria-hidden="true" />
      <aside className="rsm-drawer" role="dialog" aria-modal="true" aria-label={`Scheda di ${row.cognome} ${row.nome}`}>
        <div className="rsm-drawer-head">
          <div>
            <div className="rsm-kicker">{COMPANIES[row.company].name} · pol. {COMPANIES[row.company].policy}</div>
            <h2 style={{ margin: '2px 0 4px', fontSize: 19 }}>{row.cognome} {row.nome}{row.keyFigure && <> <span className="rsm-pill promo">figura chiave</span></>}</h2>
            <div className="rsm-cf">{row.cf}</div>
          </div>
          <button className="rsm-mini" onClick={onClose} aria-label="Chiudi">×</button>
        </div>
        <div className="rsm-drawer-body">
          <div className="rsm-facts">
            <div><span>Data di nascita</span><b>{fmtDate(row.birthDate)} · ricavata dal codice fiscale</b></div>
            <div><span>Livello</span><b>{row.level}</b></div>
            <div><span>Età computabile al {fmtDate(row.entry)}</span><b>{row.age} anni</b></div>
            <div><span>Garanzie</span><b><CoverPill cover={row.cover} /></b></div>
          </div>

          {issues.length === 0 ? (
            <div className="rsm-issue info">✓ Nome, cognome e data di nascita sono coerenti con il codice fiscale.</div>
          ) : (
            <div className="rsm-panel" style={{ borderColor: 'var(--c-warning)', background: 'transparent' }}>
              <div className="rsm-box-title">Da controllare</div>
              {issues.map((i: { code: string; level: string; text: string }) => <div key={i.code} className={`rsm-issue ${i.level}`}>{i.text}</div>)}
            </div>
          )}

          <section>
            <h3 className="rsm-drawer-h">Come si arriva al premio</h3>
            <table className="rsm-table" aria-label="Calcolo del premio">
              <tbody>
                <tr><td>RAL</td><td className="num">{eur(row.ral)}</td></tr>
                <tr><td>{row.keyFigure ? 'Capitale previsto (figura chiave)' : `Capitale previsto (${String(RULES.multiplier).replace('.', ',')} × RAL)`}</td><td className="num">{eur(row.target)}</td></tr>
                <tr><td>Fascia sanitaria</td><td className="num">{BAND_LABEL[row.band]}</td></tr>
                <tr><td>Documentazione</td><td className="num"><span className={`rsm-pill ${d.tone}`}>{d.label}</span></td></tr>
                <tr><td><b>Capitale assicurato</b></td><td className="num"><b>{eur(row.capital)}</b></td></tr>
                {row.scopertura > 0 && <tr><td>Capitale non coperto</td><td className="num" style={{ color: 'var(--c-error)' }}>{eur(row.scopertura)}</td></tr>}
                <tr><td>Tasso a {row.age} anni</td><td className="num">{rate4(row.rate)} ‰</td></tr>
                <tr><td>Sovrappremio</td><td className="num">{row.sovrPct} %</td></tr>
                <tr><td>Premio netto</td><td className="num">{eur(row.net)}</td></tr>
                <tr><td>Diritti</td><td className="num">{eur(RULES.rights)}</td></tr>
                <tr className="total"><td>Premio lordo annuo</td><td className="num">{eur(row.gross)}</td></tr>
              </tbody>
            </table>
            <p className="rsm-note" style={{ marginTop: 8 }}>Il premio non si scrive: si ricalcola da data di nascita, RAL, documentazione e tassi. Se cambia una regola, cambia anche qui.</p>
          </section>

          {row.band !== 'nessuna' && (
            <section>
              <h3 className="rsm-drawer-h">Documentazione sanitaria</h3>
              <ul className="rsm-list">
                <li><span>Richiesto</span> · <b>{d.need}</b></li>
                <li><span>Rapporto di visita</span> · <b>{row.doc.visit ? 'fornito' : 'non fornito'}</b></li>
                <li><span>Ok C.A. Vita</span> · <b>{row.doc.ok ? 'sì' : 'no'}</b></li>
                {row.warn && <li><span>Ultimo sollecito</span> · <b>{row.warn.replace('Sollecito del ', '')}</b></li>}
              </ul>
            </section>
          )}

          {(row.note || sameCf.length > 0) && (
            <section>
              <h3 className="rsm-drawer-h">Nota (resta interna)</h3>
              <div className="rsm-issue info">{row.note}</div>
            </section>
          )}

          <div className="rsm-row">
            <button className="btn btn-secondary">Modifica</button>
            {!row.exit && <button className="btn btn-secondary">Registra uscita</button>}
            {!row.exit && row.company === 'sgr' && <button className="btn btn-secondary">Passa ad Amundi RE</button>}
          </div>

          <section>
            <h3 className="rsm-drawer-h">Storico</h3>
            <ol className="rsm-timeline">
              {events.map((e, i) => (
                <li key={i} className={e.tone}>
                  <div className="rsm-tl-date">{fmtDate(e.date)}</div>
                  <div>
                    <div className="rsm-tl-title">{e.title}</div>
                    {e.lines.map((l, j) => <div key={j} className="rsm-sub">{l}</div>)}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </aside>
    </>
  )
}

