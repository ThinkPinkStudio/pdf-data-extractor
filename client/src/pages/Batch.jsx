import React, { useState } from 'react';

const DEFAULT_FIELDS = [
  { label: 'Nome',    description: 'Nome entità principale', enabled: true },
  { label: 'Data',    description: 'Data principale',        enabled: true },
  { label: 'Importo', description: 'Valore monetario',       enabled: true },
  { label: 'N. documento', description: 'ID documento',     enabled: true },
];

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export default function Batch() {
  const [files, setFiles]   = useState([]);
  const [fields, setFields] = useState(DEFAULT_FIELDS);
  const [results, setRes]   = useState([]);
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState('');

  async function run() {
    setLoad(true); setError(''); setRes([]);
    try {
      const pdfs = await Promise.all(files.map(async f => ({ filename: f.name, pdf_base64: await toBase64(f) })));
      const res = await fetch('/api/batch', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdfs, fields: fields.filter(f => f.enabled) }),
      });
      if (!res.ok) throw new Error(`Errore ${res.status}`);
      setRes((await res.json()).results);
    } catch (e) { setError(e.message); }
    finally { setLoad(false); }
  }

  function downloadCsv() {
    const ok = results.filter(r => r.status === 'ok');
    if (!ok.length) return;
    const keys = Object.keys(ok[0].result);
    const csv = [['Filename', ...keys].join(';'), ...ok.map(r => [r.filename, ...keys.map(k => r.result[k] ?? '')].join(';'))].join('\n');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'batch-results.csv' });
    a.click();
  }

  return (
    <div className="page">
      <h1 className="page-title">Elaborazione Batch</h1>

      <div className="card">
        <h2 className="card-title">Seleziona PDF</h2>
        <input type="file" multiple accept=".pdf" className="file-input"
          onChange={e => { setFiles(Array.from(e.target.files).filter(f => f.type === 'application/pdf')); setRes([]); }} />
        {files.length > 0 && <div className="file-list">{files.map(f => <div key={f.name} className="file-chip">📄 {f.name}</div>)}</div>}
      </div>

      <div className="card">
        <h2 className="card-title">Campi</h2>
        {fields.map((f, i) => (
          <label key={i} className="field-row">
            <input type="checkbox" checked={f.enabled} onChange={() => setFields(fl => fl.map((x,j) => j===i ? {...x, enabled: !x.enabled} : x))} />
            <span>{f.label}</span>
          </label>
        ))}
      </div>

      <button className="btn-primary extract-btn" onClick={run} disabled={!files.length || loading}>
        {loading ? 'Elaborazione...' : `Elabora ${files.length} file`}
      </button>

      {error && <div className="error-msg">{error}</div>}

      {results.length > 0 && (
        <div className="card">
          <div className="result-header">
            <h2 className="card-title">Risultati ({results.filter(r=>r.status==='ok').length}/{results.length})</h2>
            <button className="btn-secondary" onClick={downloadCsv}>↓ CSV</button>
          </div>
          {results.map((r,i) => (
            <div key={i} className={`batch-result ${r.status}`}>
              <span className="batch-filename">📄 {r.filename}</span>
              {r.status === 'ok'
                ? <span className="batch-ok">✓ {Object.entries(r.result).map(([k,v]) => `${k}: ${v??'—'}`).join(' · ')}</span>
                : <span className="batch-err">✗ {r.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
