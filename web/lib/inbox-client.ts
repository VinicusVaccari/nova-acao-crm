import type { ContextoDeal } from './actions'
import type { Conversa, Mensagem } from './mensagens'

type Recursos = {
  conversas: Conversa[]
  mensagens: { mensagens: Mensagem[]; temMais: boolean }
  contexto: ContextoDeal | null
  'nao-lidas': number
}

export async function lerInbox<K extends keyof Recursos>(
  recurso: K, params: Record<string, string> = {}, signal?: AbortSignal,
): Promise<Recursos[K]> {
  const query = new URLSearchParams({ ...params, recurso })
  const limite = AbortSignal.timeout(20_000)
  const response = await fetch(`/api/inbox?${query}`, {
    cache: 'no-store', credentials: 'same-origin',
    signal: signal ? AbortSignal.any([signal, limite]) : limite,
  })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Não foi possível carregar a conversa. Tente novamente.')
  }
  return response.json()
}

// Um pedido por vez por recurso. Trocar de conversa cancela o pedido antigo;
// o próximo tick só é agendado depois de terminar o atual, mesmo em rede lenta.
export function acompanharInbox(
  buscar: (signal: AbortSignal) => Promise<void>, intervalo: number, imediato = true,
): () => void {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout>
  let buscando = false
  const tick = async () => {
    if (controller.signal.aborted || buscando) return
    clearTimeout(timer)
    if (!document.hidden) {
      buscando = true
      try { await buscar(controller.signal) } catch { /* próxima atualização tenta novamente */ }
      finally { buscando = false }
    }
    if (!controller.signal.aborted) timer = setTimeout(tick, intervalo)
  }
  const visivel = () => { if (!document.hidden) void tick() }
  document.addEventListener('visibilitychange', visivel)
  if (imediato) void tick()
  else timer = setTimeout(tick, intervalo)
  return () => {
    controller.abort()
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', visivel)
  }
}
