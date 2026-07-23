'use client'

import { useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useT } from '@/lib/i18n/I18nProvider'

const ERROR_KEYS: Record<string, string> = {
  missing_token: 'auth.errInvalid',
  expired: 'auth.errExpired',
  used: 'auth.errUsed',
  not_found: 'auth.errNotFound',
}

function LoginForm() {
  const searchParams = useSearchParams()
  const errorParam = searchParams.get('error')
  const nextParam = searchParams.get('next')
  const ssoStartHref = nextParam
    ? `/api/auth/sso-start?next=${encodeURIComponent(nextParam)}`
    : '/api/auth/sso-start'
  const t = useT()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [errorDetail, setErrorDetail] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('loading')
    setErrorMsg('')
    setErrorDetail('')
    try {
      const res = await fetch('/api/auth/send-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.ok) {
        setStatus('sent')
      } else {
        const data = await res.json().catch(() => ({}))
        setErrorMsg(data.error || t('auth.errSend'))
        setErrorDetail(data.detail || '')
        setStatus('error')
      }
    } catch (err) {
      setErrorMsg(t('auth.errSend'))
      setErrorDetail((err as Error).message)
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: 'rgba(233,30,140,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, margin: '0 auto 20px',
        }}>📧</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{t('auth.checkEmail')}</h2>
        <p style={{ color: 'var(--c-text-muted)', fontSize: 13, lineHeight: 1.6 }}>
          {t('auth.sentTo', { email })}
        </p>
        <button
          className="btn btn-secondary"
          style={{ marginTop: 24 }}
          onClick={() => setStatus('idle')}
        >
          {t('auth.useAnother')}
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      {(errorParam || status === 'error') && (
        <div className="alert alert-error" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600 }}>{errorParam ? t(ERROR_KEYS[errorParam] || 'auth.errGeneric') : errorMsg}</div>
          {errorDetail && <div style={{ fontSize: 12, marginTop: 6, opacity: 0.9, wordBreak: 'break-word' }}>{errorDetail}</div>}
        </div>
      )}

      <div className="form-group">
        <label className="label" htmlFor="email">{t('auth.email')}</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('auth.emailPlaceholder')}
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
        {status === 'loading' ? <span className="spinner" style={{ width: 18, height: 18 }} /> : t('auth.sendLink')}
      </button>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        margin: '16px 0', fontSize: 11, textTransform: 'uppercase',
        letterSpacing: '0.06em', color: 'var(--c-text-muted)',
      }}>
        <span style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
        {t('auth.or')}
        <span style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
      </div>

      <a
        href={ssoStartHref}
        className="btn btn-secondary"
        style={{ width: '100%', padding: '12px 20px', fontSize: 14, fontWeight: 600, textAlign: 'center', display: 'block' }}
      >
        {t('auth.ssoButton')}
      </a>
    </form>
  )
}

function LoginShell() {
  const t = useT()
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
      background: 'var(--c-bg-app)',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{
          width: 52, height: 52,
          borderRadius: 14,
          background: 'var(--gradient-logo)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, margin: '0 auto 16px',
          boxShadow: '0 4px 20px var(--c-accent-dim)',
        }}>📄</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 6 }}>
          PDF Data Extractor
        </h1>
        <p style={{ color: 'var(--c-text-muted)', fontSize: 13 }}>
          {t('auth.subtitle')}
        </p>
      </div>

      <div style={{
        width: '100%',
        maxWidth: 380,
        background: 'var(--c-bg-card)',
        border: '1px solid var(--c-border)',
        borderRadius: 14,
        padding: '28px 28px 24px',
        boxShadow: 'var(--shadow-lg)',
      }}>
        <LoginForm />
      </div>

      <p style={{ marginTop: 20, color: 'var(--c-text-muted)', fontSize: 12 }}>
        {t('auth.authorizedOnly')}
      </p>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginShell />
    </Suspense>
  )
}
