'use client'

import { useEffect, useState } from 'react'
import { useCompare } from '@/lib/compare/CompareProvider'
import CompareProfiles from '@/components/CompareProfiles'
import {
  TRANSFORM_OPTIONS, DEFAULT_TRANSFORM, defaultMatchKeys, defaultCompareConfig, workbookColumns, keyLabel, normaliseKey,
  similarity, parseIgnoreWords, clampThresholds, comparisonProfileFrom, applyComparisonProfile, comparisonProfileFromRows,
  type CompareConfig, type ComparisonProfile, type MatchKey, type RowsProfile, type Transform, type Workbook,
} from '@/lib/compare/engine'

type FuzzyState = { enabled: boolean; min: number; ignore: string; broad: boolean; broadMin: number; low: number; high: number }

function fuzzyFrom(c: CompareConfig): FuzzyState {
  return { enabled: c.fuzzyEnabled, min: c.fuzzyMinOverlap, ignore: c.fuzzyIgnoreWords, broad: c.fuzzyBroadEnabled, broadMin: c.fuzzyMinOverlapBroad, low: c.fuzzyThresholdLow, high: c.fuzzyThresholdHigh }
}

// Profili storici del Confronto righe → profili della Comparazione (stabile:
// dipendenza dell'effetto di caricamento in CompareProfiles).
function convertRowsProfile(p: unknown): ComparisonProfile | null {
  return p && typeof p === 'object' ? comparisonProfileFromRows(p as Partial<RowsProfile>) : null
}

function parseComparisonProfile(parsed: unknown): ComparisonProfile | null {
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as ComparisonProfile).matchKeys)) return parsed as ComparisonProfile
  return convertRowsProfile(parsed)
}

// Coppie d'esempio mostrate sotto le soglie: si vede dal vivo cosa succede.
const EXAMPLES: [string, string][] = [
  ['Antonio Giuseppe Maria', 'Giuseppe Maria'],
  ['RC Napoli Trasporti', 'F1 Trasporti'],
  ['A. Giovangosino', 'G. Giovangosino'],
  ['Rossi Mario', 'Mario Rossi'],
  ['Amato Monica', 'Buonamano Monica'],
]

const hint: React.CSSProperties = { fontSize: 12, color: 'var(--c-text-muted)', margin: '4px 0 0', lineHeight: 1.5 }

