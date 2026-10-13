type Registro = Record<string, unknown>

function registro(valor: unknown): Registro | null {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor as Registro : null
}

function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' ? valor : undefined
}

/**
 * Espelha o recorte de atividades de fn_sdr_context (mais recentes primeiro,
 * 15, corpo de até 500 caracteres), mas o limita ao negócio do disparo.
 * O SDR continua usando o histórico por pessoa; follow-up não pode herdar
 * conversa de outro negócio do mesmo telefone.
 */
export function atividadesDesteNegocioParaFollowup(opportunityId: string, atividades: unknown[]): Registro[] {
  return atividades
    .flatMap(atividade => {
      const item = registro(atividade)
      if (!item || item.opportunity_id !== opportunityId) return []
      return [{
        ...(texto(item.kind) !== undefined ? { kind: texto(item.kind) } : {}),
        ...(texto(item.direction) !== undefined ? { direction: texto(item.direction) } : {}),
        ...(texto(item.occurred_at) !== undefined ? { at: texto(item.occurred_at) } : {}),
        ...(texto(item.body) !== undefined ? { body: texto(item.body)?.slice(0, 500) } : {}),
      }]
    })
    .sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
    .slice(0, 15)
}

/**
 * O contexto do SDR contém linhas inteiras de people e opportunities. O
 * follow-up recebe uma lista branca, montada do zero, para nunca usar nome,
 * dinheiro ou texto livre cadastrado como se fosse fala do lead.
 */
export function contextoPermitidoParaFollowup(contexto: unknown): Registro {
  const origem = registro(contexto)
  if (!origem) return {}

  const resultado: Registro = {}

  const leadRespondeu = origem.lead_respondeu
  if (typeof leadRespondeu === 'boolean') resultado.lead_respondeu = leadRespondeu

  if (leadRespondeu !== false && Array.isArray(origem.last_activities)) {
    resultado.last_activities = origem.last_activities.flatMap(atividade => {
      const item = registro(atividade)
      if (!item) return []
      return [{
        ...(texto(item.kind) !== undefined ? { kind: texto(item.kind) } : {}),
        ...(texto(item.direction) !== undefined ? { direction: texto(item.direction) } : {}),
        ...(texto(item.at) !== undefined ? { at: texto(item.at) } : {}),
        ...(texto(item.body) !== undefined ? { body: texto(item.body) } : {}),
      }]
    })
  }

  const proximaReuniao = registro(origem.next_meeting)
  if (proximaReuniao) {
    resultado.next_meeting = {
      ...(texto(proximaReuniao.at) !== undefined ? { at: texto(proximaReuniao.at) } : {}),
      ...(texto(proximaReuniao.kind) !== undefined ? { kind: texto(proximaReuniao.kind) } : {}),
      ...(texto(proximaReuniao.status) !== undefined ? { status: texto(proximaReuniao.status) } : {}),
    }
  }

  const origin = registro(origem.origin)
  if (origin) {
    resultado.origin = {
      ...(texto(origin.channel) !== undefined ? { channel: texto(origin.channel) } : {}),
      ...(texto(origin.campaign) !== undefined ? { campaign: texto(origin.campaign) } : {}),
    }
  }

  const opportunity = registro(origem.opportunity)
  if (opportunity) {
    const qualificacao = opportunity.qualificacao
    resultado.opportunity = {
      ...(texto(opportunity.stage) !== undefined ? { stage: texto(opportunity.stage) } : {}),
      ...(texto(opportunity.product) !== undefined ? { product: texto(opportunity.product) } : {}),
      ...(typeof qualificacao === 'number' && Number.isFinite(qualificacao) ? { qualificacao } : {}),
    }
  }

  return resultado
}
