import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function Login({ onLoginSuccess }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | waiting | error
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('sending')
    setErrorMsg('')

    const result = await window.electronAPI.authSendMagicLink(email.trim())

    if (result.success) {
      // Login completed (magic link clicked in browser)
      onLoginSuccess(result.email)
    } else if (result.error?.includes('Timeout')) {
      setStatus('error')
      setErrorMsg('Timeout: nessun accesso ricevuto. Riprova.')
    } else {
      setStatus('error')
      setErrorMsg(result.error || t('auth.sendError'))
    }
  }

  return (
    <div className="login-overlay">
      <div className="login-card">
        <div className="login-logo">
          <span className="login-logo-icon">📄</span>
          <h1 className="login-title">{t('auth.title')}</h1>
          <p className="login-subtitle">{t('auth.subtitle')}</p>
        </div>

        {status === 'sending' ? (
          <div className="login-waiting">
            <div className="spinner" />
            <p>Email inviata a <strong>{email}</strong>.</p>
            <p style={{ color: 'var(--c-text-muted)', fontSize: 12, marginTop: 8 }}>
              Clicca il link nella tua email (si aprirà il browser).<br />
              Questa finestra si aggiornerà automaticamente.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {status === 'error' && (
              <div className="login-error">{errorMsg}</div>
            )}
            <div className="form-group">
              <label className="label" htmlFor="login-email">{t('auth.emailLabel')}</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                required
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={status === 'sending'}
            >
              {t('auth.sendLink')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
