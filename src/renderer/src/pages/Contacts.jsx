import { useTranslation } from 'react-i18next'
import iconUrl from '../assets/icon.png'

const IconPin = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
)

const IconPhone = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.5 2 2 0 0 1 3.6 1.32h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6.29 6.29l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
  </svg>
)

const IconMail = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
)

const IconGlobe = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
)

const contactRows = [
  {
    key: 'address',
    icon: <IconPin />,
    type: 'text',
    ariaLabel: 'Indirizzo'
  },
  {
    key: 'phone',
    icon: <IconPhone />,
    type: 'tel',
    ariaLabel: 'Telefono'
  },
  {
    key: 'email',
    icon: <IconMail />,
    type: 'email',
    ariaLabel: 'Email'
  },
  {
    key: 'website',
    icon: <IconGlobe />,
    type: 'url',
    ariaLabel: 'Sito web'
  }
]

export default function Contacts() {
  const { t } = useTranslation()

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{t('contacts.title')}</h1>
        <p className="page-subtitle">{t('contacts.subtitle')}</p>
      </div>

      <div className="page-body">
        <div className="contact-card" role="region" aria-label={t('contacts.title')}>

          {/* Brand row */}
          <div className="contact-brand-row">
            <div className="contact-logo" aria-hidden="true">
              <img src={iconUrl} alt="" />
            </div>
            <div>
              <p className="contact-company">{t('brand.company')}</p>
              <p className="contact-tagline">{t('contacts.tagline')}</p>
            </div>
          </div>

          {/* Contact list */}
          <address className="contact-list" style={{ fontStyle: 'normal' }}>
            {contactRows.map(row => (
              <div key={row.key} className="contact-row">
                <span
                  className="contact-icon"
                  aria-hidden="true"
                  role="img"
                >
                  {row.icon}
                </span>
                {row.type === 'email' ? (
                  <a
                    href={`mailto:${t(`contacts.${row.key}`)}`}
                    className="contact-info"
                    aria-label={`${row.ariaLabel}: ${t(`contacts.${row.key}`)}`}
                  >
                    {t(`contacts.${row.key}`)}
                  </a>
                ) : row.type === 'url' ? (
                  <a
                    href={`https://${t(`contacts.${row.key}`)}`}
                    className="contact-info"
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`${row.ariaLabel}: ${t(`contacts.${row.key}`)}`}
                  >
                    {t(`contacts.${row.key}`)}
                  </a>
                ) : row.type === 'tel' ? (
                  <a
                    href={`tel:${t(`contacts.${row.key}`).replace(/\s/g, '')}`}
                    className="contact-info"
                    aria-label={`${row.ariaLabel}: ${t(`contacts.${row.key}`)}`}
                  >
                    {t(`contacts.${row.key}`)}
                  </a>
                ) : (
                  <span
                    className="contact-info"
                    aria-label={`${row.ariaLabel}: ${t(`contacts.${row.key}`)}`}
                  >
                    {t(`contacts.${row.key}`)}
                  </span>
                )}
              </div>
            ))}
          </address>

          {/* Fiscal data */}
          <div className="contact-footer">
            <div className="contact-fiscal">
              <span>{t('contacts.vatLabel')}</span>
              <span>{t('contacts.vatNumber')}</span>
            </div>
            <div className="contact-fiscal">
              <span>{t('contacts.cfLabel')}</span>
              <span>{t('contacts.cfNumber')}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
