'use client'

// Tassi e regole della polizza vita: tutto ciò che può cambiare nel tempo si
// modifica da qui, senza interventi sul programma. I tassi stanno nel programma
// perché cambiano ogni anno.
import { useEffect, useRef, useState } from 'react'
import { useConfirmPanel } from '@/components/ConfirmPanel'
import { VitaGate, VitaHeader, api, eur, useFlash, useVita } from '@/components/vita/useVita'
import { CalcModeBox, CategoriesBox, MedicalBands, MovementRulesBox, VitaExample, VitaTextsBox } from '@/components/vita/VitaConfigParts'
import { clientOf, insurerOf } from '@/lib/vita/types'
import type { VitaConfig } from '@/lib/vita/types'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const n2 = (v: string) => Number(String(v).replace(/\./g, '').replace(',', '.')) || 0
const show = (v: number) => String(v).replace('.', ',')

export default function VitaSettingsPage() {
  const vita = useVita()
  const { ask, panel } = useConfirmPanel()
  const [cfg, setCfg] = useState<VitaConfig | null>(null)
  const [name, setName] = useState('')
  const [client, setClient] = useState('')
  const [busy, setBusy] = useState(false)
  const { setFlash, node: flashNode } = useFlash(vita)
  const [newYear, setNewYear] = useState(String(new Date().getFullYear()))
  const ratesRef = useRef<HTMLInputElement>(null)

  /** Tassi da un file col foglio TASSI: 63 valori non si scrivono a mano. */
  async function ratesFromFile(f: File | null) {
    if (!f || !cfg) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const r = await fetch('/api/vita/inspect', { method: 'POST', body: fd })
      const j = (await r.json()) as { ratesN: number; rates: Record<string, number>; ratesFrom: string; ratesMin: number | null; ratesMax: number | null; error?: string }
      if (!r.ok) throw new Error(j.error || 'Errore')
      if (!j.ratesN) throw new Error('Nel file non c\'è un foglio dei tassi: servono due colonne, età e tasso ‰.')
      setCfg({ ...cfg, rates: { ...j.rates } })
      setFlash({ ok: true, text: `Letti ${j.ratesN} tassi (${j.ratesMin}-${j.ratesMax} anni) dal foglio «${j.ratesFrom}». Premi Salva per tenerli.` })
    } catch (e) { setFlash({ ok: false, text: (e as Error).message }) } finally {
      setBusy(false)
      if (ratesRef.current) ratesRef.current.value = ''
    }
  }

  /** Tassi e regole da un altro anno, senza toccare gli assicurati. */
  function copyRulesFrom(id: string) {
    const src = (vita.programs || []).find((p) => p.id === id)
    if (!src || !cfg) return
    setCfg({ ...cfg, rules: clone(src.config.rules), rates: clone(src.config.rates) })
    setFlash({ ok: true, text: `Tassi e regole copiati da «${src.name}». Premi Salva per tenerli.` })
  }

  useEffect(() => {
    if (vita.program) { setCfg(clone(vita.program.config)); setName(vita.program.name); setClient(clientOf(vita.program)) }
  }, [vita.program])

  const set = (patch: Partial<VitaConfig>) => setCfg((c) => (c ? { ...c, ...patch } : c))
  const setRule = (k: keyof VitaConfig['rules'], v: number | string) => setCfg((c) => (c ? { ...c, rules: { ...c.rules, [k]: v } } : c))
  const setCompany = (i: number, patch: Partial<VitaConfig['companies'][number]>) =>
    setCfg((c) => (c ? { ...c, companies: c.companies.map((x, j) => (j === i ? { ...x, ...patch } : x)) } : c))

  async function save() {
    if (!cfg || !vita.programId) return
    setBusy(true)
    try {
      await api(`/api/vita/programs/${vita.programId}`, 'PUT', { name, year: vita.program!.year, config: cfg, company: client.trim() })
      await vita.reload()
      setFlash({ ok: true, text: 'Impostazioni salvate. Gli importi si ricalcolano da soli, anche per il passato.' })
    } catch (e) { setFlash({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  async function createProgram() {
    const year = Number(newYear)
    setBusy(true)
    try {
      const base = vita.program ? vita.program.name.replace(/\b(19|20)\d{2}\b/, String(year)) : `Polizza Vita ${year}`
      const nm = base.includes(String(year)) ? base : `${base} ${year}`
      const j = await api('/api/vita/programs', 'POST', { name: nm, year, copyFrom: vita.programId || undefined, company: vita.program ? clientOf(vita.program) : undefined })
      setFlash({ ok: true, text: `Creato il programma «${j.program.name}».` })
      await vita.reload()
      vita.setProgramId(j.program.id)
    } catch (e) { setFlash({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  const catMode = cfg?.rules.capitalMode === 'categoria'
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
                      <label className="rsm-field">Cliente<input value={client} onChange={(e) => setClient(e.target.value)} placeholder="es. Agos" style={{ width: 150 }} /></label>
                      <label className="rsm-field">Nome della polizza<input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 220 }} /></label>
                      <label className="rsm-field">Anno<input value={vita.program.year} disabled style={{ width: 90 }} /></label>
                    </div>
                    {cfg.companies.map((c, i) => (
                      <div className="rsm-row" key={c.key}>
                        <label className="rsm-field">Contraente<input value={c.name} onChange={(e) => setCompany(i, { name: e.target.value })} style={{ width: 200 }} /></label>
                        <label className="rsm-field">Numero di polizza<input value={c.policy} onChange={(e) => setCompany(i, { policy: e.target.value })} style={{ width: 120 }} /></label>
                        {cfg.hrMonthly && <label className="rsm-field">Codice nel file mensile<input value={c.hrCode || ''} onChange={(e) => setCompany(i, { hrCode: e.target.value })} placeholder="es. 300" style={{ width: 110 }} /></label>}
                        {cfg.companies.length > 1 && <button type="button" className="rsm-mini" style={{ alignSelf: 'flex-end', marginBottom: 2 }} aria-label={`Togli ${c.name}`} onClick={() => set({ companies: cfg.companies.filter((_, j) => j !== i) })}>×</button>}
                      </div>
                    ))}
                    <div className="rsm-row"><button type="button" className="btn btn-secondary" onClick={() => set({ companies: [...cfg.companies, { key: `c${Date.now().toString(36)}`, name: '', policy: '' }] })}>Aggiungi un contraente</button></div>
                    <label className="rsm-rule" style={{ marginTop: 8 }}>
                      <input type="checkbox" checked={!!cfg.hrMonthly} onChange={(e) => set({ hrMonthly: e.target.checked })} />
                      <span>Si aggiorna col file mensile del cliente<span className="rsm-help">Assunti, cessati e passaggi di livello si caricano da «File mensile del cliente», per tutte le polizze del cliente collegate. Il codice è quello della colonna «Soc» del file (Agos Ducato: 300); vuoto con un solo contraente.</span></span>
                    </label>
                    <p className="rsm-note">Il cliente raggruppa le sue polizze in una scheda in cima alle pagine (Amundi, Agos…). Più contraenti possono avere lo stesso numero di polizza: decide il nome dell&apos;azienda.</p>
                  </div>
                </div>

                <CalcModeBox cfg={cfg} setCfg={setCfg} disabled={!vita.editor} />

                {!catMode && <div className="rsm-box">
                  <div className="rsm-box-head"><span className="rsm-box-title">Capitale e documentazione sanitaria</span></div>
                  <div className="rsm-box-body">
                    <div className="rsm-row">
                      <label className="rsm-field">Moltiplicatore della RAL<input value={show(cfg.rules.multiplier)} onChange={(e) => setRule('multiplier', n2(e.target.value))} style={{ width: 110 }} /></label>
                      <label className="rsm-field">Capitale figura chiave<input value={eur(cfg.rules.keyFigureCapital)} onChange={(e) => setRule('keyFigureCapital', n2(e.target.value))} style={{ width: 150 }} /></label>
                    </div>
                    <MedicalBands cfg={cfg} setCfg={setCfg} disabled={!vita.editor} />
                    <div className="rsm-row">
                      <label className="rsm-field">Validità check-up (mesi)<input value={String(cfg.rules.checkupMonths)} onChange={(e) => setRule('checkupMonths', n2(e.target.value))} style={{ width: 110 }} /></label>
                    </div>
                    <label className="rsm-rule"><input type="checkbox" checked={!!cfg.rules.checkupExpiry} onChange={(e) => setCfg({ ...cfg, rules: { ...cfg.rules, checkupExpiry: e.target.checked } })} />
                      <span>Gli accertamenti e il check-up valgono solo se fatti negli ultimi {cfg.rules.checkupMonths} mesi<span className="rsm-help">Con la data del check-up più vecchia, il capitale torna al livello del solo rapporto di visita.</span></span></label>
                    <p className="rsm-note">Senza documenti il capitale resta a {eur(cfg.rules.noDocUpTo)}. Con il rapporto di visita (e l&apos;ok di {insurerOf(cfg)}) arriva a {eur(cfg.rules.visitUpTo)}; con accertamenti o check-up (e l&apos;ok) al capitale previsto. Alla figura chiave la documentazione si chiede sempre.</p>
                  </div>
                </div>}

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
                    <div className="rsm-row">
                      <label className="rsm-field">Età per il tasso
                        <select value={cfg.rules.ageMode || 'computabile'} onChange={(e) => setCfg({ ...cfg, rules: { ...cfg.rules, ageMode: e.target.value as 'computabile' } })}>
                          <option value="computabile">Computabile: +1 anno dopo N mesi dal compleanno</option>
                          <option value="compiuti">Anni compiuti</option>
                        </select>
                      </label>
                      {(cfg.rules.ageMode || 'computabile') === 'computabile' && <label className="rsm-field">Mesi dal compleanno<input value={String(cfg.rules.ageHalfMonths ?? 6)} onChange={(e) => setCfg({ ...cfg, rules: { ...cfg.rules, ageHalfMonths: n2(e.target.value) } })} style={{ width: 90 }} /></label>}
                    </div>
                    <p className="rsm-note">Chi supera gli {cfg.rules.deathMaxAge} anni non esce in automatico: compare un avviso nel rinnovo.</p>
                  </div>
                </div>

                <MovementRulesBox cfg={cfg} setCfg={setCfg} disabled={!vita.editor} />
                <VitaTextsBox cfg={cfg} setCfg={setCfg} disabled={!vita.editor} />

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

              {catMode && <CategoriesBox cfg={cfg} setCfg={setCfg} disabled={!vita.editor} />}
              <VitaExample cfg={cfg} />

              {!catMode && <div className="rsm-box">
                <div className="rsm-box-head">
                  <span className="rsm-box-title">Tassi per età (‰)</span>
                  <span className="rsm-note">{ages.length ? `${ages.length} età, da ${ages[0]} a ${ages[ages.length - 1]} anni` : 'nessun tasso'} · cambiano ogni anno</span>
                </div>
                {vita.editor && (
                  <div className="rsm-box-body" style={{ paddingBottom: 0 }}>
                    <div className="rsm-row">
                      <button className="btn btn-secondary" disabled={busy} onClick={() => ratesRef.current?.click()}>Leggi i tassi da un file Excel</button>
                      <input ref={ratesRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => ratesFromFile(e.target.files?.[0] || null)} />
                      {(vita.programs || []).filter((p) => p.id !== vita.programId).map((p) => (
                        <button key={p.id} className="btn btn-secondary" disabled={busy} onClick={() => copyRulesFrom(p.id)}>Copia tassi e regole da «{p.name}»</button>
                      ))}
                    </div>
                    <p className="rsm-note">Il file deve avere un foglio con due colonne, età e tasso ‰ (nel vostro si chiama TASSI). I 63 valori non si scrivono a mano.</p>
                  </div>
                )}
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
              </div>}

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
