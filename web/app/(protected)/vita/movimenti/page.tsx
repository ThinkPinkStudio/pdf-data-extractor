'use client'

// Movimenti dell'anno e regolazione del premio: inclusioni, esclusioni e
// passaggi tra le due polizze, pro-rata a giorni fino al 31/12. Le entrate e le
// uscite arrivano per mail: si incolla il testo e l'app propone le righe.
import { useMemo, useState } from 'react'
import { COMPANIES, RATES, ROWS, RULES, TODAY, YEAR_END, YEAR_START, eur, fmtDate, movements, rate4, statusAt } from '@/lib/vita/demo'
import { VitaHeader } from '@/components/vita/VitaUi'
import type { Computed } from '@/lib/vita/demo'
import { computeInsured, movementOf } from '@/lib/vita/rules.js'
import { decodeCf } from '@/lib/rsm/rules.js'

const SAMPLE = `Buongiorno,
vi chiedo di includere in polizza vita dal 25/11/2026:

Verdi Matilde  VRDMLD99A41F205H
RAL 62.000 euro, livello Quadro - Livello 4

Grazie, Roberto`

// Il verbo della mail decide il movimento: non si assume mai un'inclusione.
const OUT_WORDS = /\b(esclu[dst]\w*|cessa\w*|dimissi\w*|licenzia\w*|uscita|pensionament\w*|termina\w*)/i
const IN_WORDS = /\b(inclu[dst]\w*|inseri\w*|assunzion\w*|assunt\w*|nuovo assicurat\w*|entrata)/i

/** Quello che si è capito dalla mail: `miss` elenca ciò che manca per proporre la riga. */
interface ReadRow {
  miss: string[]
  err?: string
  iso?: string
  cf?: string
  cfOk?: boolean
  kind?: 'INCLUSIONE' | 'ESCLUSIONE'
  outOfYear?: boolean
  who?: Computed
  birth?: string | null
  ral?: number
  capital?: number
  rate?: number | null
  age?: number | null
  m?: { days: number; frac: number; net: number | null; rights: number; gross: number | null }
}

