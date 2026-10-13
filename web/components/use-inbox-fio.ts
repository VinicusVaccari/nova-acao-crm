'use client'

import { useEffect, useRef, useState } from 'react'
import { acompanharInbox, lerInbox } from '@/lib/inbox-client'
import type { Mensagem } from '@/lib/mensagens'

type Fio = { mensagens: Mensagem[]; temMais: boolean }

// Preserva o src dos áudios já visíveis para não interromper a reprodução.
export function mesclar(atuais: Mensagem[], novas: Mensagem[]): Mensagem[] {
  const porId = new Map(atuais.map(m => [m.id, m]))
  for (const m of novas) if (!porId.has(m.id)) porId.set(m.id, m)
  return [...porId.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
}

export function useInboxFio(oppId: string | null, revisao: number) {
  // Memória apenas desta tela, por negócio. Não persiste dados entre sessões.
  const [fios, setFios] = useState<Record<string, Fio>>({})
  const [erroInicial, setErroInicial] = useState<{ id: string; texto: string } | null>(null)
  const [historicoDe, setHistoricoDe] = useState<string | null>(null)
  const historico = useRef(new Map<string, AbortController>())

  useEffect(() => {
    if (!oppId) return
    const pedidos = historico.current
    const parar = acompanharInbox(async signal => {
      try {
        const r = await lerInbox('mensagens', { oppId }, signal)
        if (signal.aborted) return
        setErroInicial(null)
        setFios(prev => {
          const anterior = prev[oppId]
          // Se chegaram mais de uma página enquanto a conversa estava fechada,
          // começa pela página atual para não exibir um buraco no histórico.
          const semSobreposicao = r.temMais && anterior?.mensagens.length
            && !r.mensagens.some(m => anterior.mensagens.some(a => a.id === m.id))
          const proximos = { ...prev, [oppId]: {
            mensagens: mesclar(semSobreposicao ? [] : anterior?.mensagens ?? [], r.mensagens),
            temMais: semSobreposicao ? r.temMais : anterior?.temMais ?? r.temMais,
          } }
          const ids = Object.keys(proximos)
          if (ids.length > 20) delete proximos[ids.find(id => id !== oppId)!]
          return proximos
        })
      } catch {
        if (!signal.aborted) setErroInicial({ id: oppId, texto: 'Não foi possível atualizar as mensagens. Tentando novamente…' })
      }
    }, 2000)
    return () => { parar(); pedidos.get(oppId)?.abort(); pedidos.delete(oppId) }
  }, [oppId, revisao])

  const fio = oppId ? fios[oppId] : undefined
  const carregarAnteriores = async () => {
    const antiga = fio?.mensagens[0]
    if (!oppId || !antiga || historico.current.has(oppId)) return
    const controller = new AbortController()
    historico.current.set(oppId, controller)
    setHistoricoDe(oppId)
    try {
      const r = await lerInbox('mensagens', { oppId, antesDe: antiga.at }, controller.signal)
      if (controller.signal.aborted) return
      setFios(prev => ({ ...prev, [oppId]: {
        mensagens: mesclar(prev[oppId]?.mensagens ?? [], r.mensagens), temMais: r.temMais,
      } }))
    } catch {
      if (!controller.signal.aborted) setErroInicial({ id: oppId, texto: 'Não foi possível carregar as mensagens anteriores. Tente novamente.' })
    } finally {
      if (historico.current.get(oppId) === controller) historico.current.delete(oppId)
      setHistoricoDe(atual => atual === oppId ? null : atual)
    }
  }

  const erro = erroInicial?.id === oppId ? erroInicial.texto : null
  return {
    mensagens: fio?.mensagens ?? [], temMais: fio?.temMais ?? false,
    carregando: !!oppId && ((!fio && !erro) || historicoDe === oppId),
    erro, carregarAnteriores,
  }
}
