import { redirect } from 'next/navigation'

export default function Home() {
  // Pre-interfaccia (hub): da qui si sceglie una delle tre sezioni separate
  // (PDF Extractor, Portafoglio Compare, CSA Adesioni).
  redirect('/hub')
}
