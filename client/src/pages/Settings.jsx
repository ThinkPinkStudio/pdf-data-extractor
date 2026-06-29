import React, { useEffect, useState } from 'react';

export default function Settings() {
  const [me, setMe]             = useState(null);
  const [logs, setLogs]         = useState([]);
  const [loadingLogs, setLoadL] = useState(false);

  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' }).then(r => r.json()).then(setMe).catch(() => {});
  }, []);

  async function loadLogs() {
    setLoadL(true);
    try {
      const res  = await fetch('/api/audit?limit=50', { credentials: 'include' });
      const data = await res.json();
      setLogs(data.items ?? []);
    } finally { setLoadL(false); }
  }

  return (
    <div className="page">
      <h1 className="page-title">Impostazioni</h1>

      <div className="card">
        <h2 className="card-title">Sessione corrente</h2>
        {me && <dl className="info-list">
          <dt>Utente</dt><dd>{me.email}</dd>
          <dt>Scade</dt><dd>{me.session_expires ? new Date(me.session_expires).toLocaleString('it-IT') : '—'}</dd>
        </dl>}
      </div>

      <div className="card">
        <h2 className="card-title">Configurazione server</h2>
        <p className="hint">La configurazione LLM e tutti i parametri sono gestiti tramite variabili d'ambiente sul server.</p>
        <dl className="info-list">
          <dt>Provider LLM</dt>       <dd><code>LLM_PROVIDER</code></dd>
          <dt>Dominio autorizzato</dt><dd><code>ALLOWED_EMAIL_DOMAIN</code></dd>
          <dt>IP API autorizzati</dt> <dd><code>API_ALLOWED_IPS</code></dd>
          <dt>IP MCP autorizzati</dt> <dd><code>MCP_ALLOWED_IPS</code></dd>
        </dl>
      </div>

      <div className="card">
        <div className="result-header">
          <h2 className="card-title">Audit Log NIS2</h2>
          <button className="btn-secondary" onClick={loadLogs} disabled={loadingLogs}>
            {loadingLogs ? 'Caricamento...' : 'Carica ultimi 50'}
          </button>
        </div>
        {logs.length > 0 && (
          <div className="audit-table-wrap">
            <table className="result-table">
              <thead><tr><th>Data/Ora</th><th>Utente</th><th>Azione</th><th>Risultato</th><th>IP</th></tr></thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id} className={log.result === 'failure' ? 'audit-failure' : ''}>
                    <td>{new Date(log.ts).toLocaleString('it-IT')}</td>
                    <td>{log.user_email ?? '—'}</td>
                    <td><code>{log.action}</code></td>
                    <td>{log.result ?? '—'}</td>
                    <td>{log.ip_address ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
