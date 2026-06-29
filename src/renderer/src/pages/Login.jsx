import { useState } from 'react'
import styles from './Login.module.css'

export default function Login({ onLoginSuccess }) {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState('idle') // idle | sending | error
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email.trim()) return
    setStatus('sending')
    setErrorMsg('')

    const result = await window.electronAPI.authSendMagicLink(email.trim())

    if (result.success) {
      onLoginSuccess(result.email)
    } else if (result.error?.includes('Timeout')) {
      setStatus('error')
      setErrorMsg('Timeout: nessun accesso ricevuto entro il limite. Riprova.')
    } else {
      setStatus('error')
      setErrorMsg(result.error || 'Errore durante l\'invio del link.')
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        {/* Logo */}
        <div className={styles.logoWrap}>
          <div className={styles.logoIcon}>📄</div>
          <h1 className={styles.title}>PDF Data Extractor</h1>
          <p className={styles.subtitle}>Accedi con un link sicuro via email</p>
        </div>

        {status === 'sending' ? (
          <div className={styles.waiting}>
            <div className={styles.spinner} />
            <p className={styles.waitingText}>
              Link inviato a <strong>{email}</strong>
            </p>
            <p className={styles.waitingHint}>
              Clicca il link nella tua email — questa finestra si aggiornerà automaticamente.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className={styles.form}>
            {status === 'error' && (
              <div className={styles.error}>{errorMsg}</div>
            )}
            <div className={styles.field}>
              <label className={styles.label} htmlFor="login-email">Email</label>
              <input
                id="login-email"
                className={styles.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@azienda.it"
                required
                autoFocus
              />
            </div>
            <button type="submit" className={styles.btn} disabled={status === 'sending'}>
              Invia link di accesso
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
