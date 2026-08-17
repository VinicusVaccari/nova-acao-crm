import { carregarConversas } from '@/lib/mensagens'
import { Inbox } from '@/components/inbox'

export const dynamic = 'force-dynamic'

export default async function Mensagens({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [conversas, sp] = await Promise.all([carregarConversas(), searchParams])

  return (
    // sangra até as bordas: cancela o padding do layout e ocupa toda a área
    <div
      style={{
        margin: 'calc(var(--s-8) * -1) calc(var(--s-6) * -1)',
        height: 'calc(100dvh - var(--topbar-h))',
      }}
    >
      <Inbox conversas={conversas} selInicial={sp.conversa ?? null} />
    </div>
  )
}
