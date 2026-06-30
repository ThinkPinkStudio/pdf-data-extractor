'use client'

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react'
import Link from 'next/link'

function Dot({ status }: { status?: string }) {
  const color = status === 'ok' ? 'var(--c-success)' : status === 'warn' ? 'var(--c-warning)' : status === 'fail' ? 'var(--c-error)' : 'var(--c-text-muted)'
  return <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
}

function Row({ label, status, detail }: { label: string; status?: string; detail?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--c-separator)' }}>
      <Dot status={status} />
      <span style={{ fontSize: 13, fontWeight: 600, minWidth: 90 }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--c-text-secondary)', fontFamily: 'var(--font-mono)' }}>{detail}</span>
    </div>
  )
}

export default function DiagnosticsPage() {
  const [data, setData] = useState<any>(null)
  const [provider, setProvider] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  async function run() {
    setLoading(true); setData(null); setProvider(null)
    try {
      const [diag, prov] = await Promise.all([
        fetch('/api/diagnostics').then((r) => r.json()),
        fetch('/api/settings/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()).catch(() => null),
      ])
      setData(diag); setProvider(prov)
    } finally {
      setLoading(false)
    }
  }

  const L = data?.layers || {}
  return (
    <>
      <h1 className="page-title">Sicurezza &amp; Diagnostica</h1>
      <div style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={run} disabled={loading}>
            {loading ? <><span className="spinner" /> Diagnostica in corso…</> : 'Esegui diagnostica'}
          </button>
          <Link href="/logs" className="btn btn-secondary">Log azioni (admin)</Link>
        </div>

        {provider && (
          <div className="card">
            <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Connessione provider AI</h2>
            <Row label={provider.provider || 'Provider'} status={provider.ok ? 'ok' : 'fail'} detail={provider.message || (provider.ok ? 'OK' : 'Errore')} />
          </div>
        )}

        {data && (
          <>
            <div className="card">
              <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Rete ({data.endpoint?.label} · {data.endpoint?.host || data.endpoint?.url})</h2>
              {L.dns && <Row label="DNS" status={L.dns.status} detail={L.dns.status === 'ok' ? `${L.dns.ips?.join(', ')} (${L.dns.ms}ms)` : L.dns.error} />}
              {L.tcp && <Row label="TCP" status={L.tcp.status} detail={L.tcp.status === 'ok' ? `${L.tcp.peer} (${L.tcp.ms}ms)` : L.tcp.error} />}
              {L.tls && <Row label="TLS" status={L.tls.status} detail={L.tls.status !== 'fail' ? `${L.tls.protocol || ''} ${L.tls.intercepted ? '· ⚠ intercettazione TLS' : L.tls.authorized ? '· catena fidata' : '· catena non fidata'}` : L.tls.error} />}
              {L.http && <Row label="HTTP" status={L.http.status} detail={`${L.http.httpStatus ?? ''} ${L.http.error || ''}`} />}
              {L.error && <Row label="Errore" status="fail" detail={L.error} />}
            </div>

            <div className="card">
              <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>OCR (polizze scansionate)</h2>
              <Row label="Tesseract" status={data.ocr?.available ? 'ok' : 'fail'} detail={data.ocr?.available ? 'Disponibile' : data.ocr?.reason || 'Non disponibile'} />
            </div>

            <div className="card">
              <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Sistema</h2>
              <Row label="Piattaforma" detail={`${data.system?.platform} ${data.system?.arch}`} status="ok" />
              <Row label="Node" detail={data.system?.node} status="ok" />
              <Row label="Versione app" detail={data.system?.appVersion || 'n/d'} status="ok" />
            </div>
          </>
        )}
      </div>
    </>
  )
}
