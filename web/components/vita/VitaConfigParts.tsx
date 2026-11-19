'use client'

// Pezzi delle impostazioni Vita in comune fra «Tassi e regole» e l'import
// guidato: modo di calcolo, categorie con capitale e premio fissi, regole del
// pro-rata. Ogni scelta ha sotto una riga che dice che cosa cambia, e un
// esempio di calcolo che si aggiorna mentre si scrive.
import { useState } from 'react'
import { computeInsured, fmtDate, movementOf, rulesOf, yearEndOf } from '@/lib/vita/rules.js'
import type { VitaCategory, VitaConfig } from '@/lib/vita/types'
import { eur } from './useVita'
import ValueInput from '@/components/ValueInput'
import { insurerOf } from '@/lib/vita/types'

const n2 = (v: string) => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0
const show = (v: number | undefined, zero = false) => (v == null || (v === 0 && !zero) ? '' : v.toLocaleString('it-IT', { maximumFractionDigits: 6 }))

/** Campo numerico all'italiana: si scrive «51.645,59» o «1,96» e resta com'è finché si scrive. */
function Num({ value, onChange, width = 120, label, disabled, zero }: { value: number | undefined; onChange: (n: number) => void; width?: number; label: string; disabled?: boolean; zero?: boolean }) {
  const [txt, setTxt] = useState<string | null>(null)
  return (
    <input aria-label={label} disabled={disabled} value={txt ?? show(value, zero)} style={{ width }}
      onChange={(e) => { setTxt(e.target.value); onChange(n2(e.target.value)) }} onBlur={() => setTxt(null)} />
  )
}

export function CalcModeBox({ cfg, setCfg, disabled }: { cfg: VitaConfig; setCfg: (c: VitaConfig) => void; disabled?: boolean }) {
  const r = rulesOf(cfg.rules)
  const setRules = (patch: Partial<VitaConfig['rules']>) => setCfg({ ...cfg, rules: { ...cfg.rules, ...patch } })
  return (
    <div className="rsm-box">
      <div className="rsm-box-head"><span className="rsm-box-title">Come si calcola il capitale</span></div>
      <div className="rsm-box-body">
        <div className="rsm-rules">
          <label className="rsm-rule">
            <input type="radio" name="capmode" disabled={disabled} checked={r.capitalMode !== 'categoria'} onChange={() => setRules({ capitalMode: 'ral', grossRounding: 'eccesso', rightsProRata: false, countLastDay: false })} />
            <span><b>Dalla RAL</b> — capitale = {String(r.multiplier).replace('.', ',')} × RAL, tasso per età, documentazione sanitaria sopra le soglie.<span className="rsm-help">Come la polizza di Amundi.</span></span>
          </label>
          <label className="rsm-rule">
            <input type="radio" name="capmode" disabled={disabled} checked={r.capitalMode === 'categoria'} onChange={() => setRules({ capitalMode: 'categoria', grossRounding: 'nessuno', rightsProRata: true, categories: r.categories?.length ? r.categories : [{ key: 'c1', name: 'DIPENDENTI', capital: 0, rate: 0, premium: 0, match: '' }] })} />
            <span><b>Fisso per categoria</b> — ogni categoria ha il suo capitale e il suo premio, uguali per tutti.<span className="rsm-help">Come le polizze di Agos: LTC per tutti i dipendenti, Vita per quadri e dirigenti.</span></span>
          </label>
        </div>
      </div>
    </div>
  )
}

