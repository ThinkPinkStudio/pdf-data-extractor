import { useState, useEffect, useId } from 'react'
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

function FieldItem({ field, onChange, onDelete, t }) {
  const labelId = useId()
  const descId = useId()
  const toggleId = useId()

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

export default function Settings({ onThemeChange, onLangChange, currentTheme, currentLang }) {
  const { t } = useTranslation()
  const [settings, setSettings] = useState(null)
  const [ollamaStatus, setOllamaStatus] = useState({ connected: false, models: [] })
  const [checkingOllama, setCheckingOllama] = useState(false)
  const [saved, setSaved] = useState(false)

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

  const addField = () => {
    setSettings(s => ({
      ...s,
      extractions: [
        ...s.extractions,
        { id: Date.now().toString(), label: '', description: '', enabled: true }
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

  const save = async () => {
    await window.electronAPI.saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    if (settings.theme !== currentTheme) onThemeChange(settings.theme)
    if (settings.language !== currentLang) onLangChange(settings.language)
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
