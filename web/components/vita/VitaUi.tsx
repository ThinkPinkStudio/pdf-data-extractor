'use client'

// Pezzi comuni delle pagine Polizza Vita: intestazione, schede per contraente,
// pillole di stato e scheda dell'assicurato (pannello laterale).
import { useEffect, useMemo } from 'react'
import { COMPANIES, RULES, eur, fmtDate, movements, rate4, ROWS } from '@/lib/vita/demo'
import type { CompanyKey, Computed } from '@/lib/vita/demo'
import { checkPerson } from '@/lib/rsm/rules.js'
import { missingDoc } from '@/lib/vita/rules.js'

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

export type DocMissing = 'visita' | 'ok' | 'accertamenti' | null

/** Stato della documentazione sanitaria di una persona, con che cosa manca. */
export function docState(r: Computed): { tone: 'off' | 'ok' | 'warn' | 'err'; label: string; need: string; missing: DocMissing } {
  if (r.band === 'nessuna') return { tone: 'off', label: 'Non richiesta', need: '', missing: null }
  const need = r.band === 'visita' ? 'Rapporto di visita medica' : 'Rapporto di visita + accertamenti o check-up'
  const missing = missingDoc({ band: r.band, doc: r.doc }) as DocMissing
  if (missing === null) return { tone: 'ok', label: 'Accettata', need, missing }
  if (missing === 'accertamenti') return { tone: 'warn', label: 'Mancano gli accertamenti', need, missing }
  if (missing === 'ok') return { tone: 'warn', label: 'Attende ok C.A. Vita', need, missing }
  return { tone: 'err', label: 'Mancante', need, missing }
}

/** Che cosa chiedere, per la mail all'Azienda. */
export const MISSING_TEXT: Record<Exclude<DocMissing, null>, string> = {
  visita: 'rapporto di visita medica',
  accertamenti: 'accertamenti sanitari o check-up degli ultimi 6 mesi',
  ok: 'documentazione inviata, in attesa della risposta di Crédit Agricole Vita',
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

const BAND_LABEL: Record<string, string> = { nessuna: 'fino a 400.000: nessun documento', visita: 'da 400.000 a 800.000: rapporto di visita', 'visita+accertamenti': 'oltre 800.000: visita + accertamenti o check-up' }

export function PersonPanel({ row, onClose }: { row: Computed; onClose: () => void }) {
  const issues = useMemo(() => checkPerson({ cognome: row.cognome, nome: row.nome, cf: row.cf, birthDate: row.birthDate }, 2026).issues.filter((i: { level: string }) => i.level === 'error'), [row])
  const d = docState(row)
  const mv = useMemo(() => movements().filter((m) => m.row.id === row.id), [row])
  // La stessa persona sull'altra polizza (passaggio tra SGR e RE durante l'anno).
  const sameCf = ROWS.filter((r) => r.cf === row.cf && r.id !== row.id)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const events: { date: string; tone: string; title: string; lines: string[] }[] = []
  const entered = row.entry > '2026-01-01'
  events.push({
    date: row.entry,
    tone: row.transferFrom ? 'promo' : entered ? 'new' : 'off',
    title: row.transferFrom ? `Entra in ${COMPANIES[row.company].name} da ${COMPANIES[row.transferFrom].name}`
      : entered ? `Inclusione in ${COMPANIES[row.company].name}`
        : `Stato di rischio al 01/01/2026 · ${COMPANIES[row.company].name}`,
    lines: [`Capitale ${eur(row.capital)} · premio lordo annuo ${eur(row.gross)}`],
  })
  if (row.remindedOn) events.push({ date: row.remindedOn, tone: 'promo', title: 'Promemoria documentazione', lines: [d.need ? `Richiesto: ${d.need.toLowerCase()}` : ''].filter(Boolean) })
  for (const m of mv) {
    if (m.kind === 'ESCLUSIONE') events.push({ date: m.date, tone: 'off', title: m.title, lines: [m.source, `Rimborso ${eur(Math.abs(m.gross || 0))} per ${m.days} giorni non goduti`].filter(Boolean) })
    // L'ingresso di metà anno paga il rateo, non il premio annuo: le due cifre vanno viste insieme.
    else if (events[0]) events[0].lines.push(`Rateo ${m.days}/365 dell'anno: ${eur(m.gross)} (diritti compresi)`)
  }
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
                <tr><td>{row.age == null ? 'Tasso' : `Tasso a ${row.age} anni`}</td><td className="num">{rate4(row.rate)} ‰</td></tr>
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
                {row.band === 'visita+accertamenti' && <li><span>Accertamenti o check-up</span> · <b>{row.doc.extra ? 'forniti' : 'non forniti'}</b></li>}
                <li><span>Ok C.A. Vita</span> · <b>{row.doc.ok ? 'sì' : 'no'}</b></li>
                {row.remindedOn && <li><span>Ultimo promemoria</span> · <b>{fmtDate(row.remindedOn)}</b></li>}
              </ul>
            </section>
          )}

          {row.note && (
            <section>
              <h3 className="rsm-drawer-h">Nota (resta interna)</h3>
              <div className="rsm-issue info">{row.note}</div>
            </section>
          )}

          {sameCf.length > 0 && (
            <section>
              <h3 className="rsm-drawer-h">Stessa persona sull&apos;altra polizza</h3>
              <ul className="rsm-list">
                {sameCf.map((o) => (
                  <li key={o.id}>{COMPANIES[o.company].name} · pol. {COMPANIES[o.company].policy} · {o.exit ? `uscita il ${fmtDate(o.exit)}` : `dal ${fmtDate(o.entry)}`}</li>
                ))}
              </ul>
            </section>
          )}

          <div className="rsm-row">
            <button className="btn btn-secondary">Modifica</button>
            {!row.exit && <button className="btn btn-secondary">Registra uscita</button>}
            {!row.exit && <button className="btn btn-secondary">Passa ad {COMPANIES[row.company === 'sgr' ? 're' : 'sgr'].name}</button>}
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

