import type { Metadata } from 'next'
import { Montserrat } from 'next/font/google'
import './globals.css'

// A tipografia da marca. 400/500/600/700/800 cobrem todo o sistema.
const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-montserrat',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Nova Ação · Operação', template: '%s · Nova Ação' },
  description: 'Da geração de demanda ao depoimento do cliente, em um sistema só.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={montserrat.variable}>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
