import type { Metadata } from 'next'
import './globals.css'
import Providers from '@/components/Providers'
import TitleBar from '@/components/TitleBar'

export const metadata: Metadata = {
  title: 'PDF Data Extractor',
  description: 'Estrai dati strutturati da PDF con AI',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>
        <Providers>
          <TitleBar />
          {children}
        </Providers>
      </body>
    </html>
  )
}
