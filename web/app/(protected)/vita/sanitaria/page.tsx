'use client'

// Documentazione sanitaria: fasce di capitale, chi deve ancora consegnare e la
// mail di sollecito per la referente in Azienda (solo nomi e documento
// mancante: le note sanitarie restano interne).
import { useMemo, useState } from 'react'
import { COMPANIES, ROWS, TODAY, eur, fmtDate, statusAt } from '@/lib/vita/demo'
import { CompanyTabs, DocPill, PersonPanel, VitaHeader, docState } from '@/components/vita/VitaUi'
import type { CompanyTab } from '@/components/vita/VitaUi'

export default function VitaSanitariaPage() {
  const [tab, setTab] = useState<CompanyTab>('sgr')
  const [mail, setMail] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const active = useMemo(() => ROWS.filter((r) => statusAt(r, TODAY) === 'attivo'), [])
  const counts = { sgr: active.filter((r) => r.company === 'sgr').length, re: active.filter((r) => r.company === 're').length, all: active.length }
  const scope = active.filter((r) => tab === 'all' || r.company === tab)
  const bands = { nessuna: scope.filter((r) => r.band === 'nessuna').length, visita: scope.filter((r) => r.band === 'visita').length, plus: scope.filter((r) => r.band === 'visita+accertamenti').length }
  const need = scope.filter((r) => r.band !== 'nessuna').sort((a, b) => (docState(a).tone === 'ok' ? 1 : 0) - (docState(b).tone === 'ok' ? 1 : 0) || b.target - a.target)
  const missing = need.filter((r) => docState(r).tone === 'err')
  const pending = need.filter((r) => docState(r).tone === 'warn')
  const current = open ? ROWS.find((r) => r.id === open) || null : null

  const policy = tab === 'all' ? '60037 e 60038' : COMPANIES[tab].policy
  const body = `Buongiorno,

per le persone elencate sotto il capitale assicurato della polizza vita (n. ${policy}) resta ridotto a € 400.000 finché non riceviamo la documentazione sanitaria indicata:

${missing.map((r) => `- ${r.cognome} ${r.nome}: ${docState(r).need.toLowerCase()}`).join('\n') || '- nessuna'}
${pending.length ? `\nSono in attesa dell'ok di Crédit Agricole Vita:\n\n${pending.map((r) => `- ${r.cognome} ${r.nome}`).join('\n')}\n` : ''}
Restiamo a disposizione.
Un saluto`

  async function copy() {
    try { await navigator.clipboard.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignora */ }
  }

  return (
    <div className="rsm">
      <VitaHeader kicker={`Polizza Vita 2026 · situazione al ${fmtDate(TODAY)}`} title="Documentazione sanitaria">
        <button className="btn btn-primary" onClick={() => setMail((v) => !v)}>Prepara la mail per l&apos;Azienda</button>
        <button className="btn btn-secondary">Esporta Excel</button>
      </VitaHeader>

      <CompanyTabs value={tab} onChange={setTab} counts={counts} />

      <div className="rsm-kpis">
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Fino a 400.000</span></div><div className="rsm-kpi-num">{bands.nessuna}</div><div className="rsm-kpi-line">nessun documento richiesto</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>400.000 – 800.000</span></div><div className="rsm-kpi-num">{bands.visita}</div><div className="rsm-kpi-line">rapporto di visita del medico curante</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Oltre 800.000</span></div><div className="rsm-kpi-num">{bands.plus}</div><div className="rsm-kpi-line">visita + accertamenti o check-up (6 mesi)</div></div>
        <div className="rsm-kpi"><div className="rsm-kpi-top"><span>Da sollecitare</span></div><div className="rsm-kpi-num" style={{ color: missing.length ? 'var(--c-error)' : undefined }}>{missing.length}</div><div className="rsm-kpi-line">{pending.length} in attesa dell&apos;ok di C.A. Vita</div></div>
      </div>

      {mail && (
        <div className="rsm-panel">
          <div className="rsm-box-title">Mail per la referente in Azienda</div>
          <div className="rsm-row">
            <label className="rsm-field">A<input defaultValue="referente@amundi.example" style={{ width: 260 }} /></label>
            <label className="rsm-field">Cc<input defaultValue="operatore1@csabroker.it, operatore2@csabroker.it" style={{ width: 340 }} /></label>
          </div>
          <label className="rsm-field rsm-mail">Testo<textarea readOnly value={body} /></label>
          <div className="rsm-row"><button className="btn btn-primary" onClick={copy}>{copied ? 'Copiata' : 'Copia il testo'}</button><button className="btn btn-secondary">Apri nella posta</button><button className="btn btn-secondary">Scarica .eml</button></div>
          <p className="rsm-note">Nella mail compaiono solo i nomi e il documento mancante. Le note sanitarie (esclusioni, patologie) non vengono mai incluse.</p>
        </div>
      )}

      <div className="rsm-box">
        <div className="rsm-box-head"><span className="rsm-box-title">Chi deve consegnare documenti</span><span className="rsm-muted">{need.length} assicurati sopra i 400.000</span></div>
        <div className="rsm-scroll">
          <table className="rsm-table">
            <thead><tr><th>Assicurato</th><th className="num">Capitale previsto</th><th>Richiesto</th><th>Stato</th><th className="num">Capitale ora</th><th>Ultimo sollecito</th></tr></thead>
            <tbody>
              {need.map((r) => (
                <tr key={r.id}>
                  <td><button className="rsm-who-btn" onClick={() => setOpen(r.id)}>{r.cognome} {r.nome}</button>{r.keyFigure && <> <span className="rsm-pill promo">figura chiave</span></>}{r.note && <div className="rsm-sub">{r.note}</div>}</td>
                  <td className="num">{eur(r.target)}</td>
                  <td>{docState(r).need}</td>
                  <td><DocPill r={r} /></td>
                  <td className="num">{eur(r.capital)}{r.scopertura > 0 && <div className="rsm-sub" style={{ color: 'var(--c-error)' }}>non coperti {eur(r.scopertura)}</div>}</td>
                  <td className="nowrap">{r.warn ? r.warn.replace('Sollecito del ', '') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {current && <PersonPanel row={current} onClose={() => setOpen(null)} />}
    </div>
  )
}
