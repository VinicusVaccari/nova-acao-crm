import { redirect } from 'next/navigation'
import { usuarioAtual } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { carregarEstagios } from '@/lib/estagios-server'
import { contarNaoLidas } from '@/lib/mensagens'
import { EstagiosProvider } from '@/components/estagios-context'
import { NavMobile, Sidebar } from '@/components/shell/sidebar'
import { Topbar } from '@/components/shell/topbar'

/* Shell autenticado, estilo RD: a topbar cruza o topo inteiro e o rail
   desce pela esquerda a partir dela — juntos, contínuos, emendados no
   canto escuro do logo. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // autenticação e contador de SLA em paralelo (não dependem um do outro)
  const [usuario, sla, estagios, naoLidas] = await Promise.all([
    usuarioAtual(),
    db.from('v_sla_breaches').select('id', { count: 'exact', head: true }),
    carregarEstagios(),
    contarNaoLidas().catch(() => 0),
  ])
  if (!usuario) redirect('/login')
  const count = sla.count

  return (
    <EstagiosProvider value={estagios}>
      <div className="min-h-screen">
        <Topbar usuario={usuario} />
        <Sidebar alertas={count ?? 0} naoLidas={naoLidas} />

        {/* o fundo do main é o escuro da moldura; o painel claro flutua dentro */}
        <main
          className="com-sidebar"
          style={{ paddingTop: 'var(--topbar-h)', background: 'var(--nav-bg)' }}
        >
          <div className="painel-conteudo">
            {/* largura total: o board da pipeline preenche a tela e rola na
                horizontal, sem o vazio de um teto de largura centralizado */}
            <div className="w-full" style={{ padding: `var(--s-8) var(--s-6)` }}>
              {children}
            </div>
          </div>
        </main>

        <NavMobile naoLidas={naoLidas} />
      </div>
    </EstagiosProvider>
  )
}
