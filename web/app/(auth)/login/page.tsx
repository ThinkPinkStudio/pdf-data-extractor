'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

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
      setErrorMsg(data.error || 'Errore durante l\'invio. Riprova.')
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
        <h2 style={{ marginBottom: 8 }}>Controlla la tua email</h2>
        <p style={{ color: 'var(--c-text-muted)' }}>
          Abbiamo inviato un link di accesso a <strong>{email}</strong>.<br />
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
    <form onSubmit={handleSubmit}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>PDF Data Extractor</h1>
      <p style={{ color: 'var(--c-text-muted)', marginBottom: 24, fontSize: 13 }}>
        Inserisci la tua email per ricevere il link di accesso.
      </p>

      {errorParam && (
        <div className="alert alert-error">{ERROR_MESSAGES[errorParam] || 'Errore di accesso.'}</div>
      )}
      {status === 'error' && (
        <div className="alert alert-error">{errorMsg}</div>
      )}

      <div className="form-group">
        <label className="label" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@esempio.it"
          required
          autoFocus
        />
      </div>

      <button
        type="submit"
        className="btn btn-primary"
        style={{ width: '100%' }}
        disabled={status === 'loading'}
      >
        {status === 'loading' ? <span className="spinner" /> : 'Invia link di accesso'}
      </button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 400 }}>
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
