import React, { useState, useRef } from 'react';

const DEFAULT_FIELDS = [
  { label: 'Nome',             description: 'Nome della persona o entità principale', enabled: true },
  { label: 'Data',             description: 'Data principale del documento',          enabled: true },
  { label: 'Importo',          description: 'Importo o valore monetario',             enabled: true },
  { label: 'Numero documento', description: 'Numero identificativo del documento',   enabled: true },
];

function toBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export default function Extractor() {
  const [file, setFile]       = useState(null);
  const [fields, setFields]   = useState(DEFAULT_FIELDS);
  const [result, setResult]   = useState(null);
  const [loading, setLoad]    = useState(false);
  const [error, setError]     = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDesc, setNewDesc]   = useState('');
  const fileRef = useRef();

  function toggle(i)  { setFields(f => f.map((x,j) => j===i ? {...x, enabled: !x.enabled} : x)); }
  function remove(i)  { setFields(f => f.filter((_,j) => j!==i)); }
  function addField() {
    if (!newLabel.trim()) return;
    setFields(f => [...f, { label: newLabel.trim(), description: newDesc.trim(), enabled: true }]);
    setNewLabel(''); setNewDesc('');
  }

  async function extract() {
    if (!file) return;
    setLoad(true); setError(''); setResult(null);
    try {
      const pdf_base64 = await toBase64(file);
      const res = await fetch('/api/extract', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pdf_base64, filename: file.name, fields: fields.filter(f => f.enabled) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Errore ${res.status}`);
      setResult(await res.json());
    } catch (e) { setError(e.message); }
    finally { setLoad(false); }
  }

  function downloadJson() {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([JSON.stringify(result.result, null, 2)], { type: 'application/json' })),
      download: `${file?.name ?? 'extraction'}.json`,
    });
    a.click();
  }

  return (
    <div className="page">
      <h1 className="page-title">Estrazione Dati PDF</h1>

      <div className="card">
        <h2 className="card-title">File PDF</h2>
        <div className={`drop-zone ${file ? 'has-file' : ''}`}
          onClick={() => fileRef.current.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); setFile(e.dataTransfer.files[0]); setResult(null); }}>
          <input type="file" ref={fileRef} accept=".pdf" style={{ display: 'none' }}
            onChange={e => { setFile(e.target.files[0]); setResult(null); }} />
          {file
            ? <><div className="file-icon">📄</div><span className="file-name">{file.name}</span></>
            : <><div className="upload-icon">⬆️</div><span>Trascina un PDF o clicca per selezionarlo</span></>}
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">Campi da estrarre</h2>
        <div className="fields-list">
          {fields.map((f, i) => (
            <div key={i} className={`field-item ${f.enabled ? '' : 'disabled'}`}>
              <input type="checkbox" className="field-check" checked={f.enabled} onChange={() => toggle(i)} />
              <span className="field-label-text">{f.label}</span>
              <span className="field-desc">{f.description}</span>
              <button className="btn-remove" onClick={() => remove(i)} title="Rimuovi">✕</button>
            </div>
          ))}
        </div>
        <div className="add-field">
          <input className="field-input small" placeholder="Nome campo" value={newLabel}
            onChange={e => setNewLabel(e.target.value)} onKeyDown={e => e.key === 'Enter' && addField()} />
          <input className="field-input small" placeholder="Descrizione" value={newDesc}
            onChange={e => setNewDesc(e.target.value)} onKeyDown={e => e.key === 'Enter' && addField()} />
          <button className="btn-secondary small" onClick={addField}>+ Campo</button>
        </div>
      </div>

      <button className="btn-primary extract-btn" onClick={extract}
        disabled={!file || loading || !fields.some(f => f.enabled)}>
        {loading ? 'Estrazione in corso...' : 'Estrai dati'}
      </button>

      {error && <div className="error-msg">{error}</div>}

      {result && (
        <div className="card result-card">
          <div className="result-header">
            <h2 className="card-title">Risultato</h2>
            <span className="result-meta">{result.pages} pag · {result.duration_ms}ms</span>
            <button className="btn-secondary" onClick={downloadJson}>↓ JSON</button>
          </div>
          <table className="result-table"><tbody>
            {Object.entries(result.result).map(([k, v]) => (
              <tr key={k}>
                <td className="result-key">{k}</td>
                <td className="result-val">{v !== null ? String(v) : <em>—</em>}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
    </div>
  );
}
