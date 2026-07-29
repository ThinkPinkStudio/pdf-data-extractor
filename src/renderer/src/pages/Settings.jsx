import { useState, useEffect, useId, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const IconPlus = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true" width="15" height="15">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)

const IconTrash = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="15" height="15">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
  </svg>
)

const IconRefresh = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="14" height="14">
    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
  </svg>
)

const IconGrip = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" width="14" height="14">
    <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
    <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
    <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
  </svg>
)

const IconCopy = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="13" height="13">
    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
)

const FIELD_TYPES = ['text', 'number', 'date', 'email', 'phone', 'iva', 'cf', 'url']

function WebhookTokenField({ token }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [token])

  return (
    <div className="form-group" style={{ marginTop: 8 }}>
      <label className="form-label">{t('compliance.webhookToken')}</label>
      <div className="flex gap-2">
        <input
          className="form-input"
          type="text"
          value={token}
          readOnly
          style={{ fontFamily: 'var(--font-mono)', fontSize: 12, flex: 1 }}
          aria-label={t('compliance.webhookToken')}
        />
        <button className="btn btn-secondary" onClick={handleCopy} style={{ flexShrink: 0, fontSize: 12 }}>
          {copied ? t('compliance.webhookTokenCopied') : t('compliance.webhookTokenCopy')}
        </button>
      </div>
      <p className="text-muted text-sm" style={{ marginTop: 4, fontFamily: 'var(--font-mono)' }}>
        {t('compliance.webhookTokenHeader')}
      </p>
      <p className="text-muted text-sm">{t('compliance.webhookTokenDesc')}</p>
    </div>
  )
}

// Nota: i tipi di polizza (RCT_O/RCP) e la relativa suddivisione in tab sono
// stati rimossi — i campi sono ora un unico elenco.

