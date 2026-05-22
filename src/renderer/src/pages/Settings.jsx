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

const FIELD_TYPES = ['text', 'number', 'date', 'email', 'phone', 'iva', 'cf', 'url']

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
