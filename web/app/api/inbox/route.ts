import { NextResponse } from 'next/server'
import { contextoDeal, listarConversas, listarMensagens, totalNaoLidas } from '@/lib/actions'

export const dynamic = 'force-dynamic'

// Leituras independentes da fila de Server Actions. As funções abaixo mantêm
// a validação de sessão, acesso ao negócio e RLS já usada pelo inbox.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const recurso = params.get('recurso')
  const oppId = params.get('oppId') ?? ''
  const json = (data: unknown, status = 200) => NextResponse.json(data, {
    status, headers: { 'Cache-Control': 'private, no-store' },
  })
  if (!['conversas', 'mensagens', 'contexto', 'nao-lidas'].includes(recurso ?? '')) {
    return json({ erro: 'Consulta inválida.' }, 400)
  }
  if ((recurso === 'mensagens' || recurso === 'contexto') && !/^[0-9a-f-]{36}$/i.test(oppId)) {
    return json({ erro: 'Negócio inválido.' }, 400)
  }
  try {
    switch (recurso) {
      case 'conversas': return json(await listarConversas())
      case 'mensagens': return json(await listarMensagens(oppId, params.get('antesDe') ?? undefined))
      case 'contexto': return json(await contextoDeal(oppId))
      case 'nao-lidas': return json(await totalNaoLidas())
    }
  } catch (e) {
    const negado = e instanceof Error && /Sessão inválida|sem permissão|Sem permissão/.test(e.message)
    return json({ erro: 'Não foi possível carregar os dados da conversa.' }, negado ? 403 : 503)
  }
}
