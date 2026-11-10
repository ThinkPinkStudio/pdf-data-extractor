'use client'

// Tassi e regole della polizza vita: tutto ciò che può cambiare nel tempo si
// modifica da qui, senza interventi sul programma.
import { Fragment, useState } from 'react'
import { COMPANIES, RATES, RULES, eur, rate4 } from '@/lib/vita/demo'
import { VitaHeader } from '@/components/vita/VitaUi'

const num = (n: number) => String(n).replace('.', ',')

export default function VitaSettingsPage() {
  const [saved, setSaved] = useState(false)
  const ages = Object.keys(RATES).map(Number).sort((a, b) => a - b)
  return (
    <div className="rsm">
      <VitaHeader kicker="Polizza Vita 2026" title="Tassi e regole">
        <button className="btn btn-secondary">Copia dal 2025</button>
        <button className="btn btn-primary" onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2000) }}>{saved ? 'Salvato' : 'Salva'}</button>
      </VitaHeader>

      <div className="rsm-grid2">
        <div className="rsm-box">
          <div className="rsm-box-head"><span className="rsm-box-title">Polizze</span></div>
          <div className="rsm-box-body">
            {(['sgr', 're'] as const).map((k) => (
              <div className="rsm-row" key={k}>
                <label className="rsm-field">Contraente<input defaultValue={COMPANIES[k].name} style={{ width: 220 }} /></label>
                <label className="rsm-field">Numero di polizza<input defaultValue={COMPANIES[k].policy} style={{ width: 120 }} /></label>
              </div>
            ))}
            <p className="rsm-note">Una polizza per contraente. I numeri possono cambiare da un anno all&apos;altro.</p>
          </div>
        </div>

        <div className="rsm-box">
          <div className="rsm-box-head"><span className="rsm-box-title">Capitale e documentazione sanitaria</span></div>
          <div className="rsm-box-body">
            <div className="rsm-row">
              <label className="rsm-field">Moltiplicatore della RAL<input defaultValue={num(RULES.multiplier)} style={{ width: 110 }} /></label>
              <label className="rsm-field">Capitale figura chiave<input defaultValue={eur(RULES.keyFigureCapital)} style={{ width: 150 }} /></label>
              <label className="rsm-field">Diritti per assicurato<input defaultValue={num(RULES.rights)} style={{ width: 110 }} /></label>
            </div>
            <div className="rsm-row">
              <label className="rsm-field">Senza documenti fino a<input defaultValue={eur(RULES.noDocUpTo)} style={{ width: 150 }} /></label>
              <label className="rsm-field">Rapporto di visita fino a<input defaultValue={eur(RULES.visitUpTo)} style={{ width: 150 }} /></label>
              <label className="rsm-field">Validità check-up (mesi)<input defaultValue={RULES.checkupMonths} style={{ width: 110 }} /></label>
            </div>
            <p className="rsm-note">Senza documenti il capitale resta a 400.000. Con il rapporto di visita (e l&apos;ok di C.A. Vita) arriva a 800.000; con accertamenti o check-up (e l&apos;ok) al capitale previsto.</p>
          </div>
        </div>

        <div className="rsm-box">
          <div className="rsm-box-head"><span className="rsm-box-title">Limiti di età e movimenti</span></div>
          <div className="rsm-box-body">
            <div className="rsm-row">
              <label className="rsm-field">Età minima<input defaultValue={RULES.minAge} style={{ width: 90 }} /></label>
              <label className="rsm-field">Morte fino a<input defaultValue={RULES.deathMaxAge} style={{ width: 90 }} /></label>
              <label className="rsm-field">Invalidità permanente fino a<input defaultValue={RULES.ipMaxAge} style={{ width: 90 }} /></label>
            </div>
            <label className="rsm-field">Rimborso delle esclusioni<select defaultValue="start"><option value="start">Con tasso e capitale pagati a inizio anno</option><option value="exit">Con l’età al giorno di uscita</option></select></label>
            <p className="rsm-note">Il pro-rata è a giorni fino al 31/12 (giorni / 365). Le inclusioni pagano i diritti, le esclusioni no.</p>
          </div>
        </div>

        <div className="rsm-box">
          <div className="rsm-box-head"><span className="rsm-box-title">Mail e accessi</span></div>
          <div className="rsm-box-body">
            <label className="rsm-field">Referente in Azienda<input placeholder="indirizzo di chi riceve i promemoria" /></label>
            <label className="rsm-field">Copia a (operatori CSA)<input placeholder="indirizzi separati da virgola" /></label>
            <label className="rsm-field">Chi può registrare<input placeholder="vuoto = tutti gli utenti dell'applicazione" /></label>
            <p className="rsm-note">Gli altri utenti consultano soltanto. Le note sanitarie non compaiono mai nelle mail all&apos;Azienda.</p>
          </div>
        </div>
      </div>

      <div className="rsm-box">
        <div className="rsm-box-head"><span className="rsm-box-title">Tassi per età (‰)</span><div className="rsm-row"><button className="btn btn-secondary">Importa dal foglio TASSI</button></div></div>
        <div className="rsm-scroll tall" style={{ maxHeight: 360 }}>
          <table className="rsm-table">
            <thead><tr>{[0, 1, 2].map((i) => <Fragment key={i}><th>Età</th><th className="num">Tasso ‰</th></Fragment>)}</tr></thead>
            <tbody>
              {Array.from({ length: Math.ceil(ages.length / 3) }).map((_, row) => (
                <tr key={row}>
                  {[0, 1, 2].map((c) => { const a = ages[row + c * Math.ceil(ages.length / 3)]; return a === undefined ? <Fragment key={c}><td /><td /></Fragment> : <Fragment key={c}><td className="num" style={{ textAlign: 'left' }}>{a}</td><td className="num">{rate4(RATES[a])}</td></Fragment> })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rsm-note" style={{ padding: '0 14px 14px' }}>{ages.length} età importate dal foglio TASSI del file Amundi 2026 (da {ages[0]} a {ages[ages.length - 1]} anni). Da 71 anni il tasso scende perché resta solo la garanzia caso morte.</p>
      </div>
    </div>
  )
}
