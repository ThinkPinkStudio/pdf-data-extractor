'use client'

// Movimenti dell'anno e regolazione del premio: inclusioni, esclusioni e
// passaggi tra le due polizze, pro-rata a giorni fino al 31/12. Le entrate e le
// uscite arrivano per mail: si incolla il testo e l'app propone le righe.
import { useMemo, useState } from 'react'
import { COMPANIES, RATES, RULES, YEAR_END, eur, fmtDate, movements, rate4 } from '@/lib/vita/demo'
import { VitaHeader } from '@/components/vita/VitaUi'
import { computeInsured, movementOf } from '@/lib/vita/rules.js'

const SAMPLE = `Buongiorno,
vi chiedo di includere in polizza vita dal 25/11/2026:

Verdi Matilde  VRDMLD99A41F205H
RAL 62.000 euro, livello Quadro - Livello 4

Grazie, Roberto`

export default function VitaMovimentiPage() {
  const [text, setText] = useState(SAMPLE)
  const [kind, setKind] = useState<'tutti' | 'INCLUSIONE' | 'ESCLUSIONE'>('tutti')
  const all = useMemo(() => movements(), [])
  const list = all.filter((m) => kind === 'tutti' || m.kind === kind)
  const inc = all.filter((m) => m.kind === 'INCLUSIONE')
  const exc = all.filter((m) => m.kind === 'ESCLUSIONE')
  const saldo = all.reduce((s, m) => s + (m.gross || 0), 0)

  // Riga letta dalla mail di prova (calcolata dal motore).
  const read = useMemo(() => {
    const date = /dal\s+(\d{2})\/(\d{2})\/(\d{4})/.exec(text)
    const ral = /RAL\s+([\d.]+)/.exec(text)
    const cf = /\b([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])\b/.exec(text)
    if (!date || !ral || !cf) return null
    const iso = `${date[3]}-${date[2]}-${date[1]}`
    const ralN = Number(ral[1].replace(/\./g, ''))
    const birth = '1999-01-01'
    const c = computeInsured({ birthDate: birth, ral: ralN, keyFigure: false, doc: {}, sovrPct: 0 }, RATES, iso, RULES)
    const m = movementOf({ kind: 'INCLUSIONE', date: iso, capital: c.capital, rate: c.rate }, YEAR_END, RULES)
    return { iso, ral: ralN, cf: cf[1], c, m, birth }
  }, [text])

  return (
    <div className="rsm">
      <VitaHeader kicker={`Polizza Vita 2026 · regolazione al ${fmtDate(YEAR_END)}`} title="Movimenti e regolazione">
        <button className="btn btn-secondary">Esporta la regolazione</button>
      </VitaHeader>

      <div className="rsm-kpis">
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Inclusioni</span></div><div className="rsm-kpi-num">{inc.length}</div><div className="rsm-kpi-line">premio da pagare {eur(inc.reduce((s, m) => s + (m.gross || 0), 0))}</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Esclusioni</span></div><div className="rsm-kpi-num">{exc.length}</div><div className="rsm-kpi-line">premio da rimborsare {eur(exc.reduce((s, m) => s + (m.gross || 0), 0))}</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Saldo della regolazione</span></div><div className="rsm-kpi-num">{eur(saldo)}</div><div className="rsm-kpi-line">inclusioni − esclusioni, diritti compresi</div></div>
      </div>

      <div className="rsm-grid2">
        <div className="rsm-box">
          <div className="rsm-box-head"><span className="rsm-box-title">Incolla la mail dell&apos;Azienda</span><span className="rsm-muted">o trascina il file .eml</span></div>
          <div className="rsm-box-body">
            <label className="rsm-field">Testo della mail<textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} /></label>
            {read ? (
              <div className="rsm-panel">
                <div className="rsm-box-title">Letto dalla mail</div>
                <table className="rsm-table"><tbody>
                  <tr><td>Movimento</td><td className="num"><span className="rsm-pill new">Inclusione</span> dal {fmtDate(read.iso)}</td></tr>
                  <tr><td>Codice fiscale</td><td className="num"><span className="rsm-cf">{read.cf}</span></td></tr>
                  <tr><td>RAL → capitale</td><td className="num">{eur(read.ral)} → {eur(read.c.capital)}</td></tr>
                  <tr><td>Età · tasso</td><td className="num">{read.c.age} anni · {rate4(read.c.rate)} ‰</td></tr>
                  <tr><td>Pro-rata</td><td className="num">{read.m.days}/365 giorni</td></tr>
                  <tr className="total"><td>Premio dell&apos;anno (diritti inclusi)</td><td className="num">{eur(read.m.gross)}</td></tr>
                </tbody></table>
                <div className="rsm-row"><button className="btn btn-primary">Registra l&apos;inclusione</button><button className="btn btn-secondary">Correggi i dati</button></div>
              </div>
            ) : <p className="rsm-note">Incolla una mail con data, codice fiscale e RAL: l&apos;app propone la riga da registrare.</p>}
          </div>
        </div>

        <div className="rsm-box">
          <div className="rsm-box-head"><span className="rsm-box-title">Registra a mano</span></div>
          <div className="rsm-box-body">
            <div className="rsm-row">
              <label className="rsm-field">Movimento<select defaultValue="INCLUSIONE"><option value="INCLUSIONE">Inclusione</option><option value="ESCLUSIONE">Esclusione</option><option value="PASSAGGIO">Passaggio SGR ↔ RE</option></select></label>
              <label className="rsm-field">Polizza<select defaultValue="sgr"><option value="sgr">{COMPANIES.sgr.name} · {COMPANIES.sgr.policy}</option><option value="re">{COMPANIES.re.name} · {COMPANIES.re.policy}</option></select></label>
              <label className="rsm-field w-date">Dal<input type="date" defaultValue="2026-11-25" /></label>
            </div>
            <div className="rsm-row">
              <label className="rsm-field">Cognome<input defaultValue="Verdi" /></label>
              <label className="rsm-field">Nome<input defaultValue="Matilde" /></label>
              <label className="rsm-field">Codice fiscale<input defaultValue="VRDMLD99A41F205H" style={{ width: 190 }} /></label>
            </div>
            <div className="rsm-row">
              <label className="rsm-field">RAL<input defaultValue="62.000,00" style={{ width: 130 }} /></label>
              <label className="rsm-field">Livello<select defaultValue="Quadro - Livello 4"><option>Quadro - Livello 4</option><option>Livello Dirigente</option><option>Impiegato</option></select></label>
              <label className="rsm-field">Figura chiave<select defaultValue="NO"><option>NO</option><option>SI</option></select></label>
            </div>
            <p className="rsm-note">Per le uscite la data è il giorno dopo la comunicazione. Il rimborso usa il tasso e il capitale già pagati a inizio anno.</p>
          </div>
        </div>
      </div>

      <div className="rsm-box">
        <div className="rsm-box-head">
          <span className="rsm-box-title">Movimenti del 2026</span>
          <div className="rsm-tabs">{(['tutti', 'INCLUSIONE', 'ESCLUSIONE'] as const).map((k) => <button key={k} className={`rsm-tab${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>{k === 'tutti' ? 'Tutti' : k === 'INCLUSIONE' ? 'Inclusioni' : 'Esclusioni'}</button>)}</div>
        </div>
        <div className="rsm-scroll">
          <table className="rsm-table">
            <thead><tr><th>Data</th><th>Assicurato</th><th>Polizza</th><th>Movimento</th><th className="num">Capitale</th><th className="num">Giorni</th><th className="num">Premio</th><th>Fonte</th></tr></thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.key}>
                  <td className="nowrap">{fmtDate(m.date)}</td>
                  <td><span className="rsm-who">{m.row.cognome} {m.row.nome}</span><div className="rsm-cf">{m.row.cf}</div></td>
                  <td className="nowrap">{COMPANIES[m.row.company].name}</td>
                  <td><span className={`rsm-pill ${m.transfer || m.title.startsWith('Passaggio') ? 'promo' : m.kind === 'INCLUSIONE' ? 'new' : 'off'}`}>{m.title}</span></td>
                  <td className="num">{eur(m.capital)}</td>
                  <td className="num">{m.days}/365</td>
                  <td className="num" style={{ color: (m.gross || 0) < 0 ? 'var(--c-error)' : undefined }}>{eur(m.gross)}</td>
                  <td className="rsm-sub">{m.source}</td>
                </tr>
              ))}
              <tr className="total"><td colSpan={6}>Saldo della regolazione</td><td className="num">{eur(list.reduce((s, m) => s + (m.gross || 0), 0))}</td><td /></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
