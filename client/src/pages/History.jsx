import React, { useEffect, useState } from 'react';

export default function History() {
  const [items, setItems]   = useState([]);
  const [loading, setLoad]  = useState(true);
  const [selected, setSel]  = useState(null);

  useEffect(() => {
    fetch('/api/history', { credentials: 'include' })
      .then(r => r.json()).then(d => setItems(d.items ?? [])).finally(() => setLoad(false));
  }, []);

  async function del(id, e) {
    e.stopPropagation();
    await fetch(`/api/history/${id}`, { method: 'DELETE', credentials: 'include' });
    setItems(p => p.filter(x => x.id !== id));
    if (selected?.id === id) setSel(null);
  }

  if (loading) return <div className="page"><div className="loading">Caricamento...</div></div>;

  return (
    <div className="page">
      <h1 className="page-title">Cronologia Estrazioni</h1>
      {!items.length
        ? <div className="card empty-state">Nessuna estrazione ancora.</div>
        : <div className="history-layout">
            <div className="history-list">
              {items.map(item => (
                <div key={item.id} className={`history-item ${selected?.id===item.id?'active':''}`} onClick={() => setSel(item)}>
                  <div className="history-name">📄 {item.pdf_name ?? 'Documento'}</div>
                  <div className="history-meta">{new Date(item.created_at).toLocaleString('it-IT')} · {item.llm_provider}</div>
                  <button className="btn-remove" onClick={e => del(item.id, e)} title="Elimina">✕</button>
                </div>
              ))}
            </div>
            {selected && (
              <div className="history-detail card">
                <h3 style={{marginBottom:4}}>{selected.pdf_name}</h3>
                <div className="history-meta" style={{marginBottom:12}}>{new Date(selected.created_at).toLocaleString('it-IT')}</div>
                <table className="result-table"><tbody>
                  {selected.result && Object.entries(selected.result).map(([k,v]) => (
                    <tr key={k}><td className="result-key">{k}</td><td className="result-val">{v!==null?String(v):<em>—</em>}</td></tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </div>
      }
    </div>
  );
}
