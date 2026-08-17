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
    <html lang="pt-BR" className={montserrat.variable} suppressHydrationWarning>
      <head>
        {/* Aplica o tema antes da primeira pintura — evita o flash branco. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{
              var t=localStorage.getItem('tema');
              if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';
              document.documentElement.dataset.theme=t;
            }catch(e){}})()`,
          }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
