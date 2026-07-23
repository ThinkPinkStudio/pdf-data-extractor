// Scheda contatti ThinkPink Studio (portata dalle viste "Contatti" delle app
// desktop). Riusata dalle sezioni Portafoglio Compare e CSA Adesioni.
const IconPin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
)
const IconPhone = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81 19.79 19.79 0 01.12 1.18 2 2 0 012.11 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" /></svg>
)
const IconMail = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" /></svg>
)
const IconGlobe = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>
)

const ROWS: { icon: React.ReactNode; text: string }[] = [
  { icon: <IconPin />, text: 'Via Tito Speri 6, 57016 Rosignano Solvay (LI)' },
  { icon: <IconPhone />, text: '351 452 9451' },
  { icon: <IconMail />, text: 'info@thinkpinkstudio.it' },
  { icon: <IconGlobe />, text: 'www.thinkpinkstudio.it' },
]

export default function ContactsCard() {
  return (
    <>
      <h1 className="page-title">Contatti</h1>
      <p style={{ color: 'var(--c-text-secondary)', marginTop: -12, marginBottom: 18, fontSize: 14 }}>Sviluppato da ThinkPink Studio</p>
      <div className="card" style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--c-accent)', letterSpacing: '-0.5px' }}>ThinkPink Studio</div>
          <div style={{ fontSize: 13, color: 'var(--c-text-muted)' }}>Soluzioni digitali su misura</div>
        </div>
        <div style={{ borderTop: '1px solid var(--c-border)', margin: '4px 0 16px' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ROWS.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 14 }}>
              <span style={{ width: 18, height: 18, color: 'var(--c-accent)', flexShrink: 0, display: 'inline-flex' }}>{r.icon}</span>
              <span>{r.text}</span>
            </div>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--c-border)', margin: '16px 0' }} />
        <div style={{ fontSize: 13, color: 'var(--c-text-secondary)' }}>
          <strong>P.IVA</strong> 02871460347 · <strong>CF</strong> GLLFNC89C28Z611W
        </div>
      </div>
    </>
  )
}
