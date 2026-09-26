// Voci del menu della sezione PDF Extractor, condivise tra la Sidebar e la
// card «Voci di menu» delle Impostazioni tecniche (22/09/2026, richiesta
// dell'utente: uno switch per voce, «decido volta per volta cosa mostrare»).
// Le voci nascoste stanno in settings.navHiddenExtractor (elenco di href);
// le pagine restano raggiungibili dal loro indirizzo.
export interface NavEntry { href: string; key: string }

export const NAV_EXTRACTOR_ITEMS: NavEntry[] = [
  { href: '/extractor', key: 'nav.extractor' },
  { href: '/polizza', key: 'nav.polizza' },
  { href: '/polizza/bulk', key: 'nav.bulk' },
  { href: '/polizza/jobs', key: 'nav.jobsDash' },
  // Riepiloghi generali (26/09/2026): polizze estratte dello stesso profilo, sommate e per anno.
  { href: '/polizza/riepiloghi', key: 'nav.summaries' },
  { href: '/batch', key: 'nav.batch' },
  { href: '/archive', key: 'nav.archive' },
  { href: '/chat', key: 'nav.chat' },
  { href: '/maintenance', key: 'nav.data' },
  { href: '/history', key: 'nav.history' },
  { href: '/settings', key: 'nav.settings' },
  { href: '/settings/technical', key: 'nav.settingsTech' },
  { href: '/diagnostics', key: 'nav.security' },
  { href: '/contacts', key: 'nav.contacts' },
]

// Mai nascondibile: è la pagina da cui si riaccendono le altre voci.
export const NAV_ALWAYS_VISIBLE = new Set<string>(['/settings/technical'])

export function visibleExtractorNav(hidden: string[] | null | undefined): NavEntry[] {
  const h = new Set(hidden || [])
  return NAV_EXTRACTOR_ITEMS.filter((i) => NAV_ALWAYS_VISIBLE.has(i.href) || !h.has(i.href))
}
