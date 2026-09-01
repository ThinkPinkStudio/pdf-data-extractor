'use client'

import { useState, Suspense } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/I18nProvider'

function ForgotForm() {
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
      const res = await fetch('/api/auth/forgot', {
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
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{t('auth.resetSent')}</h2>
        <Link
          href="/auth/login"
          className="btn btn-secondary"
          style={{ display: 'inline-block', marginTop: 24, padding: '10px 20px', fontSize: 14 }}
        >
          {t('auth.backToLogin')}
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={{ width: '100%' }}>
      {status === 'error' && (
        <div className="alert alert-error" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600 }}>{errorMsg}</div>
          {errorDetail && <div style={{ fontSize: 12, marginTop: 6, opacity: 0.9, wordBreak: 'break-word' }}>{errorDetail}</div>}
        </div>
      )}

      <div className="form-group">
        <label className="label" htmlFor="forgot-email">{t('auth.email')}</label>
        <input
          id="forgot-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('auth.emailPlaceholder')}
          required
          autoFocus
          autoComplete="email"
          style={{ fontSize: 15, padding: '11px 14px' }}
        />
      </div>

      <button
        type="submit"
        className="btn btn-primary"
        style={{ width: '100%', padding: '12px 20px', fontSize: 14, fontWeight: 600, marginTop: 4 }}
        disabled={status === 'loading'}
      >
        {status === 'loading' ? <span className="spinner" style={{ width: 18, height: 18 }} /> : t('auth.forgotSubmit')}
      </button>

      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <Link href="/auth/login" style={{ fontSize: 13, color: 'var(--c-accent)' }}>
          {t('auth.backToLogin')}
        </Link>
      </div>
    </form>
  )
}

export default function ForgotPage() {
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
        <ForgotShell />
        <Suspense>
          <ForgotForm />
        </Suspense>
      </div>
    </div>
  )
}

function ForgotShell() {
  const t = useT()
  return (
    <>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>
        {t('auth.forgotTitle')}
      </h2>
      <p style={{ color: 'var(--c-text-muted)', fontSize: 13, marginBottom: 20, textAlign: 'center', lineHeight: 1.5 }}>
        {t('auth.forgotSubtitle')}
      </p>
    </>
  )
}