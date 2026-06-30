import type { Metadata } from 'next'
import './globals.css'
import { I18nProvider } from '@/lib/i18n/I18nProvider'

export const metadata: Metadata = {
  title: 'PDF Data Extractor',
  description: 'Estrai dati strutturati da PDF con AI',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body><I18nProvider>{children}</I18nProvider></body>
    </html>
  )
}
