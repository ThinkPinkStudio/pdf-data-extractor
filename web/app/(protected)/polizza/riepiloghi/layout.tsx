import './riepilogo.css'

// RIEPILOGHI GENERALI (26/09/2026): le pagine della sezione stanno dentro
// .rp-scope, a cui sono legate tutte le classi rp-* di riepilogo.css.
export default function SummariesLayout({ children }: { children: React.ReactNode }) {
  return <div className="rp-scope">{children}</div>
}
