// Polizza Vita: riusa i fogli di stile della sezione Anagrafiche RSM (stessi
// riquadri, tabelle e pannelli laterali), così le due sezioni restano identiche
// a vedersi senza duplicare il CSS.
//
// NOTA: i testi di queste pagine sono ancora scritti in italiano dentro i
// componenti, non in lib/i18n. È una scelta per l'anteprima da far approvare al
// cliente: le schermate possono ancora cambiare. Vanno portati nel catalogo
// (vitaMessages.ts, come la sezione Infortuni) quando la sezione si collega al
// database.
import '../rsm/rsm.css'

export default function VitaLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
