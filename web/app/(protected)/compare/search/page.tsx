import { redirect } from 'next/navigation'

// La pagina «Ricerca» è stata FUSA in «Confronto righe» (/compare/both):
// erano due viste della stessa operazione, con condizioni salvate in due posti
// diversi. Il redirect preserva i vecchi link/preferiti.
export default function CompareSearchRedirect() {
  redirect('/compare/both')
}