// ─── Default Polizza RC fields (CSA preset) ───────────────────────────────────
const DEFAULT_POLIZZA_FIELDS = [
  { id: 'polizza_numero', label: 'N° Polizza', description: 'Numero di polizza (es. 410000880)', type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'C3' }, { sheet: 'RCP', cell: 'C3' }] },
  { id: 'compagnia', label: 'Compagnia', description: 'Nome della compagnia assicuratrice (es. Generali Italia S.p.A.)', type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'C6' }, { sheet: 'RCT_O', cell: 'N18' }, { sheet: 'RCP', cell: 'C6' }, { sheet: 'RCP', cell: 'N16' }] },
  { id: 'contraente', label: 'Contraente/Assicurato', description: 'Ragione sociale del contraente/assicurato (es. ADAMANT BIONRG SRL)', type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'C4' }, { sheet: 'RCT_O', cell: 'N17' }, { sheet: 'RCP', cell: 'C4' }, { sheet: 'RCP', cell: 'N15' }] },
  { id: 'codice_fiscale_iva', label: 'P. IVA / Cod. Fiscale', description: 'Partita IVA o codice fiscale del contraente', type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'F5' }, { sheet: 'RCP', cell: 'F5' }] },
  { id: 'indirizzo', label: 'Indirizzo', description: 'Indirizzo completo del domicilio/sede del contraente', type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'C5' }, { sheet: 'RCP', cell: 'C5' }] },
  { id: 'agenzia', label: 'Agenzia', description: "Nome dell'agenzia assicurativa (es. ACQUI TERME)", type: 'text', sheet: 'RCT_O', enabled: true, cells: [] },
  { id: 'decorrenza', label: 'Decorrenza', description: 'Data di decorrenza della polizza (es. 31/12/2021)', type: 'date', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'C7' }, { sheet: 'RCT_O', cell: 'O21' }, { sheet: 'RCP', cell: 'C7' }, { sheet: 'RCP', cell: 'O20' }] },
  { id: 'scadenza', label: 'Scadenza', description: 'Data di scadenza della polizza (es. 31/12/2022)', type: 'date', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'E7' }, { sheet: 'RCT_O', cell: 'Q21' }, { sheet: 'RCP', cell: 'E7' }, { sheet: 'RCP', cell: 'Q20' }] },
  { id: 'attivita', label: 'Attività assicurata', description: "Descrizione dell'attività svolta dall'assicurato indicata in polizza", type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'A10' }, { sheet: 'RCP', cell: 'A10' }] },
  { id: 'rct_massimale_sinistro', label: 'Massimale per sinistro', description: 'Massimale RCT per ogni sinistro (RC verso Terzi e Prestatori di Lavoro), es. 3.000.000,00', type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'D15' }] },
  { id: 'rct_massimale_persona', label: 'Massimale per persona', description: 'Massimale RCT per ogni persona che abbia subito lesioni personali, es. 3.000.000,00', type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'E15' }] },
  { id: 'rct_massimale_danni', label: 'Massimale danni materiali', description: 'Massimale RCT per danni materiali (compresi gli animali), es. 3.000.000,00', type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'F15' }] },
  { id: 'rct_massimale_prestatore', label: 'Massimale per prestatore', description: 'Massimale RCT per ogni prestatore di lavoro che abbia subito lesioni personali, es. 3.000.000,00', type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'D16' }] },
  { id: 'rct_parametro', label: 'Parametro regolazione', description: 'Parametro utilizzato per la regolazione del premio RCT (es. Salari e stipendi + Quota TFR)', type: 'text', sheet: 'RCT_O', enabled: true, cells: [] },
  { id: 'rct_importo_preventivo', label: 'Importo preventivo parametro', description: "Importo preventivo annuo del parametro di regolazione RCT (es. 450.000,00)", type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'D23' }] },
  { id: 'rct_tasso', label: 'Tasso regolazione ‰', description: 'Tasso di regolazione imponibile per mille della sezione RCT (es. 2,450)', type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'E23' }] },
  { id: 'rct_premio_imponibile', label: 'Premio imponibile', description: "Premio/anticipo di sezione annuo imponibile della sezione RCT (es. 1.227,00)", type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'F28' }] },
  { id: 'rct_imposta', label: 'Imposta', description: "Imposta sul premio della sezione RCT (es. 273,00)", type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'F29' }] },
  { id: 'rct_premio_totale', label: 'Premio totale', description: "Premio/anticipo di sezione annuo totale della sezione RCT (es. 1.500,00)", type: 'text', sheet: 'RCT_O', enabled: true,
    cells: [{ sheet: 'RCT_O', cell: 'F30' }, { sheet: 'RCT_O', cell: 'F34' }] },
  { id: 'rcp_prodotti', label: 'Prodotti assicurati', description: 'Prodotti per i quali è stipulata la RC Prodotti (es. OLII E GRASSI ANIMALI O VEGETALI, NON ALIMENTARI)', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
  { id: 'rcp_qualifica', label: 'Qualifica assicurato', description: "Qualifica dell'assicurato nella sezione RC Prodotti (es. Fabbricante)", type: 'text', sheet: 'RCP', enabled: true, cells: [] },
  { id: 'rcp_massimale_sinistro', label: 'Massimale per sinistro', description: 'Massimale RC Prodotti per ogni sinistro, es. 5.000.000,00', type: 'text', sheet: 'RCP', enabled: true,
    cells: [{ sheet: 'RCP', cell: 'D14' }] },
  { id: 'rcp_massimale_annuo', label: 'Massimale annuo', description: 'Massimale RC Prodotti per più sinistri e per anno assicurativo, es. 5.000.000,00', type: 'text', sheet: 'RCP', enabled: true,
    cells: [{ sheet: 'RCP', cell: 'E14' }] },
  { id: 'rcp_massimale_mat', label: 'Massimale danni materiali', description: 'Massimale RC Prodotti per danni materiali (compresi gli animali), es. 500.000,00', type: 'text', sheet: 'RCP', enabled: true,
    cells: [{ sheet: 'RCP', cell: 'F14' }] },
  { id: 'rcp_massimale_interr', label: 'Massimale interruzione attività', description: 'Massimale RC Prodotti per danni da interruzione o sospensione di attività, es. 5.000.000,00', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
  { id: 'rcp_scoperto_min_mondo', label: 'Scoperto minimo - Resto del mondo', description: 'Minimo di scoperto per i danni avvenuti nel resto del mondo (esclusi USA/Canada/Messico), es. 6.000,00', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
  { id: 'rcp_scoperto_max_mondo', label: 'Scoperto massimo - Resto del mondo', description: 'Massimo di scoperto per i danni avvenuti nel resto del mondo (esclusi USA/Canada/Messico), es. 100.000,00', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
  { id: 'rcp_scoperto_min_usa', label: 'Scoperto minimo - USA/Canada/Messico', description: 'Minimo di scoperto per i danni avvenuti in USA, Canada e Messico, es. 75.000,00', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
  { id: 'rcp_scoperto_max_usa', label: 'Scoperto massimo - USA/Canada/Messico', description: 'Massimo di scoperto per i danni avvenuti in USA, Canada e Messico, es. 150.000,00', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
  { id: 'rcp_parametro', label: 'Parametro regolazione', description: 'Parametro utilizzato per la regolazione del premio RCP (es. Ricavi delle vendite e delle prestazioni)', type: 'text', sheet: 'RCP', enabled: true, cells: [] },
  { id: 'rcp_importo_preventivo', label: 'Importo preventivo parametro', description: "Importo preventivo annuo del parametro di regolazione RCP (es. 240.000.000,00)", type: 'text', sheet: 'RCP', enabled: true,
    cells: [{ sheet: 'RCP', cell: 'D20' }] },
  { id: 'rcp_tasso', label: 'Tasso regolazione ‰', description: 'Tasso di regolazione imponibile per mille della sezione RCP (es. 0,245)', type: 'text', sheet: 'RCP', enabled: true,
    cells: [{ sheet: 'RCP', cell: 'E20' }] },
  { id: 'rcp_premio_imponibile', label: 'Premio imponibile', description: "Premio/anticipo di sezione annuo imponibile della sezione RC Prodotti (es. 58.799,99)", type: 'text', sheet: 'RCP', enabled: true,
    cells: [{ sheet: 'RCP', cell: 'F30' }] },
  { id: 'rcp_imposta', label: 'Imposta', description: "Imposta sul premio della sezione RC Prodotti (es. 13.082,99)", type: 'text', sheet: 'RCP', enabled: true,
    cells: [{ sheet: 'RCP', cell: 'F31' }] },
  { id: 'rcp_premio_totale', label: 'Premio totale', description: "Premio/anticipo di sezione annuo totale della sezione RC Prodotti (es. 71.882,98)", type: 'text', sheet: 'RCP', enabled: true,
    cells: [{ sheet: 'RCP', cell: 'F32' }, { sheet: 'RCP', cell: 'F37' }] }
]

function formatCells(cells) {
  return (cells || []).map(c => c.sheet + ':' + c.cell).join(' ')
}

function parseCells(str) {
  if (!str || !str.trim()) return []
  return str.split(/[\s,]+/).filter(Boolean).map(part => {
    const [sheet, cell] = part.split(':')
    if (!sheet || !cell) return null
    return { sheet: sheet.toUpperCase(), cell: cell.toUpperCase() }
  }).filter(Boolean)
}

function PolizzaFieldRow({ field, onChange, onDelete, onCopy, isDragOver, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const [cellsRaw, setCellsRaw] = useState(formatCells(field.cells))
  const lastFieldId = useRef(field.id)

  if (field.id !== lastFieldId.current) {
    lastFieldId.current = field.id
  }

  useEffect(() => {
    setCellsRaw(formatCells(field.cells))
  }, [field.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={{
        display: 'grid',
        gridTemplateColumns: '20px 30px 130px 1fr 80px 160px 28px 28px',
        gap: 6,
        alignItems: 'center',
        padding: '4px 0',
        borderBottom: '1px solid var(--c-border)',
        borderTop: isDragOver ? '2px solid var(--c-accent)' : '2px solid transparent',
        transition: 'border-top-color 0.1s'
      }}
    >
      <span
        title="Trascina per riordinare"
        style={{ cursor: 'grab', color: 'var(--c-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <IconGrip />
      </span>

      <label className="toggle" title="Abilitato" style={{ margin: 0 }}>
        <input
          type="checkbox"
          checked={field.enabled !== false}
          onChange={e => onChange({ ...field, enabled: e.target.checked })}
          aria-label={`Abilita campo ${field.label}`}
        />
        <span className="toggle-track"><span className="toggle-thumb" /></span>
      </label>

      <input
        className="field-input-sm"
        type="text"
        value={field.label || ''}
        onChange={e => onChange({ ...field, label: e.target.value })}
        placeholder="Etichetta"
        aria-label="Etichetta campo"
        style={{ width: '100%' }}
      />

      <input
        className="field-input-sm"
        type="text"
        value={field.description || ''}
        onChange={e => onChange({ ...field, description: e.target.value })}
        placeholder="Descrizione per AI"
        aria-label="Descrizione per AI"
        style={{ width: '100%' }}
      />

      <input
        className="field-input-sm"
        type="text"
        value={cellsRaw}
        onChange={e => {
          setCellsRaw(e.target.value)
          const parsed = parseCells(e.target.value)
          if (parsed.length > 0 || e.target.value.trim() === '') {
            onChange({ ...field, cells: parsed })
          }
        }}
        onBlur={e => {
          const parsed = parseCells(e.target.value)
          onChange({ ...field, cells: parsed })
          setCellsRaw(formatCells(parsed))
        }}
        placeholder="es. RCT_O:C3 RCP:C3"
        aria-label="Celle Excel"
        style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 11 }}
      />

      <button
        onClick={() => onCopy(field.id)}
        aria-label={`Duplica campo ${field.label}`}
        title="Copia riga sotto"
        style={{ padding: '4px 6px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-muted)', borderRadius: 'var(--r-sm)', display: 'flex', alignItems: 'center' }}
      >
        <IconCopy />
      </button>

      <button
        className="btn-danger"
        onClick={() => onDelete(field.id)}
        aria-label={`Elimina campo ${field.label}`}
        title="Elimina campo"
        style={{ padding: '4px 6px' }}
      >
        <IconTrash />
      </button>
    </div>
  )
}

function PolizzaFieldsSection({ fields, onChange, promptExtra, onPromptExtraChange }) {
  const [dragging, setDragging] = useState(null)
  const [dragOver, setDragOver] = useState(null)

  const updateField = (updated) => {
    onChange(fields.map(f => f.id === updated.id ? updated : f))
  }

  const deleteField = (id) => {
    onChange(fields.filter(f => f.id !== id))
  }

  const copyField = (id) => {
    const idx = fields.findIndex(f => f.id === id)
    if (idx === -1) return
    const original = fields[idx]
    const copy = {
      ...original,
      cells: (original.cells || []).map(c => ({ ...c })),
      id: Date.now().toString()
    }
    const next = [...fields]
    next.splice(idx + 1, 0, copy)
    onChange(next)
  }

  const handleDragStart = (e, id) => {
    setDragging(id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (e, id) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id !== dragging) setDragOver(id)
  }

  const handleDrop = (e, targetId) => {
    e.preventDefault()
    if (!dragging || dragging === targetId) { setDragging(null); setDragOver(null); return }
    const idx = fields.findIndex(f => f.id === dragging)
    const targetIdx = fields.findIndex(f => f.id === targetId)
    const next = [...fields]
    const [removed] = next.splice(idx, 1)
    next.splice(targetIdx, 0, removed)
    onChange(next)
    setDragging(null)
    setDragOver(null)
  }

  const handleDragEnd = () => { setDragging(null); setDragOver(null) }

  const addField = () => {
    onChange([
      ...fields,
      {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(),
        label: '',
        description: '',
        type: 'text',
        enabled: true,
        cells: []
      }
    ])
  }

  const resetToDefaults = () => {
    onChange(DEFAULT_POLIZZA_FIELDS.map(f => ({ ...f })))
  }

  return (
    <section className="card-section" aria-labelledby="section-polizza-fields">
      <h2 className="section-title" id="section-polizza-fields">Polizze RC — Campi e mappatura Excel</h2>
      <p className="section-desc">Configura i campi da estrarre e le celle del Gestionale Excel dove scriverli.</p>

      <div className="form-group" style={{ marginBottom: 16 }}>
        <label className="form-label" htmlFor="polizza-prompt-extra">
          Istruzioni aggiuntive per il prompt di estrazione
        </label>
        <textarea
          id="polizza-prompt-extra"
          className="form-input"
          rows={3}
          value={promptExtra || ''}
          onChange={e => onPromptExtraChange(e.target.value)}
          placeholder="Istruzioni extra da includere nel prompt AI (es. 'Ignora la sezione CGA per i massimali', 'La compagnia si chiama sempre Generali')…"
          style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: 13 }}
          aria-label="Istruzioni aggiuntive per il prompt di estrazione"
        />
        <p className="text-muted text-sm" style={{ marginTop: 4 }}>
          Questo testo viene aggiunto al prompt inviato all'AI durante l'estrazione dei dati.
        </p>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '20px 30px 130px 1fr 160px 28px 28px',
          gap: 6,
          padding: '4px 0 6px',
          borderBottom: '2px solid var(--c-border)',
          marginBottom: 2
        }}>
          <span />
          <span />
          <span className="field-label-sm" style={{ fontWeight: 600 }}>Etichetta</span>
          <span className="field-label-sm" style={{ fontWeight: 600 }}>Descrizione AI</span>
          <span className="field-label-sm" style={{ fontWeight: 600, fontFamily: 'var(--font-mono)', fontSize: 11 }}>Celle Excel</span>
          <span />
          <span />
        </div>

        {fields.length === 0 ? (
          <p className="text-muted text-sm" style={{ padding: '12px 0' }}>Nessun campo configurato.</p>
        ) : (
          <div role="list" aria-label="Campi Polizza RC" onDragLeave={() => setDragOver(null)}>
            {fields.map(field => (
              <PolizzaFieldRow
                key={field.id}
                field={field}
                onChange={updateField}
                onDelete={deleteField}
                onCopy={copyField}
                isDragOver={dragOver === field.id}
                onDragStart={e => handleDragStart(e, field.id)}
                onDragOver={e => handleDragOver(e, field.id)}
                onDrop={e => handleDrop(e, field.id)}
                onDragEnd={handleDragEnd}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        <button
          className="btn btn-secondary"
          onClick={addField}
          aria-label="Aggiungi campo polizza"
        >
          <IconPlus />
          + Aggiungi campo
        </button>
        <button
          className="btn btn-secondary"
          onClick={resetToDefaults}
          aria-label="Ripristina predefiniti CSA"
        >
          <IconRefresh />
          Ripristina predefiniti CSA
        </button>
      </div>
    </section>
  )
}

function FieldItem({ field, onChange, onDelete, t }) {
  const labelId = useId()
  const descId = useId()
  const toggleId = useId()
  const typeId = useId()

  return (
    <div className="field-item" role="listitem">
      <div style={{ paddingTop: 4 }}>
        <label className="toggle" htmlFor={toggleId} title={t('settings.enableField')}>
          <input
            id={toggleId}
            type="checkbox"
            checked={field.enabled}
            onChange={e => onChange({ ...field, enabled: e.target.checked })}
            aria-label={`${t('settings.enableField')}: ${field.label || t('settings.fieldLabelPlaceholder')}`}
          />
          <span className="toggle-track">
            <span className="toggle-thumb" />
          </span>
        </label>
      </div>

      <div className="field-inputs">
        <div className="field-row">
          <label htmlFor={labelId} className="field-label-sm">{t('settings.fieldLabel')}</label>
          <input
            id={labelId}
            className="field-input-sm"
            type="text"
            value={field.label}
            onChange={e => onChange({ ...field, label: e.target.value })}
            placeholder={t('settings.fieldLabelPlaceholder')}
            aria-label={t('settings.fieldLabel')}
          />
        </div>
        <div className="field-row">
          <label htmlFor={descId} className="field-label-sm">{t('settings.fieldDesc')}</label>
          <input
            id={descId}
            className="field-input-sm"
            type="text"
            value={field.description}
            onChange={e => onChange({ ...field, description: e.target.value })}
            placeholder={t('settings.fieldDescPlaceholder')}
            aria-label={t('settings.fieldDesc')}
          />
        </div>
        <div className="field-row">
          <label htmlFor={typeId} className="field-label-sm">{t('settings.fieldType')}</label>
          <select
            id={typeId}
            className="field-input-sm"
            value={field.type || 'text'}
            onChange={e => onChange({ ...field, type: e.target.value })}
            aria-label={t('settings.fieldType')}
          >
            {FIELD_TYPES.map(type => (
              <option key={type} value={type}>{t(`settings.type${type.charAt(0).toUpperCase() + type.slice(1)}`)}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        className="btn-danger"
        onClick={() => onDelete(field.id)}
        aria-label={`${t('settings.deleteField')}: ${field.label}`}
        title={t('settings.deleteField')}
      >
        <IconTrash />
      </button>
    </div>
  )
}

function PolizzaProfileItem({ profile, onDelete, onApply, t }) {
  return (
    <div className="field-item" role="listitem">
      <div className="field-inputs">
        <div className="field-row">
          <span className="field-label-sm">{profile.name}</span>
          <span className="text-muted text-sm">
            {profile.fields?.length || 0} {t('settings.polizzaProfileFields')}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          className="btn btn-secondary"
          onClick={() => onApply(profile.id)}
          aria-label={`${t('settings.applyPolizzaProfile')}: ${profile.name}`}
          style={{ fontSize: 12, padding: '4px 10px' }}
        >
          {t('settings.applyPolizzaProfile')}
        </button>
        <button
          className="btn-danger"
          onClick={() => onDelete(profile.id)}
          aria-label={`${t('settings.deletePolizzaProfile')}: ${profile.name}`}
          title={t('settings.deletePolizzaProfile')}
        >
          <IconTrash />
        </button>
      </div>
    </div>
  )
}

function ProfileItem({ profile, onDelete, t }) {
  return (
    <div className="field-item" role="listitem">
      <div className="field-inputs">
        <div className="field-row">
          <span className="field-label-sm">{profile.name}</span>
          <span className="text-muted text-sm">
            {profile.fields?.length || 0} {t('settings.fieldLabel').toLowerCase()}
          </span>
        </div>
      </div>
      <button
        className="btn-danger"
        onClick={() => onDelete(profile.id)}
        aria-label={`${t('settings.deleteProfile')}: ${profile.name}`}
        title={t('settings.deleteProfile')}
      >
        <IconTrash />
      </button>
    </div>
  )
}

export default function Settings({ onThemeChange, onLangChange, onAccentChange, currentTheme, currentLang }) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState(null)
  const [ollamaStatus, setOllamaStatus] = useState({ connected: false, models: [] })
  const [checkingOllama, setCheckingOllama] = useState(false)
  const [testingOpenAI, setTestingOpenAI] = useState(false)
  const [testingAnthropic, setTestingAnthropic] = useState(false)
  const [openAITestResult, setOpenAITestResult] = useState(null)
  const [anthropicTestResult, setAnthropicTestResult] = useState(null)
  const [saved, setSaved] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const [newPolizzaProfileName, setNewPolizzaProfileName] = useState('')
  const polizzaProfileImportRef = useRef(null)

  useEffect(() => {
    window.electronAPI.getSettings().then(s => setSettings(s))
    checkOllama()
  }, [])

  const checkOllama = async () => {
    setCheckingOllama(true)
    const status = await window.electronAPI.getOllamaStatus()
    setOllamaStatus(status)
    setCheckingOllama(false)
  }

  const checkOllamaUrl = async (url) => {
    setCheckingOllama(true)
    const status = await window.electronAPI.getOllamaStatusUrl(url)
    setOllamaStatus(status)
    setCheckingOllama(false)
  }

  const testOpenAI = async () => {
    setTestingOpenAI(true)
    setOpenAITestResult(null)
    try {
      const res = await window.electronAPI.testOpenAI(settings.openaiApiKey, settings.openaiModel)
      setOpenAITestResult(res.connected ? 'ok' : 'fail')
    } catch {
      setOpenAITestResult('fail')
    }
    setTestingOpenAI(false)
  }

  const testAnthropic = async () => {
    setTestingAnthropic(true)
    setAnthropicTestResult(null)
    try {
      const res = await window.electronAPI.testAnthropic(settings.anthropicApiKey, settings.anthropicModel)
      setAnthropicTestResult(res.connected ? 'ok' : 'fail')
    } catch {
      setAnthropicTestResult('fail')
    }
    setTestingAnthropic(false)
  }

  const addField = () => {
    setSettings(s => ({
      ...s,
      extractions: [
        ...s.extractions,
        { id: Date.now().toString(), label: '', description: '', enabled: true, type: 'text' }
      ]
    }))
  }

  const updateField = (updated) => {
    setSettings(s => ({
      ...s,
      extractions: s.extractions.map(f => f.id === updated.id ? updated : f)
    }))
  }

  const deleteField = (id) => {
    setSettings(s => ({
      ...s,
      extractions: s.extractions.filter(f => f.id !== id)
    }))
  }

  const addProfile = () => {
    if (!newProfileName.trim()) return
    const profile = {
      id: Date.now().toString(),
      name: newProfileName.trim(),
      fields: settings.extractions.map(f => ({ ...f }))
    }
    setSettings(s => ({ ...s, profiles: [...(s.profiles || []), profile] }))
    setNewProfileName('')
  }

  const deleteProfile = (id) => {
    setSettings(s => ({ ...s, profiles: (s.profiles || []).filter(p => p.id !== id) }))
  }

  const addPolizzaProfile = () => {
    if (!newPolizzaProfileName.trim()) return
    const profile = {
      id: Date.now().toString(),
      name: newPolizzaProfileName.trim(),
      fields: (settings.polizzaFields || []).map(f => ({ ...f, cells: [...(f.cells || [])] })),
      promptExtra: settings.polizzaPromptExtra || '',
      verificaCampi: settings.polizzaVerificaCampi || '',
      verificaModel: settings.polizzaVerificaModel || '',
      ocrEnabled: settings.polizzaOcrEnabled !== false,
      consensusPasses: settings.polizzaConsensusPasses || 3,
      wholeDossier: !!settings.polizzaWholeDossier,
      wholeDossierModel: settings.polizzaWholeDossierModel || ''
    }
    const next = { ...settings, polizzaProfiles: [...(settings.polizzaProfiles || []), profile] }
    setSettings(next)
    // Persisti SUBITO su disco: "Salva profilo" deve salvare davvero, non solo in memoria
    // (altrimenti un riavvio dell'app perde il profilo).
    try { window.electronAPI.saveSettings(next) } catch (_) {}
    setNewPolizzaProfileName('')
  }

  const deletePolizzaProfile = (id) => {
    setSettings(s => ({ ...s, polizzaProfiles: (s.polizzaProfiles || []).filter(p => p.id !== id) }))
  }

  const applyPolizzaProfile = (id) => {
    const profile = (settings.polizzaProfiles || []).find(p => p.id === id)
    if (!profile) return
    setSettings(s => ({
      ...s,
      polizzaFields: profile.fields.map(f => ({ ...f, cells: [...(f.cells || [])] })),
      polizzaPromptExtra: profile.promptExtra || '',
      polizzaVerificaCampi: profile.verificaCampi ?? s.polizzaVerificaCampi ?? '',
      polizzaVerificaModel: profile.verificaModel ?? s.polizzaVerificaModel ?? '',
      polizzaOcrEnabled: profile.ocrEnabled ?? s.polizzaOcrEnabled ?? true,
      polizzaConsensusPasses: profile.consensusPasses ?? s.polizzaConsensusPasses ?? 3,
      polizzaWholeDossier: profile.wholeDossier ?? s.polizzaWholeDossier ?? false,
      polizzaWholeDossierModel: profile.wholeDossierModel ?? s.polizzaWholeDossierModel ?? 'claude-haiku-4-5-20251001'
    }))
  }

  const exportPolizzaProfiles = () => {
    const data = JSON.stringify(settings.polizzaProfiles || [], null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'profili-polizza.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const importPolizzaProfiles = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result)
        const imported = Array.isArray(parsed) ? parsed : [parsed]
        if (imported.length === 0) return
        const base = Date.now()
        const newProfiles = imported.map((p, i) => ({ ...p, id: (base + i).toString() }))
        // Applica SUBITO l'ultimo profilo importato e PERSISTI su disco: l'import deve
        // ripristinare la configurazione COMPLETA e funzionante (descrizioni campi +
        // istruzioni aggiuntive + verifica mirata + fascicolo intero + MODELLO), non
        // limitarsi ad aggiungere una voce alla lista. Così "gli altri" importano e basta.
        const p = newProfiles[newProfiles.length - 1]
        const next = {
          ...settings,
          polizzaProfiles: [...(settings.polizzaProfiles || []), ...newProfiles],
          ...(Array.isArray(p.fields) && p.fields.length
            ? { polizzaFields: p.fields.map(f => ({ ...f, cells: [...(f.cells || [])] })) }
            : {}),
          polizzaPromptExtra: p.promptExtra ?? settings.polizzaPromptExtra ?? '',
          polizzaVerificaCampi: p.verificaCampi ?? settings.polizzaVerificaCampi ?? '',
          polizzaVerificaModel: p.verificaModel ?? settings.polizzaVerificaModel ?? '',
          polizzaOcrEnabled: p.ocrEnabled ?? settings.polizzaOcrEnabled ?? true,
          polizzaConsensusPasses: p.consensusPasses ?? settings.polizzaConsensusPasses ?? 3,
          polizzaWholeDossier: p.wholeDossier ?? settings.polizzaWholeDossier ?? false,
          polizzaWholeDossierModel: p.wholeDossierModel ?? settings.polizzaWholeDossierModel ?? 'claude-haiku-4-5-20251001'
        }
        setSettings(next)
        try { window.electronAPI.saveSettings(next) } catch (_) {}
      } catch {}
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const save = async () => {
    await window.electronAPI.saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    if (settings.theme !== currentTheme) onThemeChange(settings.theme)
    if (settings.language !== currentLang) onLangChange(settings.language)
    if (onAccentChange) onAccentChange(settings.accentColor)
    // Signal main process to restart webhook if needed
    try { window.electronAPI.saveSettings(settings) } catch (_) {}
  }

  if (!settings) {
    return (
      <div className="page-body flex items-center" style={{ justifyContent: 'center' }}>
        <div className="spinner" aria-label={t('common.loading')} />
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{t('settings.title')}</h1>
        <p className="page-subtitle">{t('settings.subtitle')}</p>
      </div>

      <div className="page-body">
        {/* Extraction Fields */}
        <section className="card-section" aria-labelledby="section-extractions">
          <h2 className="section-title" id="section-extractions">{t('settings.sectionExtractions')}</h2>
          <p className="section-desc">{t('settings.sectionExtractionsDesc')}</p>

          {settings.extractions.length === 0 ? (
            <p className="text-muted text-sm" style={{ padding: '12px 0' }}>{t('settings.noFields')}</p>
          ) : (
            <div className="field-list" role="list" aria-label={t('settings.sectionExtractions')}>
              {settings.extractions.map(field => (
                <FieldItem
                  key={field.id}
                  field={field}
                  onChange={updateField}
                  onDelete={deleteField}
                  t={t}
                />
              ))}
            </div>
          )}

          <button
            className="btn btn-secondary"
            onClick={addField}
            style={{ marginTop: 12 }}
            aria-label={t('settings.addField')}
          >
            <IconPlus />
            {t('settings.addField')}
          </button>
        </section>

        <div className="sep" />

        {/* Extraction Profiles */}
        <section className="card-section" aria-labelledby="section-profiles">
          <h2 className="section-title" id="section-profiles">{t('settings.sectionProfiles')}</h2>
          <p className="section-desc">{t('settings.sectionProfilesDesc')}</p>

          {(!settings.profiles || settings.profiles.length === 0) ? (
            <p className="text-muted text-sm" style={{ padding: '8px 0 12px' }}>{t('settings.noProfiles')}</p>
          ) : (
            <div className="field-list" role="list" aria-label={t('settings.sectionProfiles')} style={{ marginBottom: 12 }}>
              {settings.profiles.map(profile => (
                <ProfileItem
                  key={profile.id}
                  profile={profile}
                  onDelete={deleteProfile}
                  t={t}
                />
              ))}
            </div>
          )}

          <div className="flex gap-2" style={{ alignItems: 'center' }}>
            <input
              className="form-input"
              type="text"
              value={newProfileName}
              onChange={e => setNewProfileName(e.target.value)}
              placeholder={t('settings.profileNamePlaceholder')}
              aria-label={t('settings.profileName')}
              onKeyDown={e => e.key === 'Enter' && addProfile()}
              style={{ maxWidth: 240 }}
            />
            <button
              className="btn btn-secondary"
              onClick={addProfile}
              disabled={!newProfileName.trim()}
              aria-label={t('settings.addProfile')}
            >
              <IconPlus />
              {t('settings.addProfile')}
            </button>
          </div>
          <p className="text-muted text-sm" style={{ marginTop: 6 }}>
            {t('settings.sectionProfilesDesc')}
          </p>
        </section>

        <div className="sep" />

        {/* LLM Provider */}
        <section className="card-section" aria-labelledby="section-llm-provider">
          <h2 className="section-title" id="section-llm-provider">{t('settings.sectionLLMProvider')}</h2>
          <p className="section-desc">{t('settings.sectionLLMProviderDesc')}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="llm-provider">{t('settings.llmProvider')}</label>
              <select
                id="llm-provider"
                className="form-select"
                value={settings.llmProvider || 'ollama'}
                onChange={e => setSettings(s => ({ ...s, llmProvider: e.target.value }))}
                style={{ maxWidth: 240 }}
              >
                <option value="ollama">{t('settings.providerOllama')}</option>
                <option value="openai">{t('settings.providerOpenAI')}</option>
                <option value="anthropic">{t('settings.providerAnthropic')}</option>
              </select>
            </div>
            {(settings.llmProvider === 'openai' || settings.llmProvider === 'anthropic') && (
              <div className="alert alert-warning" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <strong>{t('compliance.gdprCloudWarningTitle')}</strong>
                <span>{t('compliance.gdprCloudWarning', { provider: settings.llmProvider === 'openai' ? 'OpenAI' : 'Anthropic' })}</span>
              </div>
            )}
          </div>
        </section>

        <div className="sep" />

        {/* LLM / Ollama */}
        <section className="card-section" aria-labelledby="section-llm">
          <h2 className="section-title" id="section-llm">{t('settings.sectionLLM')}</h2>
          <p className="section-desc">{t('settings.sectionLLMDesc')}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="ollama-url">{t('settings.ollamaUrl')}</label>
              <div className="flex gap-2">
                <input
                  id="ollama-url"
                  className="form-input"
                  type="url"
                  value={settings.ollamaUrl}
                  onChange={e => setSettings(s => ({ ...s, ollamaUrl: e.target.value }))}
                  placeholder={t('settings.ollamaUrlPlaceholder')}
                  aria-label={t('settings.ollamaUrl')}
                />
                <button
                  className="btn btn-secondary"
                  onClick={() => checkOllamaUrl(settings.ollamaUrl)}
                  disabled={checkingOllama}
                  aria-label={t('settings.ollamaRetry')}
                  style={{ flexShrink: 0, gap: 6 }}
                >
                  {checkingOllama
                    ? <div className="spinner spinner-sm" aria-hidden="true" />
                    : <IconRefresh />}
                  {t('settings.ollamaRetry')}
                </button>
              </div>

              <div className="status-row" style={{ marginTop: 6 }}>
                <span
                  className={`status-dot${ollamaStatus.connected ? ' connected' : ' disconnected'}`}
                  aria-hidden="true"
                />
                <span>
                  {ollamaStatus.connected ? t('settings.ollamaConnected') : t('settings.ollamaDisconnected')}
                </span>
                <span className="sr-only" aria-live="polite">
                  {ollamaStatus.connected ? t('settings.ollamaConnected') : t('settings.ollamaDisconnected')}
                </span>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="ollama-model">{t('settings.ollamaModel')}</label>
              {ollamaStatus.connected && ollamaStatus.models.length > 0 ? (
                <select
                  id="ollama-model"
                  className="form-select"
                  value={settings.ollamaModel}
                  onChange={e => setSettings(s => ({ ...s, ollamaModel: e.target.value }))}
                  aria-label={t('settings.ollamaModel')}
                >
                  <option value="">{t('settings.ollamaModelNone')}</option>
                  {ollamaStatus.models.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <div>
                  <div className="alert alert-warning" role="status" style={{ marginBottom: 8 }}>
                    {t('settings.ollamaNoModels')}
                  </div>
                  <p className="text-muted text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
                    {t('settings.ollamaInstallHint')}
                  </p>
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="ollama-vision-model">
                Modello vision (per PDF scansionati)
              </label>
              <input
                id="ollama-vision-model"
                className="form-input"
                type="text"
                value={settings.ollamaVisionModel || ''}
                onChange={e => setSettings(s => ({ ...s, ollamaVisionModel: e.target.value }))}
                placeholder="es. llava, minicpm-v, llama3.2-vision"
                aria-label="Modello Ollama vision"
                style={{ maxWidth: 280 }}
              />
              <p className="text-muted text-sm" style={{ marginTop: 4 }}>
                Necessario solo per PDF scansionati. Vuoto = usa lo stesso modello testo.
                OpenAI e Anthropic supportano già vision con il modello configurato.
              </p>
            </div>
          </div>
        </section>

        <div className="sep" />

        {/* OpenAI */}
        <section className="card-section" aria-labelledby="section-openai">
          <h2 className="section-title" id="section-openai">{t('settings.providerOpenAI')}</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="openai-key">{t('settings.openaiApiKey')}</label>
              <input
                id="openai-key"
                className="form-input"
                type="password"
                value={settings.openaiApiKey || ''}
                onChange={e => setSettings(s => ({ ...s, openaiApiKey: e.target.value }))}
                placeholder={t('settings.openaiApiKeyPlaceholder')}
                aria-label={t('settings.openaiApiKey')}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="openai-model">{t('settings.openaiModel')}</label>
              <input
                id="openai-model"
                className="form-input"
                type="text"
                value={settings.openaiModel || 'gpt-4o-mini'}
                onChange={e => setSettings(s => ({ ...s, openaiModel: e.target.value }))}
                aria-label={t('settings.openaiModel')}
              />
            </div>
            <div className="flex gap-2 items-center">
              <button
                className="btn btn-secondary"
                onClick={testOpenAI}
                disabled={testingOpenAI || !settings.openaiApiKey}
              >
                {testingOpenAI ? <div className="spinner spinner-sm" aria-hidden="true" /> : <IconRefresh />}
                {t('settings.testConnection')}
              </button>
              {openAITestResult === 'ok' && (
                <span className="alert alert-success" style={{ padding: '4px 10px', fontSize: 12 }}>
                  {t('settings.connectionOk')}
                </span>
              )}
              {openAITestResult === 'fail' && (
                <span className="alert alert-error" style={{ padding: '4px 10px', fontSize: 12 }}>
                  {t('settings.connectionFail')}
                </span>
              )}
            </div>
          </div>
        </section>

        <div className="sep" />

        {/* Anthropic */}
        <section className="card-section" aria-labelledby="section-anthropic">
          <h2 className="section-title" id="section-anthropic">{t('settings.providerAnthropic')}</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="anthropic-key">{t('settings.anthropicApiKey')}</label>
              <input
                id="anthropic-key"
                className="form-input"
                type="password"
                value={settings.anthropicApiKey || ''}
                onChange={e => setSettings(s => ({ ...s, anthropicApiKey: e.target.value }))}
                placeholder={t('settings.anthropicApiKeyPlaceholder')}
                aria-label={t('settings.anthropicApiKey')}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="anthropic-model">{t('settings.anthropicModel')}</label>
              <input
                id="anthropic-model"
                className="form-input"
                type="text"
                value={settings.anthropicModel || 'claude-haiku-4-5-20251001'}
                onChange={e => setSettings(s => ({ ...s, anthropicModel: e.target.value }))}
                aria-label={t('settings.anthropicModel')}
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="anthropic-vision-model">Modello OCR / vision (PDF scansionati)</label>
              <input
                id="anthropic-vision-model"
                className="form-input"
                type="text"
                placeholder="Vuoto = stesso modello sopra · es. claude-sonnet-4-6 per OCR migliore"
                value={settings.anthropicVisionModel || ''}
                onChange={e => setSettings(s => ({ ...s, anthropicVisionModel: e.target.value }))}
                aria-label="Modello OCR vision Anthropic"
              />
              <p style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
                Usato SOLO per i PDF scansionati (OCR). Lascia vuoto per usare lo stesso modello dell'estrazione testo.
              </p>
            </div>
            <div className="flex gap-2 items-center">
              <button
                className="btn btn-secondary"
                onClick={testAnthropic}
                disabled={testingAnthropic || !settings.anthropicApiKey}
              >
                {testingAnthropic ? <div className="spinner spinner-sm" aria-hidden="true" /> : <IconRefresh />}
                {t('settings.testConnection')}
              </button>
              {anthropicTestResult === 'ok' && (
                <span className="alert alert-success" style={{ padding: '4px 10px', fontSize: 12 }}>
                  {t('settings.connectionOk')}
                </span>
              )}
              {anthropicTestResult === 'fail' && (
                <span className="alert alert-error" style={{ padding: '4px 10px', fontSize: 12 }}>
                  {t('settings.connectionFail')}
                </span>
              )}
            </div>
          </div>
        </section>

        <div className="sep" />

        {/* Indice vettoriale (Qdrant + embeddings Ollama) */}
        <section className="card-section" aria-labelledby="section-vector">
          <h2 className="section-title" id="section-vector">{t('settings.sectionVector')}</h2>
          <p className="section-desc">{t('settings.sectionVectorDesc')}</p>
          <div className="form-group">
            <label className="form-label" htmlFor="qdrant-url">{t('settings.qdrantUrl')}</label>
            <input
              id="qdrant-url"
              className="form-input"
              type="text"
              value={settings.qdrantUrl || ''}
              onChange={e => setSettings(s => ({ ...s, qdrantUrl: e.target.value }))}
              placeholder="http://127.0.0.1:6333"
              aria-label={t('settings.qdrantUrl')}
            />
            <p className="text-muted text-sm">{t('settings.qdrantUrlHelp')}</p>
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="qdrant-collection">{t('settings.qdrantCollection')}</label>
            <input
              id="qdrant-collection"
              className="form-input"
              type="text"
              value={settings.qdrantCollection || ''}
              onChange={e => setSettings(s => ({ ...s, qdrantCollection: e.target.value }))}
              placeholder="documenti"
              aria-label={t('settings.qdrantCollection')}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="embedding-model">{t('settings.embeddingModel')}</label>
            <input
              id="embedding-model"
              className="form-input"
              type="text"
              value={settings.embeddingModel || ''}
              onChange={e => setSettings(s => ({ ...s, embeddingModel: e.target.value }))}
              placeholder="bge-m3"
              aria-label={t('settings.embeddingModel')}
            />
            <p className="text-muted text-sm">{t('settings.embeddingModelHelp')}</p>
          </div>
        </section>

        <div className="sep" />

        {/* Webhook */}
        <section className="card-section" aria-labelledby="section-webhook">
          <h2 className="section-title" id="section-webhook">{t('settings.sectionWebhook')}</h2>
          <p className="section-desc">{t('settings.sectionWebhookDesc')}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="toggle" htmlFor="webhook-enabled" title={t('settings.webhookEnabled')}>
                <input
                  id="webhook-enabled"
                  type="checkbox"
                  checked={settings.webhookEnabled || false}
                  onChange={e => setSettings(s => ({ ...s, webhookEnabled: e.target.checked }))}
                  aria-label={t('settings.webhookEnabled')}
                />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
              </label>
              <span style={{ marginLeft: 10 }}>{t('settings.webhookEnabled')}</span>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="webhook-port">{t('settings.webhookPort')}</label>
              <input
                id="webhook-port"
                className="form-input"
                type="number"
                min="1024"
                max="65535"
                value={settings.webhookPort || 3847}
                onChange={e => setSettings(s => ({ ...s, webhookPort: parseInt(e.target.value, 10) || 3847 }))}
                placeholder={t('settings.webhookPortPlaceholder')}
                aria-label={t('settings.webhookPort')}
                style={{ maxWidth: 120 }}
              />
            </div>
            <p className="text-muted text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
              {t('settings.webhookInfo')}
            </p>
            {settings.webhookEnabled && settings.webhookToken && (
              <WebhookTokenField token={settings.webhookToken} />
            )}
          </div>
        </section>

        <div className="sep" />

        {/* Notifications */}
        <section className="card-section" aria-labelledby="section-notifications">
          <h2 className="section-title" id="section-notifications">{t('settings.sectionNotifications')}</h2>
          <p className="section-desc">{t('settings.notificationsDesc')}</p>

          <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label className="toggle" htmlFor="notif-enabled" title={t('settings.notificationsEnabled')}>
              <input
                id="notif-enabled"
                type="checkbox"
                checked={settings.notificationsEnabled !== false}
                onChange={e => setSettings(s => ({ ...s, notificationsEnabled: e.target.checked }))}
                aria-label={t('settings.notificationsEnabled')}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
            </label>
            <span>{t('settings.notificationsEnabled')}</span>
          </div>
        </section>

        <div className="sep" />

        {/* Privacy / Data Retention */}
        <section className="card-section" aria-labelledby="section-privacy">
          <h2 className="section-title" id="section-privacy">{t('compliance.sectionPrivacy')}</h2>
          <p className="section-desc">{t('compliance.sectionPrivacyDesc')}</p>

          <div className="form-group">
            <label className="form-label" htmlFor="retention-days">{t('compliance.retentionDays')}</label>
            <input
              id="retention-days"
              className="form-input"
              type="number"
              min="0"
              max="365"
              value={settings.sessionRetentionDays ?? 90}
              onChange={e => setSettings(s => ({ ...s, sessionRetentionDays: parseInt(e.target.value, 10) || 0 }))}
              style={{ maxWidth: 100 }}
              aria-label={t('compliance.retentionDays')}
            />
            <p className="text-muted text-sm" style={{ marginTop: 4 }}>
              {t('compliance.retentionDaysHint')}
            </p>
          </div>
        </section>

        <div className="sep" />

        {/* Appearance */}
        <section className="card-section" aria-labelledby="section-appearance">
          <h2 className="section-title" id="section-appearance">{t('settings.sectionAppearance')}</h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-group">
              <label className="form-label" htmlFor="theme-select">{t('settings.theme')}</label>
              <select
                id="theme-select"
                className="form-select"
                value={settings.theme}
                onChange={e => setSettings(s => ({ ...s, theme: e.target.value }))}
                aria-label={t('settings.theme')}
                style={{ maxWidth: 200 }}
              >
                <option value="dark">{t('settings.themeDark')}</option>
                <option value="light">{t('settings.themeLight')}</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="lang-select">{t('settings.language')}</label>
              <select
                id="lang-select"
                className="form-select"
                value={settings.language}
                onChange={e => setSettings(s => ({ ...s, language: e.target.value }))}
                aria-label={t('settings.language')}
                style={{ maxWidth: 200 }}
              >
                <option value="it">Italiano</option>
                <option value="en">English</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="accent-color">{t('settings.accentColor')}</label>
              <div className="flex gap-2 items-center">
                <input
                  id="accent-color"
                  type="color"
                  value={settings.accentColor || '#e91e8c'}
                  onChange={e => setSettings(s => ({ ...s, accentColor: e.target.value }))}
                  aria-label={t('settings.accentColor')}
                  style={{ width: 48, height: 36, padding: 2, cursor: 'pointer', borderRadius: 6, border: '1px solid var(--c-border)' }}
                />
                <button
                  className="btn btn-ghost"
                  onClick={() => setSettings(s => ({ ...s, accentColor: '' }))}
                  aria-label={t('settings.accentColorReset')}
                >
                  {t('settings.accentColorReset')}
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="sep" />

        {/* Polizza RC Fields */}
        <PolizzaFieldsSection
          fields={settings.polizzaFields || []}
          onChange={fields => setSettings(s => ({ ...s, polizzaFields: fields }))}
          promptExtra={settings.polizzaPromptExtra || ''}
          onPromptExtraChange={val => setSettings(s => ({ ...s, polizzaPromptExtra: val }))}
        />

        <div className="sep" />

        {/* Polizza RC — Verifica accurata mirata (#5/#6) */}
        <section className="card-section" aria-labelledby="section-polizza-verifica">
          <h2 className="section-title" id="section-polizza-verifica">Verifica accurata (mirata)</h2>
          <p className="section-desc">Solo i campi elencati qui ricevono il trattamento pesante: più letture di consenso e, se restano discordi, arbitraggio con un modello più forte. Gli altri campi restano a una passata. Vuoto = nessuna verifica (comportamento normale).</p>

          <div className="form-group" style={{ marginTop: 12 }}>
            <label className="form-label" htmlFor="polizza-verifica-campi">Campi da verificare (id o etichette, separati da virgola)</label>
            <input
              id="polizza-verifica-campi"
              className="form-input"
              type="text"
              value={settings.polizzaVerificaCampi || ''}
              onChange={e => setSettings(s => ({ ...s, polizzaVerificaCampi: e.target.value }))}
              placeholder="es. Decorrenza, Scadenza, Parametro regolazione, Franchigia generica o minima RCT"
            />
          </div>

          <div className="flex gap-2" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ flex: '1 1 280px', marginBottom: 0 }}>
              <label className="form-label" htmlFor="polizza-verifica-model">Modello di arbitraggio (quando le passate discordano)</label>
              <input
                id="polizza-verifica-model"
                className="form-input"
                type="text"
                value={settings.polizzaVerificaModel || ''}
                onChange={e => setSettings(s => ({ ...s, polizzaVerificaModel: e.target.value }))}
                placeholder="claude-sonnet-4-6"
              />
            </div>
            <div className="form-group" style={{ width: 150, marginBottom: 0 }}>
              <label className="form-label" htmlFor="polizza-consensus">Passate di consenso</label>
              <input
                id="polizza-consensus"
                className="form-input"
                type="number"
                min={2}
                max={5}
                value={settings.polizzaConsensusPasses ?? 3}
                onChange={e => setSettings(s => ({ ...s, polizzaConsensusPasses: parseInt(e.target.value, 10) || 3 }))}
              />
            </div>
            <div className="form-group" style={{ minWidth: 320, marginBottom: 0 }}>
              <label className="form-label" htmlFor="polizza-staged-strategy">Strategia di estrazione (motore a stadi, Ollama)</label>
              <select
                id="polizza-staged-strategy"
                className="form-input"
                value={settings.polizzaStagedCascade === true ? 'cascade' : 'groups'}
                onChange={e => setSettings(s => ({ ...s, polizzaStagedCascade: e.target.value === 'cascade' }))}
              >
                <option value="groups">Gruppi a copertura totale (default)</option>
                <option value="cascade">Cascata dal documento più recente (sperimentale)</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2" style={{ alignItems: 'center', marginTop: 14 }}>
            <label className="toggle" title="OCR del testo" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={settings.polizzaOcrEnabled !== false}
                onChange={e => setSettings(s => ({ ...s, polizzaOcrEnabled: e.target.checked }))}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
            </label>
            <span className="text-sm">OCR del testo (Tesseract) come fonte primaria — richiede «npm install tesseract.js»</span>
          </div>

          <div className="flex gap-2" style={{ alignItems: 'center', marginTop: 14 }}>
            <label className="toggle" title="Fascicolo intero" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={!!settings.polizzaWholeDossier}
                onChange={e => setSettings(s => ({ ...s, polizzaWholeDossier: e.target.checked }))}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
            </label>
            <span className="text-sm">Modalità «fascicolo intero»: OCR di tutti i documenti e UNA sola chiamata (il modello li confronta tutti insieme). Più precisa sulla selezione-fonte (anno/preventivo-consuntivo).</span>
          </div>
          {settings.polizzaWholeDossier && (
            <div className="form-group" style={{ marginTop: 10, maxWidth: 380 }}>
              <label className="form-label" htmlFor="polizza-whole-model">Modello per il fascicolo intero</label>
              <input
                id="polizza-whole-model"
                className="form-input"
                type="text"
                value={settings.polizzaWholeDossierModel || ''}
                onChange={e => setSettings(s => ({ ...s, polizzaWholeDossierModel: e.target.value }))}
                placeholder="claude-haiku-4-5-20251001 (o claude-sonnet-4-6 per più precisione)"
              />
            </div>
          )}

          <div className="flex gap-2" style={{ alignItems: 'center', marginTop: 14 }}>
            <label className="toggle" title="Motore per-campo (Ollama)" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={settings.polizzaPerField !== false}
                onChange={e => setSettings(s => ({ ...s, polizzaPerField: e.target.checked }))}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
            </label>
            <span className="text-sm">Motore «una domanda per campo» (solo Ollama): recupera i passaggi rilevanti a ogni campo e pone una domanda focalizzata — più preciso in locale, fonte reale. Spento = fascicolo intero. Richiede il modello embeddings («ollama pull bge-m3»).</span>
          </div>
        </section>

        <div className="sep" />

        {/* Polizza RC Profiles */}
        <section className="card-section" aria-labelledby="section-polizza-profiles">
          <h2 className="section-title" id="section-polizza-profiles">{t('settings.sectionPolizzaProfiles')}</h2>
          <p className="section-desc">{t('settings.sectionPolizzaProfilesDesc')}</p>

          {(!settings.polizzaProfiles || settings.polizzaProfiles.length === 0) ? (
            <p className="text-muted text-sm" style={{ padding: '8px 0 12px' }}>{t('settings.noPolizzaProfiles')}</p>
          ) : (
            <div className="field-list" role="list" aria-label={t('settings.sectionPolizzaProfiles')} style={{ marginBottom: 12 }}>
              {settings.polizzaProfiles.map(profile => (
                <PolizzaProfileItem
                  key={profile.id}
                  profile={profile}
                  onDelete={deletePolizzaProfile}
                  onApply={applyPolizzaProfile}
                  t={t}
                />
              ))}
            </div>
          )}

          <div className="flex gap-2" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="form-input"
              type="text"
              value={newPolizzaProfileName}
              onChange={e => setNewPolizzaProfileName(e.target.value)}
              placeholder={t('settings.polizzaProfileNamePlaceholder')}
              aria-label={t('settings.polizzaProfileName')}
              onKeyDown={e => e.key === 'Enter' && addPolizzaProfile()}
              style={{ maxWidth: 240 }}
            />
            <button
              className="btn btn-secondary"
              onClick={addPolizzaProfile}
              disabled={!newPolizzaProfileName.trim()}
            >
              <IconPlus />
              {t('settings.savePolizzaProfile')}
            </button>
            <button
              className="btn btn-ghost"
              onClick={exportPolizzaProfiles}
              disabled={!settings.polizzaProfiles?.length}
            >
              {t('settings.exportPolizzaProfiles')}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => polizzaProfileImportRef.current?.click()}
            >
              {t('settings.importPolizzaProfiles')}
            </button>
            <input
              ref={polizzaProfileImportRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={importPolizzaProfiles}
            />
          </div>
        </section>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingTop: 8 }}>
          <button
            className="btn btn-primary"
            onClick={save}
            aria-label={t('settings.saveButton')}
          >
            {t('settings.saveButton')}
          </button>
          {saved && (
            <span
              className="alert alert-success"
              role="status"
              aria-live="polite"
              style={{ padding: '7px 14px' }}
            >
              {t('settings.saved')}
            </span>
          )}
        </div>
      </div>
    </>
  )
}
