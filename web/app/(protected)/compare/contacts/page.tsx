import ContactsCard from '@/components/ContactsCard'

// Portafoglio Compare usa il logo animato originale (cerchio 72px), come l'app
// desktop, invece del logo CSA usato dalla sezione Adesioni.
export default function CompareContactsPage() {
  return <ContactsCard logoSrc="/compare-logo.svg" logoSize={72} logoRounded="50%" />
}
