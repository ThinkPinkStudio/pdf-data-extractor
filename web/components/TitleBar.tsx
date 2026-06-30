'use client'

import { useTranslation } from 'react-i18next'

// Barra del titolo come nell'app. Nota: i controlli finestra (min/max/chiudi) e
// il drag sono specifici di Electron e non esistono in un tab del browser —
// è l'unica differenza inevitabile dovuta alla piattaforma. Resta la barra col
// brand, identica visivamente.
export default function TitleBar() {
  const { t } = useTranslation()
  return (
    <div className="titlebar">
      <div className="titlebar-title">{t('brand.name')}</div>
    </div>
  )
}