export default function CompareSettingsPage() {
  const { config, saveConfig, fileA, fileB } = useCompare()
  const [keys, setKeys] = useState<MatchKey[]>(config.matchKeys)
  const [fuzzy, setFuzzy] = useState<FuzzyState>(fuzzyFrom(config))
  const [saved, setSaved] = useState(false)
  const [msg, setMsg] = useState('')
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  // Ripristina TUTTI i criteri (chiavi + fuzzy + soglie).
  function resetAll() {
    const d = defaultCompareConfig()
    setKeys(d.matchKeys)
    setFuzzy(fuzzyFrom(d))
    saveConfig(d)
    flash('Criteri ripristinati ai valori predefiniti.')
  }

  useEffect(() => { setKeys(config.matchKeys); setFuzzy(fuzzyFrom(config)) }, [config])

  // Il nome della chiave non si scrive più: segue colonne e fogli.
  function updKey(i: number, patch: Partial<MatchKey>) {
    setKeys((ks) => ks.map((k, idx) => (idx === i ? normaliseKey({ ...k, ...patch }) : k)))
  }
  function move(i: number, dir: -1 | 1) {
    setKeys((ks) => {
      const j = i + dir
      if (j < 0 || j >= ks.length) return ks
      const next = [...ks]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function currentConfig(): CompareConfig {
    const t = clampThresholds(fuzzy.low, fuzzy.high)
    return {
      ...config,
      matchKeys: keys.map(normaliseKey),
      fuzzyEnabled: fuzzy.enabled,
      fuzzyMinOverlap: fuzzy.min,
      fuzzyIgnoreWords: fuzzy.ignore,
      fuzzyBroadEnabled: fuzzy.broad,
      fuzzyMinOverlapBroad: fuzzy.broadMin,
      fuzzyThresholdLow: t.low,
      fuzzyThresholdHigh: t.high,
    }
  }

  async function save() {
    await saveConfig(currentConfig())
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const low = Math.min(fuzzy.low, fuzzy.high)
  const high = Math.max(fuzzy.low, fuzzy.high)
  const ignoreList = parseIgnoreWords(fuzzy.ignore)
  const setPct = (field: 'low' | 'high', raw: string) => {
    const v = parseInt(raw, 10)
    setFuzzy({ ...fuzzy, [field]: Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : field === 'low' ? 50 : 80 })
  }

  return (
    <>
      <h1 className="page-title">Configurazione Criteri</h1>
      <div style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 18 }}>

        {/* Profili: blocco UNICO (chiavi + fuzzy + soglie), usati sia da
            «Differenze» sia da «Uguale a» nella Comparazione. */}
        <CompareProfiles<ComparisonProfile>
          settingsKey="compareProfiles"
          fileName="profili_comparazione.json"
          hint="Un profilo contiene chiavi di abbinamento, confronto per somiglianza e soglie. Caricandolo diventano i criteri attivi della Comparazione (sia «Differenze» sia «Uguale a»)."
          snapshot={() => comparisonProfileFrom(currentConfig())}
          onLoad={(p) => saveConfig(applyComparisonProfile(config, p))}
          parseSingle={parseComparisonProfile}
          legacyKey="compareBothProfiles"
          convertLegacy={convertRowsProfile}
          legacySuffix=" (da Confronto righe)"
        />

        {/* Match keys */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700 }}>Chiavi di abbinamento</h2>
            <button className="btn btn-secondary" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setKeys([...keys, normaliseKey({ label: '', columnA: '', columnB: '', sheetA: '', sheetB: '', sameColumn: false, enabled: true, transform: DEFAULT_TRANSFORM })])}>+ Aggiungi</button>
          </div>
          <p style={{ fontSize: 11, color: 'var(--c-text-muted)', marginTop: 0, marginBottom: 14 }}>Due righe sono la stessa polizza se il valore coincide su almeno una chiave attiva, provate nell&apos;ordine indicato.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {keys.map((k, i) => (
              <div key={i} className="card" style={{ background: 'var(--c-bg-card-alt)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '28px 1fr 160px auto', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={k.enabled !== false} onChange={(e) => updKey(i, { enabled: e.target.checked })} title="Abilitata" aria-label="Chiave abilitata" />
                  <span style={{ fontSize: 12, color: 'var(--c-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={keyLabel(k)}>{keyLabel(k)}</span>
                  <select value={k.transform || DEFAULT_TRANSFORM} onChange={(e) => updKey(i, { transform: e.target.value as Transform })} aria-label="Trasformazione">
                    {TRANSFORM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => move(i, -1)} title="Su">↑</button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => move(i, 1)} title="Giù">↓</button>
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => setKeys(keys.filter((_, idx) => idx !== i))} title="Rimuovi">✕</button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                  <ColField label="Colonna File A" wb={fileA?.wb ?? null} sheet={k.sheetA} value={k.columnA ?? k.column ?? ''} onSet={(v) => updKey(i, { columnA: v })} />
                  <SheetField label="Foglio File A" wb={fileA?.wb ?? null} value={k.sheetA || ''} onSet={(v) => updKey(i, { sheetA: v })} />
                  <ColField label="Colonna File B" wb={fileB?.wb ?? null} sheet={k.sheetB} value={k.columnB ?? ''} onSet={(v) => updKey(i, { columnB: v })} />
                  <SheetField label="Foglio File B" wb={fileB?.wb ?? null} value={k.sheetB || ''} onSet={(v) => updKey(i, { sheetB: v })} />
                </div>
              </div>
            ))}
          </div>
          <button className="btn btn-secondary" style={{ fontSize: 12, marginTop: 10 }} onClick={() => setKeys(defaultMatchKeys())}>Ripristina predefinite</button>
        </div>

        {/* Fuzzy: spiegato per chi non è informatico */}
        <div className="card">
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Abbinamento per somiglianza</h2>
          <p style={{ ...hint, margin: '0 0 14px', fontSize: 13 }}>
            Quando due righe non coincidono esattamente (es. «Rossi Mario» in un file e «ROSSI MARIO SRL» nell&apos;altro),
            il programma misura <strong>quanto si somigliano</strong> e, in base alle soglie qui sotto, le scarta, te le propone
            da controllare in «Da verificare» oppure le considera la stessa polizza.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={fuzzy.enabled} onChange={(e) => setFuzzy({ ...fuzzy, enabled: e.target.checked })} />
            <span style={{ fontSize: 14 }}>Cerca righe simili</span>
          </label>
          <p style={{ ...hint, margin: '0 0 16px' }}>
            Se lo spegni vale solo l&apos;uguaglianza esatta: le righe che non coincidono restano «Solo in A» / «Solo in B» (o «Non in B»).
          </p>

          <div className="form-group">
            <label className="label">Lettere consecutive minime</label>
            <input type="number" min={2} value={fuzzy.min} onChange={(e) => setFuzzy({ ...fuzzy, min: parseInt(e.target.value, 10) || 4 })} style={{ width: 100 }} disabled={!fuzzy.enabled} />
            <p style={hint}>
              Il programma conta solo i <strong>pezzi uguali lunghi almeno questo numero di lettere di fila</strong> (spazi, punti e
              maiuscole non contano). Con 4: «TRASPORTI» e «AUTOTRASPORTI» hanno un pezzo in comune; «AMATO» e «BUONAMANO»
              condividono solo «AMA» (3 lettere) e quel pezzo non conta. Numero più alto = meno somiglianze trovate, ma più sicure.
            </p>
          </div>

          <div className="form-group">
            <label className="label">Soglie di decisione</label>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>Sotto questa % → scartate
                <div><input type="number" min={0} max={100} value={fuzzy.low} onChange={(e) => setPct('low', e.target.value)} style={{ width: 90 }} disabled={!fuzzy.enabled} /> %</div>
              </label>
              <label style={{ fontSize: 12, color: 'var(--c-text-muted)' }}>Da questa % in su → accettate
                <div><input type="number" min={0} max={100} value={fuzzy.high} onChange={(e) => setPct('high', e.target.value)} style={{ width: 90 }} disabled={!fuzzy.enabled} /> %</div>
              </label>
            </div>
            <div className="threshold-bar" aria-hidden>
              <span className="threshold-bar__ko" style={{ width: `${low}%` }}>{low >= 12 ? 'Scartate' : ''}</span>
              <span className="threshold-bar__mid" style={{ width: `${high - low}%` }}>{high - low >= 18 ? 'Da verificare' : ''}</span>
              <span className="threshold-bar__ok" style={{ width: `${100 - high}%` }}>{100 - high >= 12 ? 'Accettate' : ''}</span>
            </div>
            <p style={hint}>
              La <strong>somiglianza</strong> è la parte del nome più lungo coperta da pezzi uguali presenti anche nell&apos;altro.
              «Antonio Giuseppe Maria» e «Giuseppe Maria» hanno in comune GIUSEPPE e MARIA: 13 lettere su 20 = 65%.
              Sotto il <strong>{low}%</strong> le due righe restano separate; tra {low}% e {high}% le trovi in «Da verificare» e decidi tu;
              dal <strong>{high}%</strong> in su vengono considerate la stessa polizza (le trovi in «Accettate» e puoi sempre rimandarle a verifica).
            </p>
            <table className="threshold-examples">
              <thead><tr><th>Esempio A</th><th>Esempio B</th><th>Somiglianza</th><th>Esito</th></tr></thead>
              <tbody>
                {EXAMPLES.map(([a, b]) => {
                  const sc = similarity(a, b, fuzzy.min, ignoreList)
                  const band = sc >= high ? 'ok' : sc >= low ? 'mid' : 'ko'
                  return (
                    <tr key={a + b}>
                      <td>{a}</td><td>{b}</td><td><strong>{sc}%</strong></td>
                      <td className={`score-${band}`}>{band === 'ok' ? 'Accettata' : band === 'mid' ? 'Da verificare' : 'Scartata'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="form-group">
            <label className="label">Parole da ignorare</label>
            <input value={fuzzy.ignore} onChange={(e) => setFuzzy({ ...fuzzy, ignore: e.target.value })} placeholder="es. srl, spa, trasporti" style={{ width: '100%', maxWidth: 420 }} disabled={!fuzzy.enabled} />
            <p style={hint}>
              Parole presenti in tanti nomi che non aiutano a distinguerli (srl, spa, snc, trasporti, «Totale» delle tabelle pivot…),
              separate da virgola. Vengono tolte <strong>prima</strong> di misurare la somiglianza, così due ditte diverse non sembrano
              simili solo perché sono entrambe «srl». Gli esempi qui sopra ne tengono già conto.
            </p>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={fuzzy.broad} onChange={(e) => setFuzzy({ ...fuzzy, broad: e.target.checked })} disabled={!fuzzy.enabled} />
            <span style={{ fontSize: 14 }}>Cerca anche nelle altre colonne</span>
          </label>
          <p style={{ ...hint, margin: '0 0 10px' }}>
            Se sulle chiavi non si trova nulla, cerca somiglianze in <strong>tutte</strong> le colonne con testo (es. il cliente scritto
            in «Descrizione Cliente» in un file e in «Cliente» nell&apos;altro). Trova più coppie ma sbaglia di più: meglio usarla con
            più lettere consecutive minime.
          </p>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="label">Lettere consecutive minime (altre colonne)</label>
            <input type="number" min={2} value={fuzzy.broadMin} onChange={(e) => setFuzzy({ ...fuzzy, broadMin: parseInt(e.target.value, 10) || 6 })} style={{ width: 100 }} disabled={!fuzzy.enabled || !fuzzy.broad} />
          </div>
        </div>

        {msg && <div className="alert alert-success">{msg}</div>}
        {saved && <div className="alert alert-success">Configurazione salvata.</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={save}>Salva configurazione</button>
          <button className="btn btn-secondary" onClick={resetAll}>Ripristina tutti i criteri</button>
        </div>
      </div>
    </>
  )
}

// Campo Colonna: dropdown popolato dalle colonne del file (foglio scelto) se
// caricato, altrimenti input libero.
function ColField({ label, wb, sheet, value, onSet }: { label: string; wb: Workbook | null; sheet?: string; value: string; onSet: (v: string) => void }) {
  const cols = workbookColumns(wb, sheet)
  return (
    <label style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{label}
      {cols.length ? (
        <select value={value} onChange={(e) => onSet(e.target.value)}>
          <option value="">— seleziona colonna —</option>
          {cols.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : (
        <input value={value} onChange={(e) => onSet(e.target.value)} placeholder="Nome colonna" />
      )}
    </label>
  )
}

// Campo Foglio: dropdown dei fogli del file (sempre visibile, con "(1° foglio)")
// se il file è caricato; altrimenti input libero.
function SheetField({ label, wb, value, onSet }: { label: string; wb: Workbook | null; value: string; onSet: (v: string) => void }) {
  return (
    <label style={{ fontSize: 11, color: 'var(--c-text-muted)' }}>{label}
      {wb && wb.sheetNames.length ? (
        <select value={value} onChange={(e) => onSet(e.target.value)}>
          <option value="">(1° foglio)</option>
          {wb.sheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      ) : (
        <input value={value} onChange={(e) => onSet(e.target.value)} placeholder="(1° foglio)" />
      )}
    </label>
  )
}
