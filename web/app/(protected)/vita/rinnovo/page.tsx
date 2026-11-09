'use client'

// Rinnovo di fine anno: si scarica l'elenco da mandare all'Azienda, si carica il
// file di ritorno con le RAL nuove e si vede cosa cambia prima di creare il
// programma dell'anno dopo (capitali, premi, soglie, età).
import { useMemo, useState } from 'react'
import { COMPANIES, RATES, RULES, ROWS, TODAY, eur, fmtDate, rate4, statusAt } from '@/lib/vita/demo'
import { CoverPill, VitaHeader } from '@/components/vita/VitaUi'
import { computeInsured } from '@/lib/vita/rules.js'

const NEXT = '2027-01-01'

export default function VitaRinnovoPage() {
  const [step, setStep] = useState(2)
  const rows = useMemo(() => ROWS.filter((r) => statusAt(r, TODAY) === 'attivo').map((r) => {
    const n = r.ral2027 === null || r.ral2027 === undefined ? null : r.ral2027
    const next = n == null ? null : computeInsured({ birthDate: r.birthDate, ral: n, keyFigure: r.keyFigure, doc: r.doc, sovrPct: r.sovrPct }, RATES, NEXT, RULES)
    const flags: { tone: string; text: string }[] = []
    if (n == null) flags.push({ tone: 'err', text: 'RAL non comunicata' })
    if (next) {
      // Una fascia sanitaria più alta vuole documenti nuovi, anche partendo da «visita».
      const level = (b: string) => (b === 'nessuna' ? 0 : b === 'visita' ? 1 : 2)
      if (level(next.band) > level(r.band)) flags.push({ tone: 'warn', text: next.band === 'visita' ? 'Supera 400.000: serve il rapporto di visita' : 'Supera 800.000: servono accertamenti o check-up' })
      if (next.cover !== r.cover) flags.push({ tone: next.cover === 'FUORI COPERTURA' ? 'err' : 'warn', text: next.cover === 'SOLO CASO MORTE' ? 'Compie 71 anni: solo caso morte' : next.cover === 'FUORI COPERTURA' ? 'Oltre gli 80 anni: da segnalare al cliente' : 'Cambia la garanzia' })
    }
    return { r, n, next, flags }
  }), [])
  const changed = rows.filter((x) => x.flags.length > 0)
  const missing = rows.filter((x) => x.n == null).length
  // Il confronto vale solo per chi ha la RAL 2027: con quelle mancanti sembrerebbe un calo.
  const withRal = rows.filter((x) => x.next)
  const premNow = withRal.reduce((s, x) => s + (x.r.gross || 0), 0)
  const premNext = withRal.reduce((s, x) => s + (x.next?.gross || 0), 0)

  return (
    <div className="rsm">
      <VitaHeader kicker="Dal programma 2026 al 2027" title="Rinnovo di fine anno">
        <button className="btn btn-secondary">Scarica l&apos;elenco per l&apos;Azienda</button>
        <button className="btn btn-primary" disabled={missing > 0}>Crea il programma 2027</button>
      </VitaHeader>

      <ol className="rsm-steps">
        {['Scarica l’elenco da mandare all’Azienda', 'Carica il file con le RAL nuove', 'Controlla cosa cambia e conferma'].map((t, i) => (
          <li key={t} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}><button className="rsm-sort" onClick={() => setStep(i + 1)} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span className="n">{step > i + 1 ? '✓' : i + 1}</span>{t}</button></li>
        ))}
      </ol>

      <div className="rsm-box">
        <div className="rsm-box-body" style={{ flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <span className="rsm-pill ok">File letto</span>
          <span><b>RAL 2027 amundi.xlsx</b> · {rows.length - missing} RAL aggiornate su {rows.length} assicurati in copertura</span>
          <span className="rsm-muted">il file ha solo codice fiscale e RAL: gli altri dati restano quelli del programma</span>
        </div>
      </div>

      <div className="rsm-kpis">
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Premio lordo annuo</span></div><div className="rsm-kpi-num">{eur(premNext)}</div><div className="rsm-kpi-line">2026: {eur(premNow)} · {premNext >= premNow ? '+' : '−'}{eur(Math.abs(premNext - premNow))}{missing > 0 ? ` · ${withRal.length} di ${rows.length} assicurati` : ''}</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Da guardare</span></div><div className="rsm-kpi-num" style={{ color: changed.length ? 'var(--c-warning)' : undefined }}>{changed.length}</div><div className="rsm-kpi-line">cambiano fascia, garanzia o mancano dati</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>RAL mancanti</span></div><div className="rsm-kpi-num" style={{ color: missing ? 'var(--c-error)' : undefined }}>{missing}</div><div className="rsm-kpi-line">da chiedere prima di rinnovare</div></div>
      </div>

      <div className="rsm-box">
        <div className="rsm-box-head"><span className="rsm-box-title">Cosa cambia per ogni assicurato</span><span className="rsm-muted">età e tasso al {fmtDate(NEXT)}</span></div>
        <div className="rsm-scroll tall">
          <table className="rsm-table">
            <thead><tr><th>Assicurato</th><th>Polizza</th><th className="num">RAL 2026 → 2027</th><th className="num">Età</th><th className="num">Tasso ‰</th><th className="num">Capitale 2027</th><th className="num">Premio 2026 → 2027</th><th>Garanzie</th><th>Da controllare</th></tr></thead>
            <tbody>
              {[...rows].sort((a, b) => b.flags.length - a.flags.length || a.r.cognome.localeCompare(b.r.cognome)).map(({ r, n, next, flags }) => (
                <tr key={r.id}>
                  <td><span className="rsm-who">{r.cognome} {r.nome}</span></td>
                  <td className="nowrap">{COMPANIES[r.company].name}</td>
                  <td className="num">{eur(r.ral)} → {n == null ? <span style={{ color: 'var(--c-error)' }}>mancante</span> : eur(n)}</td>
                  <td className="num">{r.age} → {next?.age ?? '—'}</td>
                  <td className="num">{rate4(next?.rate ?? null)}</td>
                  <td className="num">{next ? eur(next.capital) : '—'}{next && next.scopertura > 0 && <div className="rsm-sub" style={{ color: 'var(--c-error)' }}>non coperti {eur(next.scopertura)}</div>}</td>
                  <td className="num">{eur(r.gross)} → {eur(next?.gross ?? null)}</td>
                  <td>{next ? <CoverPill cover={next.cover} /> : '—'}</td>
                  <td>{flags.length === 0 ? <span className="rsm-sub">nessuna variazione</span> : flags.map((f) => <div key={f.text}><span className={`rsm-pill ${f.tone}`}>{f.text}</span></div>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