export function CategoriesBox({ cfg, setCfg, disabled }: { cfg: VitaConfig; setCfg: (c: VitaConfig) => void; disabled?: boolean }) {
  const cats = cfg.rules.categories || []
  const set = (list: VitaCategory[]) => setCfg({ ...cfg, rules: { ...cfg.rules, categories: list } })
  const patch = (i: number, p: Partial<VitaCategory>) => set(cats.map((c, j) => (j === i ? { ...c, ...p } : c)))
  const ex = cats.length === 1 && !String(cats[0].match || '').trim()
  return (
    <div className="rsm-box">
      <div className="rsm-box-head"><span className="rsm-box-title">Categorie, capitali e premi</span><span className="rsm-note">{cats.length} {cats.length === 1 ? 'categoria' : 'categorie'}</span></div>
      <div className="rsm-scroll">
        <table className="rsm-table">
          <thead><tr><th>Categoria</th><th className="num">Capitale</th><th className="num">Tasso ‰</th><th className="num">o premio annuo</th><th>Chi ci entra: parole del livello</th><th /></tr></thead>
          <tbody>
            {cats.map((c, i) => (
              <tr key={c.key}>
                <td><input aria-label="Nome della categoria" disabled={disabled} value={c.name} onChange={(e) => patch(i, { name: e.target.value })} style={{ width: 150 }} /></td>
                <td className="num"><Num label="Capitale" disabled={disabled} value={c.capital} onChange={(n) => patch(i, { capital: n })} width={120} /></td>
                <td className="num"><Num label="Tasso per mille" disabled={disabled || !!c.premium} value={c.rate} onChange={(n) => patch(i, { rate: n })} width={90} /></td>
                <td className="num"><Num label="Premio annuo" disabled={disabled} value={c.premium} onChange={(n) => patch(i, { premium: n })} width={100} /></td>
                <td><input aria-label="Parole del livello" disabled={disabled} value={c.match} onChange={(e) => patch(i, { match: e.target.value })} placeholder={cats.length === 1 ? 'vuoto = tutti' : 'es. quadro'} style={{ width: 200 }} /></td>
                <td>{!disabled && cats.length > 1 && <button className="rsm-mini" aria-label="Togli la categoria" onClick={() => set(cats.filter((_, j) => j !== i))}>×</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rsm-box-body">
        {!disabled && <div className="rsm-row"><button className="btn btn-secondary" onClick={() => set([...cats, { key: `c${Date.now().toString(36)}`, name: '', capital: 0, rate: 0, premium: 0, match: '' }])}>Aggiungi una categoria</button></div>}
        <p className="rsm-note">
          Il premio annuo si scrive oppure si calcola dal tasso (capitale × tasso ‰); se c&apos;è il premio, vince lui.
          La categoria di ogni persona si legge dal suo livello: chi ha nel livello una delle parole («quadro», «dirigente») entra in quella categoria.
          {ex ? ' Con una sola categoria senza parole entrano tutti.' : ' Chi non ha nessuna delle parole non è in questa polizza (per esempio gli impiegati nella Vita Quadri e Dirigenti).'}
        </p>
      </div>
    </div>
  )
}

export function MovementRulesBox({ cfg, setCfg, disabled }: { cfg: VitaConfig; setCfg: (c: VitaConfig) => void; disabled?: boolean }) {
  const r = rulesOf(cfg.rules)
  const setRules = (patch: Partial<VitaConfig['rules']>) => setCfg({ ...cfg, rules: { ...cfg.rules, ...patch } })
  const end = fmtDate(yearEndOf(cfg))
  return (
    <div className="rsm-box">
      <div className="rsm-box-head"><span className="rsm-box-title">Premi, entrate e uscite</span></div>
      <div className="rsm-box-body">
        <div className="rsm-row">
          <label className="rsm-field">Diritti per assicurato<ValueInput label="Diritti" disabled={disabled} value={r.rights} onChange={(v) => setRules({ rights: v })} width={90}
            bases={[{ key: 'premio', label: 'premio netto annuo' }, { key: 'capitale', label: 'capitale' }]} /></label>
          <label className="rsm-field">Giorni dell&apos;anno per il pro-rata
            <select disabled={disabled} value={r.yearDays || '365'} onChange={(e) => setRules({ yearDays: e.target.value as '365' })}>
              <option value="365">365 (come i fogli del cliente)</option>
              <option value="reali">I giorni veri dell&apos;anno (366 se bisestile)</option>
              <option value="360">360</option>
            </select>
          </label>
          <label className="rsm-field">Arrotondamento del premio
            <select disabled={disabled} value={r.grossRounding} onChange={(e) => setRules({ grossRounding: e.target.value as 'eccesso' })}>
              <option value="eccesso">Per eccesso al centesimo</option>
              <option value="normale">Al centesimo più vicino</option>
              <option value="nessuno">Nessuno: decimali pieni, il totale li somma</option>
            </select>
          </label>
        </div>
        <div className="rsm-rules">
          <label className="rsm-rule"><input type="checkbox" disabled={disabled} checked={!!r.rightsProRata} onChange={(e) => setRules({ rightsProRata: e.target.checked })} />
            <span>Chi entra in corso d&apos;anno paga anche i diritti in pro-rata<span className="rsm-help">{r.rightsProRata ? 'Premio annuo con i diritti × giorni / 365.' : 'Premio × giorni / 365, più i diritti interi.'} Chi esce ha il rimborso del solo premio, senza diritti.</span></span></label>
          <label className="rsm-rule"><input type="checkbox" disabled={disabled} checked={!!r.countLastDay} onChange={(e) => setRules({ countLastDay: e.target.checked })} />
            <span>I giorni si contano fino al {fmtDate(cfg.periodEnd)} (scadenza della polizza)<span className="rsm-help">Altrimenti fino al {fmtDate(yearEndOf({ ...cfg, rules: { ...cfg.rules, countLastDay: false } }))}. Adesso: giorni dal movimento al {end}.</span></span></label>
          <label className="rsm-rule"><input type="checkbox" disabled={disabled} checked={r.exitNextDay !== false} onChange={(e) => setRules({ exitNextDay: e.target.checked })} />
            <span>Nel file mensile la data di cessazione è l&apos;ultimo giorno di lavoro: l&apos;uscita è dal giorno dopo</span></label>
        </div>
        <div className="rsm-row" style={{ marginTop: 8 }}>
          <label className="rsm-field">Passaggi di livello del file mensile: decorrenza
            <select disabled={disabled} value={r.transferDate || 'file'} onChange={(e) => setRules({ transferDate: e.target.value as 'file' })}>
              <option value="file">La data scritta nel file (es. 30/06 → 30/06)</option>
              <option value="inizioMese">Il 1° del mese di quella data (30/06 → 01/06)</option>
              <option value="giornoDopo">Il giorno dopo (30/06 → 01/07)</option>
              <option value="meseDopo">Il 1° del mese successivo (15/06 → 01/07)</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  )
}

/** Esempio di calcolo con le regole di adesso: premio annuo, chi entra e chi esce a metà anno. */
export function VitaExample({ cfg }: { cfg: VitaConfig }) {
  const r = rulesOf(cfg.rules)
  const y = cfg.periodStart.slice(0, 4)
  const inD = `${y}-04-01`
  const outD = `${y}-09-01`
  const cats: VitaCategory[] = r.capitalMode === 'categoria' ? (r.categories || []) : []
  const lines = (r.capitalMode === 'categoria' ? cats.slice(0, 3) : [{ name: 'RAL 60.000', key: 'ral' } as VitaCategory]).map((c: VitaCategory) => {
    const p = r.capitalMode === 'categoria'
      ? { level: c.match ? c.match.split(',')[0] : c.name, birthDate: `${+y - 40}-06-15`, ral: 0, keyFigure: false, doc: {}, sovrPct: 0 }
      : { level: '', birthDate: `${+y - 40}-06-15`, ral: 60000, keyFigure: false, doc: {}, sovrPct: 0 }
    const k = computeInsured(p, cfg.rates, cfg.periodStart, cfg.rules) as { capital: number; rate: number | null; gross: number | null }
    const ye = yearEndOf(cfg)
    const mi = movementOf({ kind: 'INCLUSIONE', date: inD, capital: k.capital, rate: k.rate }, ye, cfg.rules) as { gross: number | null; days: number }
    const mo = movementOf({ kind: 'ESCLUSIONE', date: outD, capital: k.capital, rate: k.rate, paid: { capital: k.capital, rate: k.rate as number } }, ye, cfg.rules) as { gross: number | null; days: number }
    return { name: c.name || '—', ...k, mi, mo }
  })
  return (
    <div className="rsm-box">
      <div className="rsm-box-head"><span className="rsm-box-title">Esempio con le regole di adesso</span></div>
      <div className="rsm-scroll">
        <table className="rsm-table">
          <thead><tr><th>{r.capitalMode === 'categoria' ? 'Categoria' : 'Assicurato di 40 anni'}</th><th className="num">Capitale</th><th className="num">Premio annuo</th><th className="num">Entra il {fmtDate(inD)}</th><th className="num">Esce il {fmtDate(outD)}</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.name}>
                <td>{l.name}</td>
                <td className="num">{eur(l.capital)}</td>
                <td className="num">{l.gross == null ? '—' : eur(l.gross)}</td>
                <td className="num">{l.mi.gross == null ? '—' : eur(l.mi.gross)}<div className="rsm-sub">{l.mi.days} giorni</div></td>
                <td className="num">{l.mo.gross == null ? '—' : eur(l.mo.gross)}<div className="rsm-sub">rimborso, {l.mo.days} giorni</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Testi e parole della polizza: nome della compagnia (ok sanitario, mail),
 * frasi della mail per la documentazione sanitaria, parole in più per i titoli
 * delle sezioni del file mensile.
 */
export function VitaTextsBox({ cfg, setCfg, disabled }: { cfg: VitaConfig; setCfg: (c: VitaConfig) => void; disabled?: boolean }) {
  const mt = cfg.mailTexts || {}
  const w = cfg.words || {}
  const setMt = (p: Partial<NonNullable<VitaConfig['mailTexts']>>) => setCfg({ ...cfg, mailTexts: { ...mt, ...p } })
  const setW = (p: Partial<NonNullable<VitaConfig['words']>>) => setCfg({ ...cfg, words: { ...w, ...p } })
  return (
    <div className="rsm-box">
      <div className="rsm-box-head"><span className="rsm-box-title">Testi e parole</span></div>
      <div className="rsm-box-body">
        <label className="rsm-field">Compagnia (ok sanitario e mail)<input disabled={disabled} value={cfg.insurer ?? ''} placeholder={insurerOf(null)} onChange={(e) => setCfg({ ...cfg, insurer: e.target.value })} /></label>
        <details>
          <summary className="rsm-muted" style={{ cursor: 'pointer' }}>Mail della documentazione sanitaria</summary>
          <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
            <label className="rsm-field">Saluto<input disabled={disabled} value={mt.greeting ?? ''} placeholder="Buongiorno," onChange={(e) => setMt({ greeting: e.target.value })} /></label>
            <label className="rsm-field">Richiesta finale<input disabled={disabled} value={mt.ask ?? ''} placeholder="Fateci sapere se preferite che contattiamo noi gli assicurati." onChange={(e) => setMt({ ask: e.target.value })} /></label>
            <label className="rsm-field">Chiusura<textarea rows={2} disabled={disabled} value={mt.closing ?? ''} placeholder={'Restiamo a disposizione.\nUn saluto'} onChange={(e) => setMt({ closing: e.target.value })} /></label>
          </div>
        </details>
        {cfg.hrMonthly && (
          <details>
            <summary className="rsm-muted" style={{ cursor: 'pointer' }}>Parole dei titoli del file mensile (si aggiungono a quelle di sempre)</summary>
            <div className="rsm-row" style={{ marginTop: 8 }}>
              <label className="rsm-field">Entrate<input disabled={disabled} value={w.hrEntry ?? ''} placeholder="ASSUNTI, INSERIMENTI" onChange={(e) => setW({ hrEntry: e.target.value })} style={{ width: 220 }} /></label>
              <label className="rsm-field">Uscite<input disabled={disabled} value={w.hrExit ?? ''} placeholder="CESSATI, DIMISSIONI" onChange={(e) => setW({ hrExit: e.target.value })} style={{ width: 220 }} /></label>
              <label className="rsm-field">Passaggi di livello<input disabled={disabled} value={w.hrLevel ?? ''} placeholder="PASSAGGI, PROMOZIONI" onChange={(e) => setW({ hrLevel: e.target.value })} style={{ width: 220 }} /></label>
              <label className="rsm-field">Proroghe (ignorate)<input disabled={disabled} value={w.hrExtension ?? ''} placeholder="PROROGHE" onChange={(e) => setW({ hrExtension: e.target.value })} style={{ width: 220 }} /></label>
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