export default function VitaMovimentiPage() {
  const [text, setText] = useState(SAMPLE)
  const [kind, setKind] = useState<'tutti' | 'INCLUSIONE' | 'ESCLUSIONE'>('tutti')
  const all = useMemo(() => movements(), [])
  const list = all.filter((m) => kind === 'tutti' || m.kind === kind)
  const inc = all.filter((m) => m.kind === 'INCLUSIONE')
  const exc = all.filter((m) => m.kind === 'ESCLUSIONE')
  const saldo = all.reduce((s, m) => s + (m.gross || 0), 0)

  // Riga letta dalla mail. Il movimento viene dal verbo; la data di nascita (e quindi
  // l'età e il tasso) dal codice fiscale. Quello che non si capisce si dice, non si indovina.
  const read: ReadRow = useMemo<ReadRow>(() => {
    const miss: string[] = []
    const date = /(?:dal|dalla data del|a (?:partire|decorrere) dal|con decorrenza(?: dal)?)\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/i.exec(text)
    const cfm = /\b([A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z])\b/.exec(text.toUpperCase())
    const ralm = /RAL\s*(?:annua\s*(?:lorda\s*)?)?(?:di\s*)?(?:€|euro\s*)?\s*([\d.]+(?:,\d{1,2})?)/i.exec(text)
    const out = OUT_WORDS.test(text)
    const kindRead: 'INCLUSIONE' | 'ESCLUSIONE' | null = out ? 'ESCLUSIONE' : IN_WORDS.test(text) ? 'INCLUSIONE' : null
    if (!date) miss.push('la data di decorrenza («dal 25/11/2026»)')
    if (!cfm) miss.push('il codice fiscale')
    if (!kindRead) miss.push('se è un\'inclusione o un\'esclusione')
    if (!date || !cfm || !kindRead) return { miss }

    const iso = `${date[3]}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}`
    const cf = cfm[1]
    const d = decodeCf(cf, 2026) as { valid: boolean; checkOk: boolean; birthDate: string | null }
    const outOfYear = iso < YEAR_START || iso > YEAR_END
    const base = { miss: [] as string[], iso, cf, kind: kindRead, cfOk: d.checkOk, outOfYear }
    if (outOfYear) return { ...base, err: `La data ${fmtDate(iso)} non cade nel programma 2026.` }
    if (!d.valid || !d.birthDate) return { ...base, err: 'Il codice fiscale non è valido: controlla la mail.' }

    if (kindRead === 'ESCLUSIONE') {
      // Per un'uscita non servono RAL né età: contano il capitale e il tasso già pagati.
      const who = ROWS.find((r) => r.cf === cf && statusAt(r, TODAY) === 'attivo')
      if (!who) return { ...base, err: 'Questa persona non risulta in copertura: controlla il codice fiscale.' }
      const m = movementOf({ kind: 'ESCLUSIONE', date: iso, capital: who.capital, rate: who.rate, sovrPct: who.sovrPct, paid: { capital: who.capital, rate: who.rate as number } }, YEAR_END, RULES)
      return { ...base, who, m, birth: who.birthDate, capital: who.capital, rate: who.rate, age: who.age }
    }

    if (!ralm) return { ...base, err: 'Manca la RAL: senza quella non si calcola il capitale.' }
    const ral = Number(ralm[1].replace(/\./g, '').replace(',', '.'))
    const c = computeInsured({ birthDate: d.birthDate, ral, keyFigure: false, doc: {}, sovrPct: 0 }, RATES, iso, RULES)
    if (c.rate == null) return { ...base, err: `Età computabile ${c.age} anni: fuori dalla tabella dei tassi (18-80), il premio va concordato con la compagnia.` }
    const m = movementOf({ kind: 'INCLUSIONE', date: iso, capital: c.capital, rate: c.rate }, YEAR_END, RULES)
    return { ...base, ral, c, m, birth: d.birthDate, capital: c.capital, rate: c.rate, age: c.age }
  }, [text])

  return (
    <div className="rsm">
      <VitaHeader kicker={`Polizza Vita 2026 · regolazione al ${fmtDate(YEAR_END)}`} title="Movimenti e regolazione">
        <button className="btn btn-secondary">Esporta la regolazione</button>
      </VitaHeader>

      <div className="rsm-kpis">
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Inclusioni</span></div><div className="rsm-kpi-num">{inc.length}</div><div className="rsm-kpi-line">premio da pagare {eur(inc.reduce((s, m) => s + (m.gross || 0), 0))}</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Esclusioni</span></div><div className="rsm-kpi-num">{exc.length}</div><div className="rsm-kpi-line">premio da rimborsare {eur(Math.abs(exc.reduce((s, m) => s + (m.gross || 0), 0)))}</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Saldo della regolazione</span></div><div className="rsm-kpi-num">{eur(saldo)}</div><div className="rsm-kpi-line">inclusioni − esclusioni, diritti compresi</div></div>
      </div>

      <div className="rsm-grid2">
        <div className="rsm-box">
          <div className="rsm-box-head"><span className="rsm-box-title">Incolla la mail dell&apos;Azienda</span><span className="rsm-muted">o trascina il file .eml</span></div>
          <div className="rsm-box-body">
            <label className="rsm-field">Testo della mail<textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} /></label>
            {read.miss.length > 0 ? (
              <p className="rsm-note">Dalla mail non si capisce ancora {read.miss.join(', ')}. Serve anche la RAL per le inclusioni.</p>
            ) : (
              <div className="rsm-panel">
                <div className="rsm-box-title">Letto dalla mail</div>
                <table className="rsm-table"><tbody>
                  <tr><td>Movimento</td><td className="num"><span className={`rsm-pill ${read.kind === 'ESCLUSIONE' ? 'off' : 'new'}`}>{read.kind === 'ESCLUSIONE' ? 'Esclusione' : 'Inclusione'}</span> dal {fmtDate(read.iso)}</td></tr>
                  <tr><td>Codice fiscale</td><td className="num"><span className="rsm-cf">{read.cf}</span>{!read.cfOk && <div className="rsm-sub" style={{ color: 'var(--c-warning)' }}>carattere di controllo non valido</div>}</td></tr>
                  {read.err ? <tr><td colSpan={2}><div className="rsm-issue error">{read.err}</div></td></tr> : (
                    <>
                      {read.who
                        ? <tr><td>Assicurato</td><td className="num">{read.who.cognome} {read.who.nome}<div className="rsm-sub">{COMPANIES[read.who.company].name} · in copertura dal {fmtDate(read.who.entry)}</div></td></tr>
                        : <tr><td>Data di nascita</td><td className="num">{fmtDate(read.birth as string)}<div className="rsm-sub">ricavata dal codice fiscale</div></td></tr>}
                      <tr><td>{read.kind === 'ESCLUSIONE' ? 'Capitale assicurato' : 'RAL → capitale'}</td><td className="num">{read.kind === 'ESCLUSIONE' ? eur(read.capital) : <>{eur(read.ral)} → {eur(read.capital)}</>}</td></tr>
                      <tr><td>Età · tasso</td><td className="num">{read.age} anni · {rate4(read.rate ?? null)} ‰{read.kind === 'ESCLUSIONE' && <div className="rsm-sub">alla decorrenza, come il premio già pagato</div>}</td></tr>
                      <tr><td>Pro-rata</td><td className="num">{read.m?.days}/365 giorni</td></tr>
                      <tr className="total"><td>{read.kind === 'ESCLUSIONE' ? 'Rimborso (senza diritti)' : 'Premio dell’anno (diritti inclusi)'}</td><td className="num">{eur(read.m?.gross)}</td></tr>
                    </>
                  )}
                </tbody></table>
                <div className="rsm-row"><button className="btn btn-primary" disabled={!!read.err}>{read.kind === 'ESCLUSIONE' ? 'Registra l’esclusione' : 'Registra l’inclusione'}</button><button className="btn btn-secondary">Correggi i dati</button></div>
              </div>
            )}
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
              <tr className="total"><td colSpan={6}>{kind === 'tutti' ? 'Saldo della regolazione' : kind === 'INCLUSIONE' ? 'Totale delle inclusioni' : 'Totale delle esclusioni'}</td><td className="num">{eur(list.reduce((s, m) => s + (m.gross || 0), 0))}</td><td /></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
