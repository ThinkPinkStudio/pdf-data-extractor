'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: 'Link non valido.',
  expired: 'Link scaduto. Richiedi un nuovo accesso.',
  used: 'Link già utilizzato. Richiedi un nuovo accesso.',
  not_found: 'Link non riconosciuto. Richiedi un nuovo accesso.',
}

function LoginForm() {
  const searchParams = useSearchParams()
  const errorParam = searchParams.get('error')
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setErrorMsg('')
    const res = await fetch('/api/auth/send-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (res.ok) {
      setStatus('sent')
    } else {
      const data = await res.json().catch(() => ({}))
      setErrorMsg(data.error || "Errore durante l'invio. Riprova.")
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'rgba(108,99,255,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, margin: '0 auto 20px',
        }}>📧</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Controlla la tua email</h2>
        <p style={{ color: 'var(--c-text-muted)', fontSize: 13, lineHeight: 1.6 }}>
          Abbiamo inviato un link di accesso a<br />
          <strong style={{ color: 'var(--c-text)' }}>{email}</strong>.<br />
          Il link è valido per 15 minuti.
        </p>
        <button
          className="btn btn-secondary"
          style={{ marginTop: 24 }}
          onClick={() => setStatus('idle')}
        >
          Usa un&apos;altra email
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      {(errorParam || status === 'error') && (
        <div className="alert alert-error" style={{ marginBottom: 20 }}>
          {errorParam
            ? (ERROR_MESSAGES[errorParam] || 'Errore di accesso.')
            : errorMsg}
        </div>
      )}

      <div className="form-group">
        <label className="label" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@azienda.it"
          required
          autoFocus
          style={{ fontSize: 15, padding: '11px 14px' }}
        />
      </div>

      <button
        type="submit"
        className="btn btn-primary"
        style={{ width: '100%', padding: '12px 20px', fontSize: 14, fontWeight: 600, marginTop: 4 }}
        disabled={status === 'loading'}
      >
        {status === 'loading' ? <span className="spinner" style={{ width: 18, height: 18 }} /> : 'Invia link di accesso'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
      background: 'var(--c-bg)',
    }}>
      {/* Logo / brand */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{
          width: 52, height: 52,
          borderRadius: 14,
          background: 'linear-gradient(135deg, var(--c-accent) 0%, #574fd6 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, margin: '0 auto 16px',
          boxShadow: '0 4px 20px rgba(108,99,255,0.35)',
        }}>📄</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 6 }}>
          PDF Data Extractor
        </h1>
        <p style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>
          Accedi con un link sicuro via email
        </p>
      </div>

      {/* Card */}
      <div style={{
        width: '100%',
        maxWidth: 380,
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: 14,
        padding: '28px 28px 24px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
      }}>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>

      <p style={{ marginTop: 20, color: 'var(--c-text-muted)', fontSize: 12 }}>
        Solo gli utenti autorizzati possono accedere.
      </p>
    </div>
  )
}
