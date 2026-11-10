'use client'

// Tassi e regole della polizza vita: tutto ciò che può cambiare nel tempo si
// modifica da qui, senza interventi sul programma. I tassi stanno nel programma
// perché cambiano ogni anno.
import { useEffect, useState } from 'react'
import { useConfirmPanel } from '@/components/ConfirmPanel'
import { VitaGate, VitaHeader, api, eur, useFlash, useVita } from '@/components/vita/useVita'
import type { VitaConfig } from '@/lib/vita/types'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const n2 = (v: string) => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0
const show = (v: number) => String(v).replace('.', ',')

export default function VitaSettingsPage() {
  const vita = useVita()
  const { ask, panel } = useConfirmPanel()
  const [cfg, setCfg] = useState<VitaConfig | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const { setFlash, node: flashNode } = useFlash(vita)
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()))

  useEffect(() => {
    if (vita.program) { setCfg(clone(vita.program.config)); setName(vita.program.name) }
  }, [vita.program])

  const set = (patch: Partial<VitaConfig>) => setCfg((c) => (c ? { ...c, ...patch } : c))
  const setRule = (k: keyof VitaConfig['rules'], v: number | string) => setCfg((c) => (c ? { ...c, rules: { ...c.rules, [k]: v } } : c))
  const setCompany = (i: number, patch: Partial<VitaConfig['companies'][number]>) =>
    setCfg((c) => (c ? { ...c, companies: c.companies.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : c))

  async function save() {
    if (!cfg || !vita.programId) return
    setBusy(true)
    try {
      await api(`/api/vita/programs/${vita.programId}`, 'PUT', { name, year: vita.program!.year, config: cfg })
      await vita.reload()
      setFlash({ ok: true, text: 'Impostazioni salvate. Gli importi si ricalcolano da soli, anche per il passato.' })
    } catch (e) { setFlash({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  async function createProgram() {
    const year = Number(newYear)
    setBusy(true)
    try {
      const j = await api('/api/vita/programs', 'POST', { name: `Polizza Vita ${year}`, year, copyFrom: vita.programId || undefined })
      setFlash({ ok: true, text: `Creato il programma «${j.program.name}».` })
      await vita.reload()
      vita.setProgramId(j.program.id)
    } catch (e) { setFlash({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  const ages = cfg ? Object.keys(cfg.rates).map(Number).sort((a, b) => a - b) : []
  const perCol = Math.ceil(ages.length / 3) || 1

  return (
    <div className="rsm">
      <VitaHeader vita={vita} title="Tassi e regole">
        {vita.editor && vita.program && <button className="btn btn-primary" disabled={busy || !cfg} onClick={save}>Salva</button>}
      </VitaHeader>
      {flashNode}

      {!vita.program ? (
        <div className="rsm-box"><div className="rsm-box-head"><span className="rsm-box-title">Crea il programma</span></div>
          <div className="rsm-box-body">
            <p className="rsm-muted">Un programma per anno: tiene contraenti, numeri di polizza, tassi e regole. Gli assicurati si caricano poi dal file dell&apos;Azienda.</p>
            <div className="rsm-row">
              <label className="rsm-field">Anno<input value={newYear} onChange={(e) => setNewYear(e.target.value)} style={{ width: 100 }} /></label>
              <button className="btn btn-primary" disabled={busy} onClick={createProgram}>Crea</button>
            </div>
          </div>
        </div>
      ) : (
        <VitaGate vita={vita}>
          {cfg && (
            <>
              <div className="rsm-grid2">
                <div className="rsm-box">
                  <div className="rsm-box-head"><span className="rsm-box-title">Programma e polizze</span></div>
                  <div className="rsm-box-body">
                    <div className="rsm-row">
                      <label className="rsm-field">Nome<input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 220 }} /></label>
                      <label className="rsm-field">Anno<input value={vita.program.year} disabled style={{ width: 90 }} /></label>
                    </div>
                    {cfg.companies.map((c, i) => (
                      <div className="rsm-row" key={c.key}>
                        <label className="rsm-field">Contraente<input value={c.name} onChange={(e) => setCompany(i, { name: e.target.value })} style={{ width: 220 }} /></label>
                        <label className="rsm-field">Numero di polizza<input value={c.policy} onChange={(e) => setCompany(i, { policy: e.target.value })} style={{ width: 130 }} /></label>
                      </div>
                    ))}
                    <p className="rsm-note">Una polizza per contraente. I numeri possono cambiare da un anno all&apos;altro.</p>
                  </div>
                </div>

                <div className="rsm-box">
                  <div className="rsm-box-head"><span className="rsm-box-title">Capitale e documentazione sanitaria</span></div>
                  <div className="rsm-box-body">
                    <div className="rsm-row">
                      <label className="rsm-field">Moltiplicatore della RAL<input value={show(cfg.rules.multiplier)} onChange={(e) => setRule('multiplier', n2(e.target.value))} style={{ width: 110 }} /></label>
                      <label className="rsm-field">Capitale figura chiave<input value={eur(cfg.rules.keyFigureCapital)} onChange={(e) => setRule('keyFigureCapital', n2(e.target.value))} style={{ width: 150 }} /></label>
                      <label className="rsm-field">Diritti per assicurato<input value={show(cfg.rules.rights)} onChange={(e) => setRule('rights', n2(e.target.value))} style={{ width: 110 }} /></label>
                    </div>
                    <div className="rsm-row">
                      <label className="rsm-field">Senza documenti fino a<input value={eur(cfg.rules.noDocUpTo)} onChange={(e) => setRule('noDocUpTo', n2(e.target.value))} style={{ width: 150 }} /></label>
                      <label className="rsm-field">Rapporto di visita fino a<input value={eur(cfg.rules.visitUpTo)} onChange={(e) => setRule('visitUpTo', n2(e.target.value))} style={{ width: 150 }} /></label>
                      <label className="rsm-field">Validità check-up (mesi)<input value={String(cfg.rules.checkupMonths)} onChange={(e) => setRule('checkupMonths', n2(e.target.value))} style={{ width: 110 }} /></label>
                    </div>
                    <p className="rsm-note">Senza documenti il capitale resta a {eur(cfg.rules.noDocUpTo)}. Con il rapporto di visita (e l&apos;ok di C.A. Vita) arriva a {eur(cfg.rules.visitUpTo)}; con accertamenti o check-up (e l&apos;ok) al capitale previsto. Alla figura chiave la documentazione si chiede sempre.</p>
                  </div>
                </div>

                <div className="rsm-box">
                  <div className="rsm-box-head"><span className="rsm-box-title">Limiti di età e movimenti</span></div>
                  <div className="rsm-box-body">
                    <div className="rsm-row">
                      <label className="rsm-field">Età minima<input value={String(cfg.rules.minAge)} onChange={(e) => setRule('minAge', n2(e.target.value))} style={{ width: 90 }} /></label>
                      <label className="rsm-field">Morte fino a<input value={String(cfg.rules.deathMaxAge)} onChange={(e) => setRule('deathMaxAge', n2(e.target.value))} style={{ width: 90 }} /></label>
                      <label className="rsm-field">Invalidità permanente fino a<input value={String(cfg.rules.ipMaxAge)} onChange={(e) => setRule('ipMaxAge', n2(e.target.value))} style={{ width: 90 }} /></label>
                    </div>
                    <label className="rsm-field">Rimborso delle esclusioni
                      <select value={cfg.rules.refundBasis} onChange={(e) => setRule('refundBasis', e.target.value)}>
                        <option value="start">Con tasso e capitale pagati a inizio anno</option>
                        <option value="exit">Con l&apos;età al giorno di uscita</option>
                      </select>
                    </label>
                    <p className="rsm-note">Il pro-rata è a giorni fino al 31/12 (giorni / 365). Le inclusioni pagano i diritti, le esclusioni no. Chi supera gli {cfg.rules.deathMaxAge} anni non esce in automatico: compare un avviso nel rinnovo.</p>
                  </div>
                </div>

                <div className="rsm-box">
                  <div className="rsm-box-head"><span className="rsm-box-title">Mail e accessi</span></div>
                  <div className="rsm-box-body">
                    <label className="rsm-field">Referente in Azienda<input value={cfg.mail.to} onChange={(e) => set({ mail: { ...cfg.mail, to: e.target.value } })} placeholder="indirizzo di chi riceve i promemoria" /></label>
                    <label className="rsm-field">Copia a (operatori CSA)<input value={cfg.mail.cc} onChange={(e) => set({ mail: { ...cfg.mail, cc: e.target.value } })} placeholder="indirizzi separati da virgola" /></label>
                    <label className="rsm-field">Firma della mail<input value={cfg.mail.signature} onChange={(e) => set({ mail: { ...cfg.mail, signature: e.target.value } })} /></label>
                    <label className="rsm-field">Chi può registrare<input value={(cfg.editors || []).join(', ')} onChange={(e) => set({ editors: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="vuoto = tutti gli utenti dell'applicazione" /></label>
                    <p className="rsm-note">Gli altri utenti consultano soltanto. Le note sanitarie non compaiono mai nelle mail all&apos;Azienda.</p>
                  </div>
                </div>
              </div>

              <div className="rsm-box">
                <div className="rsm-box-head"><span className="rsm-box-title">Tassi per età (‰)</span><span className="rsm-note">{ages.length} età, da {ages[0]} a {ages[ages.length - 1]} anni · cambiano ogni anno, si caricano col file della compagnia</span></div>
                <div className="rsm-scroll tall" style={{ maxHeight: 360 }}>
                  <table className="rsm-table">
                    <thead><tr>{[0, 1, 2].map((i) => <th key={`h${i}`} colSpan={2}>Età e tasso ‰</th>)}</tr></thead>
                    <tbody>
                      {Array.from({ length: perCol }).map((_, row) => (
                        <tr key={row}>
                          {[0, 1, 2].map((c) => {
                            const a = ages[row + c * perCol]
                            if (a === undefined) return <td key={c} colSpan={2} />
                            return (
                              <td key={c} colSpan={2}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                  <span className="num" style={{ width: 28 }}>{a}</span>
                                  <input value={String(cfg.rates[String(a)] ?? '')} disabled={!vita.editor}
                                    onChange={(e) => set({ rates: { ...cfg.rates, [String(a)]: Number(e.target.value.replace(',', '.')) || 0 } })}
                                    style={{ width: 150, height: 28, fontSize: 12 }} aria-label={`Tasso a ${a} anni`} />
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {vita.editor && (
                <div className="rsm-box">
                  <div className="rsm-box-head"><span className="rsm-box-title">Altri programmi</span></div>
                  <div className="rsm-box-body">
                    <div className="rsm-row">
                      <label className="rsm-field">Nuovo anno<input value={newYear} onChange={(e) => setNewYear(e.target.value)} style={{ width: 100 }} /></label>
                      <button className="btn btn-secondary" disabled={busy} onClick={createProgram}>Crea copiando questo</button>
                      <button className="btn btn-secondary" disabled={busy} onClick={async () => {
                        const ok = await ask(`Eliminare il programma «${vita.program!.name}» con tutti i suoi assicurati e movimenti? Non si può annullare.`, { title: 'Eliminare il programma?', okLabel: 'Elimina', danger: true })
                        if (!ok) return
                        setBusy(true)
                        try {
                          await api(`/api/vita/programs/${vita.programId}`, 'DELETE')
                          await vita.reload()
                          setFlash({ ok: true, text: 'Programma eliminato.' })
                        } catch (e) { setFlash({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
                      }}>Elimina questo programma</button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </VitaGate>
      )}
      {panel}
    </div>
  )
}
