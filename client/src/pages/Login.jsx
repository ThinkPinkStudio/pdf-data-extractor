import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail]   = useState('');
  const [sent, setSent]     = useState(false);
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState('');
  const navigate            = useNavigate();

  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { if (d.authenticated) navigate('/', { replace: true }); })
      .catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setLoad(true); setError('');
    try {
      await fetch('/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch {
      setError('Errore di rete. Riprova.');
    } finally {
      setLoad(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">📄</div>
        <h1 className="login-title">PDF Data Extractor</h1>
        <p className="login-subtitle">Accesso riservato ai domini autorizzati</p>

        {sent ? (
          <div className="login-sent">
            <div className="sent-icon">✉️</div>
            <h2>Link inviato!</h2>
            <p>Controlla la tua email e clicca il link.<br />Valido per 15 minuti.</p>
            <button className="btn-secondary" style={{marginTop:16}} onClick={() => setSent(false)}>
              Invia un altro link
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="login-form">
            <label className="field-label">Email aziendale</label>
            <input
              type="email" className="field-input"
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="nome@azienda.it" required autoFocus
            />
            {error && <div className="error-msg">{error}</div>}
            <button type="submit" className="btn-primary" disabled={loading || !email}>
              {loading ? 'Invio...' : 'Invia link di accesso'}
            </button>
          </form>
        )}
        <p className="login-footer">ThinkPink Studio · NIS2 Compliant</p>
      </div>
    </div>
  );
}
