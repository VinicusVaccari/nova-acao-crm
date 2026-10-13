import { integrationAuthorizedHeaderOnly, readBoundedJson, integrationRateLimit } from '@/lib/security/integration'
import { NextResponse, after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { enviarComoNaia, ocultarSegredosZapi } from '@/lib/whatsapp'
import { gerarMensagemFollowup } from '@/lib/agentes/followup/gerar'
import { atividadesDesteNegocioParaFollowup, contextoPermitidoParaFollowup } from '@/lib/agentes/followup/contexto'
import { deveBloquearNomeNaoDitoPeloLead, MOTIVO_NOME_NAO_DITO_PELO_LEAD } from '@/lib/agentes/followup/guardrail-nome'
import { ATIVO as PROMPT_VERSAO } from '@/lib/agentes/followup/prompt'
import { chaveTextoBaseFollowup } from '@/lib/followup-rodadas'
import { varianteTextoFollowup } from '@/lib/agentes/followup/variantes'
import { detalharErroSupabase as detalharErro, detalharExcecao, fetchFalhouAntesDeConectar, comRetentativa, mesmoInstante, carimboUnico } from '@/lib/erros'

/* -----------------------------------------------------------------
   Chamado pelo relógio do banco (fn_followup_varrer, pg_cron) via
   pg_net — nunca pelo navegador. Segredo só em header; ausente = 503
   (nunca 401, para não confundir "não configurado" com "credencial
   errada"). A reserva em followup_disparos NÃO é "tocado": só vira
   'enviado' depois do ok da Z-API, e SÓ por enviarComoNaia (o mesmo
   caminho que /api/whatsapp/reply usa) — NUNCA responderConversa nem
   fn_intervencao. Envio humano grava intervenção → trava → o dono passa
   ao Rodrigues → a Naia é calada naquele lead para sempre; em massa,
   seria o pior estrago possível deste sistema.

   POST /api/followup/executar
   body: { disparo_id: uuid } | { acao: 'desfecho', opportunity_id: uuid }

   RESPOSTA RÁPIDA (achado de incidente, 13/09/2026): esta rota fazia
   TUDO — reivindicar, reconferir, chamar a OpenAI (até ~24s, ver
   gerar.ts), registrar gasto e enviar — antes de responder. pg_net
   desiste depois de net.http_post's timeout_milliseconds (5000ms por
   padrão, e fn_followup_varrer não passava valor nenhum): TODO disparo
   real estourava esse prazo do lado do banco, mesmo quando a Vercel
   completava a chamada com sucesso minutos depois. Pior: pelo menos
   uma chamada travou de vez (sem exceção registrada, sem escrita no
   disparo) e só foi resgatada pelo lease vencendo. Por isso: reivindica
   ATOMICAMENTE e responde JÁ; o resto (reconferência, geração, gasto,
   envio) roda depois da resposta via after() — a conexão do pg_net não
   precisa mais ficar aberta por um segundo sequer além da reivindicação.
   maxDuration=120 (achado da Sentinela: 60 ficava colado no pior caso —
   até ~24s de OpenAI em gerar.ts + até ~20s de Z-API em enviarWhatsapp +
   várias idas ao banco, ~1-1.4s cada por latência medida em produção;
   se a Vercel encerrar a função à força por estourar o prazo, nenhum
   catch roda — aí só a marca de envio, lida pela varredura, decide o
   destino; ver "A MARCA ANTES DA Z-API" abaixo). Toda falha do
   trabalho em segundo plano tem que virar erro escrito no disparo, ou no
   mínimo um console.error — depois da resposta não existe mais chamador
   HTTP escutando um 503 para avisar ninguém (silêncio é pior que erro).

   ACHADOS do teste real do coordenador, 13/09/2026 (negócio
   f1b6bc43-3bec-4162-8cf4-c5346d5c2279, toque 2):

   1) ERRO ENGOLIDO — cada ponto de falha gravava só uma frase fixa, sem
      o code/message de verdade do Postgres/OpenAI/Z-API. A causa do toque
      2 só apareceu em edge_logs: PostgREST devolveu 504 pra
      fn_followup_pode_disparar às 04:13:00.794 UTC, ~0.8s depois de dois
      pg_cron (fn_followup_varrer e fn_outreach_disparar) terminarem no
      mesmo segundo — contenção passageira, sem erro em postgres_logs.
      Correção: toda falha grava em `erro` o motivo real (detalharErro,
      detalharExcecao, corpo da OpenAI/Z-API) e também console.error.

   2) INDETERMINADO INDEVIDO — aquele 504 foi ANTES de qualquer chamada à
      Z-API, mas a linha ficou 'enviando' e a varredura a virou
      'indeterminado', que trava a cadência do negócio até alguém olhar.

   A MARCA ANTES DA Z-API (decisão do coordenador, 13/09/2026, depois do
   BLOQUEADOR da Sentinela): "pode ter saído" NÃO é mais decidido por uma
   gravação final do app — se a indisponibilidade que derrubou o passo
   também derrubasse a gravação de volta pra 'reservado', a linha decaía
   pra 'indeterminado' do mesmo jeito. Agora:
     - a reivindicação grava reivindicado_em e ZERA zapi_iniciado_em;
     - imediatamente antes de chamar a Z-API, o app grava
       zapi_iniciado_em (compare-and-set: ainda 'enviando', mesmo ciclo,
       sem marca, reserva viva) e SÓ chama a Z-API se essa gravação
       voltar com a linha;
     - quando o lease de uma linha 'enviando' vence, fn_followup_varrer
       (0060) decide sozinha: reivindicada e SEM marca → nada saiu, volta
       a ser retentável (tentativas+1, respeitando max_tentativas_envio);
       COM marca, ou reivindicada por executor anterior à 0060 (sem
       reivindicado_em) → pode ter saído, 'indeterminado'.
   As gravações do app (marcarFalhaRetentavel etc.) só ADIANTAM o destino
   e deixam o motivo escrito; se falharem, o destino é o mesmo, decidido
   pela marca. As escritas de estado do trabalho em segundo plano são
   presas ao próprio ciclo (status 'enviando' + o mesmo `tentativas` da
   reivindicação — todo fim de ciclo que volta à fila soma 1), pra um
   executor atrasado nunca escrever no ciclo seguinte da mesma linha.

   RETENTATIVA CURTA (achado do teste real do coordenador, 14/09/2026):
   o Postgres respondia perfeito (pg_cron a cada minuto em 50-140ms, sem
   erro, sem lock), mas o GATEWAY REST do Supabase devolvia 504 isolados
   em menos de 1,5s — sete vezes em 45 min, inclusive fora do follow-up
   (GET /profiles). Sem retentativa, o executor desistia do ciclo inteiro
   na PRIMEIRA falha dessas — a PATCH da reivindicação, especificamente,
   504 duas vezes no teste — e só voltava quando o lease vencia: até 17
   min de atraso (toque 3), 11 min (toque 2). Toda chamada ao Supabase
   ANTES da marca passa por comRetentativa (web/lib/erros.ts): poucas
   tentativas com espera crescente em segundos, teto bem abaixo de
   maxDuration=120s. EXCEÇÃO deliberada: fn_followup_registrar_gasto NÃO
   é retentada — ela INSERE uma linha em followup_gastos a cada chamada
   (não é idempotente); se a escrita aplicasse e só a confirmação se
   perdesse, retentar contaria o gasto em dobro. Sem migration prevista
   nesta tarefa pra torná-la idempotente, o mais seguro é uma única
   tentativa (como já era) — o pior caso é a MESMA retentativa de sempre
   do disparo inteiro (marcarFalhaRetentavel), não pior que antes.

   A reivindicação (processarDisparo) e a marca de envio (abaixo) merecem
   cuidado A MAIS que os outros pontos: são escritas por compare-and-set,
   e um 504 do gateway pode chegar DEPOIS de a escrita já ter aplicado no
   Postgres — a confirmação some, mas o efeito ficou. Uma retentativa
   simples, sem mais nada, RETENTARIA A LEITURA ("nenhuma linha casou",
   sem erro) e trataria isso como "outro processo já pegou" — exatamente
   como se fosse uma reentrega genuína do pg_net — e abandonaria o
   disparo (ninguém chama o resto do trabalho) até o lease vencer sozinho:
   o MESMO atraso que estamos consertando, só que silencioso. Por isso as
   duas gravam um valor ÚNICO desta chamada (reivindicado_em / o instante
   da marca) ANTES de tentar, e usam `retentou` (comRetentativa) pra saber
   se vale reconferir: só quando ESTA MESMA invocação sofreu uma falha
   transitória antes é que "nenhuma linha" pode significar "a minha
   escrita anterior aplicou" — nesse caso, reconfere por igualdade EXATA
   do valor gravado (nenhum outro processo escreveria byte a byte o mesmo
   timestamp) e ADOTA a linha, seguindo o processamento normalmente. Uma
   reentrega genuína do pg_net (que nunca sofreu falha transitória NESTA
   invocação) continua caindo no comportamento de sempre: 409, sem tocar
   em nada — quem reivindicou de verdade já tem o after() dele rodando.
   ----------------------------------------------------------------- */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function processarDesfecho(opportunityId: unknown) {
  if (typeof opportunityId !== 'string' || !opportunityId) {
    return NextResponse.json({ ok: false, erro: 'opportunity_id ausente' }, { status: 400 })
  }
  // Reconferir e gravar numa operação SÓ, dentro do banco. Eram duas
  // chamadas (fn_followup_pode_perder, depois registrarPerdaAutorizada): um
  // lead que respondesse entre as duas era arquivado como perdido logo
  // depois de voltar (achado CRÍTICO da revisão). fn_followup_registrar_perda
  // trava a linha do negócio com o mesmo lock que fn_log_activity usa pra
  // gravar mensagem, reconfere com o lock na mão e só então grava
  // lost_at + stage_history mantendo a etapa — o mesmo que
  // registrarPerdaAutorizada grava.
  const { data: resultado, error } = await db.rpc('fn_followup_registrar_perda', { p_opportunity_id: opportunityId })
  if (error) {
    const mensagem = `falha ao registrar o desfecho: ${detalharErro(error)}`
    console.error(`followup: desfecho do negócio ${opportunityId} falhou —`, mensagem)
    return NextResponse.json({ ok: false, erro: mensagem }, { status: 503 })
  }
  if (resultado === 'nao_elegivel') return NextResponse.json({ ok: true, cancelado: true })
  if (resultado === 'nao_encontrado') return NextResponse.json({ ok: false, erro: 'negócio não encontrado' }, { status: 404 })
  if (resultado !== 'perdido') {
    return NextResponse.json({ ok: false, erro: 'resposta inesperada ao registrar o desfecho' }, { status: 500 })
  }

  revalidatePath('/')
  revalidatePath('/pipeline')
  revalidatePath('/comercial')
  revalidatePath(`/lead/${opportunityId}`)
  return NextResponse.json({ ok: true, opportunityId, status: 'perdido', motivo: 'sumiu' })
}

// Falha em que a mensagem PODE ter saído (a marca zapi_iniciado_em já
// está gravada). Só grava o motivo — o status fica 'enviando' COM marca e
// fn_followup_varrer o vira 'indeterminado' quando o lease vencer (um
// escritor só pra essa verdade; nunca reenviado sozinho). Se ATÉ esta
// escrita falhar, o destino não muda (a marca decide) e o console.error
// é o registro que sobra nos logs da Vercel.
async function marcarFalhaPodeTerSaido(disparoId: string, tentativasAtuais: number, mensagem: string) {
  console.error(`followup: disparo ${disparoId} pode ter saído (falha depois da marca de envio) — vira indeterminado quando a reserva vencer —`, mensagem)
  const { data, error } = await db.from('followup_disparos')
    .update({ erro: mensagem, erro_em: new Date().toISOString() })
    .eq('id', disparoId).eq('status', 'enviando').eq('tentativas', tentativasAtuais)
    .select('id').maybeSingle()
  if (error) console.error(`followup: falha ao gravar o motivo do disparo ${disparoId} (o destino não muda: a marca de envio decide):`, detalharErro(error))
  else if (!data) console.error(`followup: disparo ${disparoId} já saiu deste ciclo (status ou tentativas mudaram) — motivo não gravado:`, mensagem)
}

// Falha em que a mensagem COM CERTEZA não saiu. Adianta o destino: volta a
// 'reservado' com o lease vencido (a varredura resgata a MESMA linha no
// minuto seguinte) ou, esgotado max_tentativas_envio, 'falhou' — nunca
// 'indeterminado'. Se a gravação falhar, nada se perde: sem marca, a
// varredura faz a mesma conta quando o lease vencer; com marca (recusa
// explícita da Z-API depois de marcar), vira 'indeterminado' — o lado
// conservador.
// maxTentativas null = a configuração não foi lida. Aí NÃO decide nada
// (achado MÉDIO da Sentinela: o antigo "|| 3" inventava um teto e podia
// autorizar tentativa a mais do que o coordenador configurou): grava só o
// motivo e deixa a linha 'enviando' sem marca, pra fn_followup_varrer
// decidir com o max_tentativas_envio real, lido dentro do banco.
async function marcarFalhaRetentavel(disparoId: string, tentativasAtuais: number, maxTentativas: number | null, mensagem: string) {
  const agora = new Date().toISOString()
  if (maxTentativas == null) {
    console.error(`followup: disparo ${disparoId} falhou antes do envio, sem configuração pra decidir o destino — a varredura decide quando a reserva vencer —`, mensagem)
    const { data, error } = await db.from('followup_disparos')
      .update({ erro: mensagem, erro_em: agora })
      .eq('id', disparoId).eq('status', 'enviando').eq('tentativas', tentativasAtuais)
      .select('id').maybeSingle()
    if (error) console.error(`followup: falha ao gravar o motivo do disparo ${disparoId} (o destino não muda: a varredura decide pela marca):`, detalharErro(error))
    else if (!data) console.error(`followup: disparo ${disparoId} já saiu deste ciclo (status ou tentativas mudaram) — motivo não gravado:`, mensagem)
    return
  }
  const tentativas = tentativasAtuais + 1
  const statusFinal = tentativas < maxTentativas ? 'reservado' : 'falhou'
  console.error(`followup: disparo ${disparoId} não saiu (${statusFinal}, tentativa ${tentativas}/${maxTentativas}) —`, mensagem)
  const { data, error } = await db.from('followup_disparos')
    .update({
      status: statusFinal,
      tentativas,
      // um segundo no passado: a próxima varredura já pode resgatar
      lease_ate: new Date(Date.now() - 1000).toISOString(),
      erro: mensagem,
      erro_em: agora,
    })
    .eq('id', disparoId).eq('status', 'enviando').eq('tentativas', tentativasAtuais)
    .select('id').maybeSingle()
  if (error) console.error(`followup: falha ao devolver o disparo ${disparoId} à fila (o destino não muda: a varredura decide pela marca quando a reserva vencer):`, detalharErro(error))
  else if (!data) console.error(`followup: disparo ${disparoId} já saiu deste ciclo (status ou tentativas mudaram) — nada gravado:`, mensagem)
}

// Cancelamentos também gravam o próprio destino — se essa gravação falhar,
// cai no mesmo último recurso: console.error (achado da Sentinela).
function avisarSeFalhou(disparoId: string, contexto: string, error: { code?: string | null; message: string; details?: string | null; hint?: string | null } | null) {
  if (error) console.error(`followup: falha ao gravar ${contexto} do disparo ${disparoId}:`, detalharErro(error))
}

// Todo o trabalho que pode demorar (rechecagem, OpenAI, gasto, envio) —
// roda DEPOIS da resposta (after()), pra a conexão do pg_net não precisar
// ficar aberta esperando. `disparo` já veio da reivindicação atômica
// (status 'enviando' garantido no instante em que isto começa a rodar).
async function processarDisparoEmSegundoPlano(disparo: Record<string, unknown>) {
  const disparoId = disparo.id as string
  // O ciclo desta execução: toda escrita de estado abaixo (menos a de
  // 'enviado') exige status 'enviando' E este mesmo número de tentativas.
  const tentativasAtuais = disparo.tentativas as number
  // null até a configuração ser lida — e continua null se a leitura falhar.
  let maxTentativas: number | null = null
  // true SÓ depois de a marca zapi_iniciado_em estar gravada: daí em diante
  // uma falha ambígua é "pode ter saído".
  let zApiChamada = false
  // Motivos que não podem sumir atrás do resultado final (2ª rodada da
  // Sentinela): toda escrita de erro deste disparo passa por combinarErro,
  // inclusive a do catch final.
  let notaContexto: string | null = null
  let erroGeracao: string | null = null
  const combinarErro = (...partes: (string | null)[]) => [notaContexto, erroGeracao, ...partes].filter(Boolean).join('; ')
  try {
    // Config PRIMEIRO: é dela que sai max_tentativas_envio, e toda falha
    // daqui pra frente precisa dele pra decidir 'reservado' ou 'falhou'.
    const { data: config, error: configErro } = await comRetentativa(
      () => db.from('followup_config').select('modo, modelo, max_tentativas_envio, preco_entrada_1m_usd, preco_saida_1m_usd').eq('id', 1).maybeSingle(),
      { contexto: `followup: disparo ${disparoId} — consultar a configuração` },
    )
    if (configErro || !config) {
      return marcarFalhaRetentavel(disparoId, tentativasAtuais, null, `falha ao consultar a configuração: ${configErro ? detalharErro(configErro) : 'followup_config id=1 não encontrada'}`)
    }
    const maxLido = Number(config.max_tentativas_envio)
    if (!Number.isInteger(maxLido) || maxLido < 1) {
      return marcarFalhaRetentavel(disparoId, tentativasAtuais, null, `configuração com max_tentativas_envio inválido (${String(config.max_tentativas_envio)})`)
    }
    maxTentativas = maxLido
    const modo = (config.modo as string) || 'sombra'
    const modelo = (config.modelo as string) || 'gpt-5.6-terra'

    // RECONFERE a elegibilidade AGORA — a trava é conferida no instante do
    // disparo, não no agendamento. Entre reservar e chegar aqui, o
    // Rodrigues pode ter clicado em Assumir. Falha aqui é retentável:
    // nada foi enviado (exatamente o 504 do toque 2 do teste).
    const { data: pode, error: podeErro } = await comRetentativa(
      () => db.rpc('fn_followup_pode_disparar', { p_opportunity_id: disparo.opportunity_id, p_toque: disparo.toque }),
      { contexto: `followup: disparo ${disparoId} — reconferir elegibilidade` },
    )
    if (podeErro) return marcarFalhaRetentavel(disparoId, tentativasAtuais, maxTentativas, `falha ao reconferir elegibilidade: ${detalharErro(podeErro)}`)
    if (!pode) {
      const { error } = await db.from('followup_disparos')
      .update({ status: 'cancelado', motivo: 'reprovado na reconferência (trava, etapa ou resposta do lead mudaram)' })
        .eq('id', disparoId).eq('status', 'enviando').eq('tentativas', tentativasAtuais)
      avisarSeFalhou(disparoId, 'cancelamento (reconferência)', error)
      return
    }

    const { data: inbound, error: inboundErro } = await comRetentativa(
      () => db.from('activities').select('id').eq('opportunity_id', disparo.opportunity_id)
        .eq('direction', 'inbound').limit(1).maybeSingle(),
      { contexto: `followup: disparo ${disparoId} — verificar resposta do lead` },
    )
    if (inboundErro) return marcarFalhaRetentavel(disparoId, tentativasAtuais, maxTentativas, `falha ao verificar resposta do lead: ${detalharErro(inboundErro)}`)
    const leadRespondeu = !!inbound

    // `disparo.toque` é global (1..6), enquanto `followup_textos.toque` é
    // 1..3 DENTRO de cada lote. Consultar pelo global faria o toque 4 ficar
    // sem texto base; use exclusivamente as colunas geradas da 0062.
    const chaveTexto = chaveTextoBaseFollowup(Number(disparo.lote), Number(disparo.toque_no_lote))
    const variante = varianteTextoFollowup(chaveTexto.lote, leadRespondeu)
    const { data: textoBase, error: textoErro } = await comRetentativa(
      () => db.from('followup_textos').select('id, texto')
        .eq('lote', chaveTexto.lote).eq('toque', chaveTexto.toque).eq('variante', variante)
        .order('id', { ascending: false }).limit(1).maybeSingle(),
      { contexto: `followup: disparo ${disparoId} — consultar o texto base` },
    )
    if (textoErro) return marcarFalhaRetentavel(disparoId, tentativasAtuais, maxTentativas, `falha ao consultar o texto base: ${detalharErro(textoErro)}`)
    if (!textoBase) {
      const { error } = await db.from('followup_disparos').update({ status: 'cancelado', motivo: 'sem_texto_base' })
        .eq('id', disparoId).eq('status', 'enviando').eq('tentativas', tentativasAtuais)
      avisarSeFalhou(disparoId, 'cancelamento (sem_texto_base)', error)
      return
    }

    // Contexto é insumo de PERSONALIZAÇÃO, não gate de envio — adiar o
    // toque por causa do carregamento do contexto perde a hora certa. Mas
    // a falha não pode ficar muda (achado da Sentinela): console.error
    // agora e nota em toda escrita de erro deste disparo.
    const { data: contexto, error: contextoErro } = await comRetentativa(
      () => db.rpc('fn_sdr_context', { p_phone: disparo.telefone }),
      { contexto: `followup: disparo ${disparoId} — carregar contexto` },
    )
    if (contextoErro) {
      notaContexto = `contexto da conversa indisponível (fn_sdr_context: ${detalharErro(contextoErro)})`
      console.error(`followup: disparo ${disparoId} —`, notaContexto)
    }

    // fn_sdr_context é propositalmente por pessoa para a Naia. No follow-up,
    // porém, uma pessoa pode voltar como novo negócio: só a conversa DESTE
    // opportunity_id pode virar personalização ou liberar nome no guardrail.
    const { data: atividades, error: atividadesErro } = await comRetentativa(
      () => db.from('activities').select('opportunity_id, kind, direction, occurred_at, body')
        .eq('opportunity_id', disparo.opportunity_id).order('occurred_at', { ascending: false }).limit(15),
      { contexto: `followup: disparo ${disparoId} — carregar atividades deste negócio` },
    )
    if (atividadesErro) {
      const motivo = `atividades deste negócio indisponíveis: ${detalharErro(atividadesErro)}`
      notaContexto = [notaContexto, motivo].filter(Boolean).join('; ')
      console.error(`followup: disparo ${disparoId} —`, motivo)
    }
    const contextoDesteNegocio = {
      ...(contexto && typeof contexto === 'object' && !Array.isArray(contexto) ? contexto : {}),
      lead_respondeu: leadRespondeu,
      // Em erro, vazio é seguro; nunca usar o last_activities por pessoa.
      last_activities: leadRespondeu
        ? atividadesDesteNegocioParaFollowup(String(disparo.opportunity_id), atividades ?? [])
        : [],
    }
    const contextoPermitido = contextoPermitidoParaFollowup(contextoDesteNegocio)
    const geracaoBruta = await gerarMensagemFollowup({ textoBase: textoBase.texto as string, contexto: contextoPermitido, modelo, leadRespondeu })
    const geracao = deveBloquearNomeNaoDitoPeloLead({ mensagem: geracaoBruta.mensagem, contexto: contextoDesteNegocio })
      ? {
          ...geracaoBruta,
          mensagem: textoBase.texto as string,
          personalizou: false,
          usouContexto: false,
          referencia: '',
          erro: MOTIVO_NOME_NAO_DITO_PELO_LEAD,
        }
      : geracaoBruta
    erroGeracao = geracao.erro

    const precoEntrada = config.preco_entrada_1m_usd as number | null
    const precoSaida = config.preco_saida_1m_usd as number | null
    const custoTentativa = (precoEntrada != null && precoSaida != null && geracao.tokensEntrada != null && geracao.tokensSaida != null)
      ? (geracao.tokensEntrada / 1_000_000) * precoEntrada + (geracao.tokensSaida / 1_000_000) * precoSaida
      : null

    // O gasto DESTA chamada à OpenAI entra em followup_gastos com o instante
    // em que aconteceu, e soma no acumulado do disparo na mesma transação.
    // O teto de custo do dia soma por esse instante (achado MÉDIO da
    // revisão). Sem tokens (sem chave, timeout, erro HTTP) não houve gasto
    // medido e não há o que registrar.
    // SEM comRetentativa DE PROPÓSITO (achado do teste real, 14/09/2026):
    // esta função INSERE uma linha em followup_gastos a cada chamada —
    // não é idempotente. Se a escrita aplicasse no Postgres e só a
    // confirmação se perdesse no gateway, retentar contaria o gasto em
    // dobro. Sem migration prevista nesta tarefa pra torná-la idempotente
    // (uma chave de dedup, por exemplo), uma tentativa só é o mais
    // seguro — na falha, cai no mesmo marcarFalhaRetentavel de sempre.
    if (geracao.tokensEntrada != null || geracao.tokensSaida != null) {
      const { error: gastoErro } = await db.rpc('fn_followup_registrar_gasto', {
        p_disparo_id: disparoId,
        p_modelo: modelo,
        p_tokens_entrada: geracao.tokensEntrada,
        p_tokens_saida: geracao.tokensSaida,
        p_custo_usd: custoTentativa,
      })
      // Nada foi enviado ainda — retentável. A função é atômica: se deu
      // erro, nada foi gravado e a retentativa registra o gasto dela.
      if (gastoErro) return marcarFalhaRetentavel(disparoId, tentativasAtuais, maxTentativas, combinarErro(`falha ao registrar o gasto da OpenAI: ${detalharErro(gastoErro)}`))
    }

    const erroComum = combinarErro() || null
    const camposComuns = {
      texto_base_id: textoBase.id,
      prompt_versao: PROMPT_VERSAO,
      modelo,
      personalizou: geracao.personalizou,
      usou_contexto: geracao.usouContexto,
      referencia: geracao.referencia,
      texto_gerado: geracao.mensagem,
      erro: erroComum,
      erro_em: erroComum ? new Date().toISOString() : null,
    }

    if (modo !== 'autonomo') {
      // Sombra: grava e PARA. Não envia, não loga activity, não mexe no negócio.
      const { error: gravaErro } = await comRetentativa(
        () => db.from('followup_disparos').update({ ...camposComuns, status: 'sombra' })
          .eq('id', disparoId).eq('status', 'enviando').eq('tentativas', tentativasAtuais),
        { contexto: `followup: disparo ${disparoId} — gravar sombra` },
      )
      if (gravaErro) return marcarFalhaRetentavel(disparoId, tentativasAtuais, maxTentativas, combinarErro(`falha ao gravar o disparo (sombra): ${detalharErro(gravaErro)}`))
      return
    }

    // Grava o que foi gerado JÁ — antes da segunda reconferência, pra não
    // deixar gravação de conteúdo entre o check final e o envio (achado de
    // revisão). Entre os dois só fica a marca, que é o próprio portão.
    // Retentável à toa: esta escrita não muda `status` nem `tentativas`, só
    // conteúdo — reaplicar os mesmos valores numa retentativa é inofensivo.
    const { error: gravaGeradoErro } = await comRetentativa(
      () => db.from('followup_disparos').update(camposComuns)
        .eq('id', disparoId).eq('status', 'enviando').eq('tentativas', tentativasAtuais),
      { contexto: `followup: disparo ${disparoId} — gravar o gerado` },
    )
    if (gravaGeradoErro) return marcarFalhaRetentavel(disparoId, tentativasAtuais, maxTentativas, combinarErro(`falha ao gravar o disparo gerado: ${detalharErro(gravaGeradoErro)}`))

    // SEGUNDA reconferência — a primeira foi antes de chamar a OpenAI, que
    // pode levar até ~24s; o lead pode ter respondido ou o Rodrigues
    // assumido nesse meio-tempo.
    const { data: podeAinda, error: podeAindaErro } = await comRetentativa(
      () => db.rpc('fn_followup_pode_disparar', { p_opportunity_id: disparo.opportunity_id, p_toque: disparo.toque }),
      { contexto: `followup: disparo ${disparoId} — reconferir elegibilidade antes do envio` },
    )
    if (podeAindaErro) return marcarFalhaRetentavel(disparoId, tentativasAtuais, maxTentativas, combinarErro(`falha ao reconferir elegibilidade antes do envio: ${detalharErro(podeAindaErro)}`))
    if (!podeAinda) {
      const { error } = await db.from('followup_disparos')
      .update({ status: 'cancelado', motivo: 'reprovado na reconferência final, antes do envio (trava ou resposta do lead durante a geração)' })
        .eq('id', disparoId).eq('status', 'enviando').eq('tentativas', tentativasAtuais)
      avisarSeFalhou(disparoId, 'cancelamento (reconferência final)', error)
      return
    }

    // A MARCA — "vou chamar a Z-API agora". Compare-and-set: só grava se a
    // linha ainda for deste ciclo, sem marca e com a reserva viva. Sem a
    // linha de volta (erro OU nenhuma linha), a Z-API NÃO é chamada — e,
    // sem marca, a varredura sabe que nada saiu. Se a varredura converter
    // a linha no mesmo instante, o lock de linha serializa as duas: ou a
    // marca entra antes (a varredura reavalia a linha, vê a marca →
    // indeterminado) ou a varredura entra antes (a marca não acha mais
    // 'enviando' → a Z-API não é chamada).
    //
    // comRetentativa cobre o 504 do gateway ANTES de a escrita aplicar.
    // O caso mais delicado é o 504 DEPOIS: a escrita aplica no Postgres,
    // a confirmação some, e uma retentativa simples encontraria "nenhuma
    // linha" (sem erro) — indistinguível, à primeira vista, de "a reserva
    // venceu" ou "a varredura converteu no meio". Por isso, só quando
    // `retentou` (alguma tentativa anterior desta MESMA chamada falhou
    // transitoriamente) é que reconferimos filtrando `zapi_iniciado_em`
    // por IGUALDADE a `agoraMarca` DENTRO do banco (`.eq`, não `===` no
    // JS) — o Postgres compara o INSTANTE do timestamptz, não o texto que
    // volta serializado (achado da Sentinela, 14/09/2026: o PostgREST
    // devolve timestamptz num formato diferente do que o app escreveu —
    // ver mesmoInstante em web/lib/erros.ts, usado onde a comparação
    // acontece no JS, na reivindicação, mais abaixo). Achando a linha,
    // ADOTAMOS: a marca já está lá, é seguro prosseguir pro envio. Sem
    // isso, o disparo ficaria com a marca gravada e NINGUÉM chamando a
    // Z-API, preso até o lease vencer e a 0060 decidir sozinha (o mesmo
    // atraso que estamos consertando, só que silencioso).
    // carimboUnico() pela mesma razão da reivindicação: reduz a chance de
    // duas invocações concorrentes colidirem no mesmo milissegundo e uma
    // "adotar" a marca da outra (achado MÉDIO da Sentinela).
    const agoraMarca = carimboUnico()
    const resultadoMarca = await comRetentativa(
      () => db.from('followup_disparos')
        .update({ zapi_iniciado_em: agoraMarca })
        .eq('id', disparoId).eq('status', 'enviando').eq('tentativas', tentativasAtuais)
        .is('zapi_iniciado_em', null).gt('lease_ate', agoraMarca)
        .select('id').maybeSingle(),
      { contexto: `followup: disparo ${disparoId} — gravar a marca de envio` },
    )
    if (resultadoMarca.error) return marcarFalhaRetentavel(disparoId, tentativasAtuais, maxTentativas, combinarErro(`falha ao gravar a marca de envio — a Z-API NÃO foi chamada: ${detalharErro(resultadoMarca.error)}`))
    let marcado = resultadoMarca.data
    if (!marcado && resultadoMarca.retentou) {
      const verificacao = await comRetentativa(
        () => db.from('followup_disparos').select('id').eq('id', disparoId).eq('zapi_iniciado_em', agoraMarca).maybeSingle(),
        { contexto: `followup: disparo ${disparoId} — reconferir a marca de envio depois de resposta perdida` },
      )
      if (verificacao.data) {
        console.error(`followup: disparo ${disparoId} — marca de envio recuperada após resposta perdida no gateway (a escrita já tinha aplicado); prosseguindo pro envio`)
        marcado = verificacao.data
      }
    }
    if (!marcado) return marcarFalhaRetentavel(disparoId, tentativasAtuais, maxTentativas, combinarErro('marca de envio não gravada (reserva vencida, ou a linha saiu deste ciclo) — a Z-API NÃO foi chamada'))
    zApiChamada = true

    // ÚNICO caminho de envio: o mesmo que /api/whatsapp/reply usa. Nunca
    // responderConversa, nunca fn_intervencao, nunca is_automated=false.
    let resultado: Awaited<ReturnType<typeof enviarComoNaia>>
    try {
      resultado = await enviarComoNaia({
        telefone: disparo.telefone as string, mensagem: geracao.mensagem, opportunityId: disparo.opportunity_id as string,
      })
    } catch (e) {
      // Exceção do fetch: só é "não saiu" quando a conexão comprovadamente
      // nunca existiu (fetchFalhouAntesDeConectar); qualquer outra é
      // "pode ter saído" — na dúvida, nunca reenviar sozinho.
      const detalhe = ocultarSegredosZapi(detalharExcecao(e))
      if (fetchFalhouAntesDeConectar(e)) {
        return marcarFalhaRetentavel(disparoId, tentativasAtuais, maxTentativas, combinarErro(`Z-API inalcançável, a conexão nunca existiu — nada foi enviado: ${detalhe}`))
      }
      return marcarFalhaPodeTerSaido(disparoId, tentativasAtuais, combinarErro(`falha ambígua na chamada à Z-API — a mensagem PODE ter saído: ${detalhe}`))
    }

    if (resultado.ok) {
      // A mensagem SAIU — nunca deixa de marcar 'enviado' por causa de uma
      // falha de log (não dá pra desfazer um envio); só anota o problema.
      // O relógio do próximo toque ancora neste enviado_em
      // (fn_followup_elegiveis), não na atividade. Sem filtro de ciclo de
      // propósito: o que saiu de verdade vence qualquer outro estado.
      const erroEnvio = combinarErro(resultado.logErro ? `enviado, mas falha ao registrar atividade: ${resultado.logErro}` : null) || null
      // Escrita incondicional (só por id) com valores CONGELADOS antes do
      // loop — retentar em falha transitória é seguro (reaplica os
      // mesmos valores) e não fere a regra de ouro: não é a Z-API sendo
      // chamada de novo, só a confirmação de um envio que já aconteceu.
      // Reduz falso 'indeterminado' por causa do mesmo 504 do gateway.
      const enviadoEm = new Date().toISOString()
      const { error: okErro } = await comRetentativa(
        () => db.from('followup_disparos').update({
          status: 'enviado',
          enviado_em: enviadoEm,
          message_id: resultado.messageId,
          activity_id: resultado.activityId,
          texto_enviado: geracao.mensagem,
          erro: erroEnvio,
          erro_em: erroEnvio ? enviadoEm : null,
        }).eq('id', disparoId),
        { contexto: `followup: disparo ${disparoId} — confirmar o envio` },
      )
      // Se mesmo com retentativa a gravação falhar, a mensagem JÁ SAIU mas
      // o banco não confirma: fica 'enviando' COM marca e vira
      // 'indeterminado' quando o lease vencer — nunca reenviado sozinho.
      if (okErro) return marcarFalhaPodeTerSaido(disparoId, tentativasAtuais, combinarErro(`enviado, mas falha ao confirmar a gravação: ${detalharErro(okErro)}`))
      return
    }

    // Recusa explícita da Z-API (4xx, não configurada) → não saiu,
    // retentável; 'falhou' só quando ESGOTAM as tentativas (fn_followup_
    // elegiveis conta 'falhou' em ocupam_lugar — bloqueador achado em
    // revisão). 5xx/408 → a resposta não garante que não saiu.
    const motivoZapi = `falha no envio pela Z-API: ${resultado.erro ?? 'sem detalhe'}`
    if (resultado.podeTerSaido) return marcarFalhaPodeTerSaido(disparoId, tentativasAtuais, combinarErro(`${motivoZapi} — resposta ambígua, a mensagem PODE ter saído`))
    return marcarFalhaRetentavel(disparoId, tentativasAtuais, maxTentativas, combinarErro(motivoZapi))
  } catch (e) {
    // Rede da precisão: qualquer exceção não prevista. Sem isto, uma exceção
    // dentro do after() morre sem log e o disparo só seria notado quando o
    // lease vencesse. Antes da marca, nunca "pode ter saído".
    const mensagem = combinarErro(`falha inesperada no processamento em segundo plano: ${ocultarSegredosZapi(detalharExcecao(e))}`)
    if (zApiChamada) await marcarFalhaPodeTerSaido(disparoId, tentativasAtuais, mensagem)
    else await marcarFalhaRetentavel(disparoId, tentativasAtuais, maxTentativas, mensagem)
  }
}

async function processarDisparo(disparoId: unknown) {
  if (typeof disparoId !== 'string' || !disparoId) {
    return NextResponse.json({ ok: false, erro: 'disparo_id ausente' }, { status: 400 })
  }

  // Reivindica ATOMICAMENTE (compare-and-set: só troca se ainda estiver
  // 'reservado' e a reserva ainda viver). Sem isso, duas entregas
  // concorrentes do mesmo disparo_id (reentrega do pg_net, por exemplo)
  // liam o mesmo status 'reservado' e mandariam a mensagem duas vezes —
  // achado de revisão. 'enviando' é o estado de reivindicação tanto para
  // sombra quanto para autônomo: se o processo cair no meio, a varredura
  // decide o destino pela marca. reivindicado_em diz à varredura que este
  // ciclo é de um executor que grava a marca; zapi_iniciado_em zerado
  // garante que marca de ciclo anterior nunca vale pra este.
  //
  // comRetentativa cobre a PATCH da reivindicação 504ando (achado do
  // teste real, 14/09/2026 — duas ocorrências, causa direta do atraso).
  // teto bem abaixo dos 15s de timeout_milliseconds que fn_followup_
  // varrer usa no net.http_post desta chamada (0059/0060).
  // carimboUnico() (não new Date().toISOString() puro): achado MÉDIO da
  // Sentinela — um timestamp de milissegundo não é um token exclusivo
  // desta invocação; duas entregas concorrentes do mesmo disparo_id que
  // colidissem no MESMO milissegundo poderiam "adotar" a reivindicação
  // uma da outra mais abaixo. O nonce de microssegundo reduz a colisão
  // ~1000x sem precisar de coluna nova (migration fora do escopo desta
  // tarefa — reduz o risco, não o elimina matematicamente).
  const reivindicadoEm = carimboUnico()
  const resultadoClaim = await comRetentativa(
    () => db.from('followup_disparos')
      .update({ status: 'enviando', reivindicado_em: reivindicadoEm, zapi_iniciado_em: null })
      .eq('id', disparoId).eq('status', 'reservado').gt('lease_ate', new Date().toISOString())
      .select('*').maybeSingle(),
    { contexto: `followup: disparo ${disparoId} — reivindicar` },
  )
  const { error: claimErro } = resultadoClaim
  let claimado = resultadoClaim.data
  if (claimErro) {
    const mensagem = `falha ao reivindicar o disparo: ${detalharErro(claimErro)}`
    console.error(`followup: disparo ${disparoId} —`, mensagem)
    return NextResponse.json({ ok: false, erro: mensagem }, { status: 503 })
  }

  if (!claimado) {
    // comRetentativa também aqui (achado MÉDIO da Sentinela): esta
    // releitura é o próprio caminho criado pra tratar resposta perdida —
    // deixá-la sem retentativa reabre a mesma janela de abandono que a
    // reivindicação está consertando, só exigindo uma falha a mais.
    const { data: atual, error: atualErro } = await comRetentativa(
      () => db.from('followup_disparos').select('*').eq('id', disparoId).maybeSingle(),
      { contexto: `followup: disparo ${disparoId} — reconferir depois de reivindicação sem retorno` },
    )
    if (atualErro) {
      const mensagem = `falha ao consultar o disparo: ${detalharErro(atualErro)}`
      console.error(`followup: disparo ${disparoId} —`, mensagem)
      return NextResponse.json({ ok: false, erro: mensagem }, { status: 503 })
    }
    if (!atual) return NextResponse.json({ ok: false, erro: 'disparo não encontrado' }, { status: 404 })
    // Reivindicação recuperada após resposta perdida no gateway: SÓ quando
    // ESTA invocação sofreu uma falha transitória antes (resultadoClaim.
    // retentou) é que "nenhuma linha" pode significar "a minha própria
    // escrita anterior aplicou" — mesmoInstante(reivindicado_em,
    // reivindicadoEm) prova isso (mesmo timestamp, não a mesma string —
    // achado da Sentinela: o PostgREST devolve timestamptz num formato
    // diferente do que o app escreveu). Sem esta checagem o disparo
    // ficaria 'enviando', reivindicado, e ninguém chamaria o resto do
    // trabalho até o lease vencer sozinho — o mesmo atraso que estamos
    // consertando.
    if (resultadoClaim.retentou && atual.status === 'enviando' && mesmoInstante(atual.reivindicado_em, reivindicadoEm)) {
      console.error(`followup: disparo ${disparoId} — reivindicação recuperada após resposta perdida no gateway (a escrita já tinha aplicado); prosseguindo`)
      claimado = atual
    } else if (atual.status === 'enviado' || atual.status === 'sombra') {
      // repetir não duplica: já processado (por esta chamada ou por outra concorrente), devolve ok sem refazer nada
      return NextResponse.json({ ok: true, duplicado: true })
    } else {
      return NextResponse.json({ ok: false, erro: 'reserva vencida, já em processamento, ou status inesperado — sem efeito' }, { status: 409 })
    }
  }

  // A partir daqui a reivindicação JÁ está gravada e confirmada — responde
  // JÁ (pg_net não precisa mais esperar) e faz o resto depois da resposta.
  const disparo = claimado
  after(() => processarDisparoEmSegundoPlano(disparo))
  return NextResponse.json({ ok: true, status: 'processando' })
}

export async function POST(req: Request) {
  if (!process.env.FOLLOWUP_API_SECRET) {
    return NextResponse.json({ ok: false, erro: 'integração não configurada' }, { status: 503 })
  }
  if (!integrationAuthorizedHeaderOnly(req, process.env.FOLLOWUP_API_SECRET, 'x-followup-token')) {
    return NextResponse.json({ ok: false, erro: 'não autorizado' }, { status: 401 })
  }
  // Distingue "o guardião disse não" de "o guardião não conseguiu
  // responder" (decisão do maestro, 14/09/2026, depois do achado ALTO da
  // Sentinela — quatro dos sete 504 do teste real foram justamente em
  // fn_security_rate_limit, chamada em TODA invocação, antes até da
  // reivindicação: sem distinguir os dois casos, esse 504 sozinho travava
  // o ciclo inteiro no primeiro portão, o mesmo atraso do resto do
  // Defeito A). integrationRateLimit devolve 429 quando o guardião
  // respondeu e disse não (respeita sempre, sem exceção) e 503 só quando
  // a própria checagem falhou (RPC fora do ar) — aí SEGUE em frente sem
  // teto, e não retenta a RPC: fn_security_rate_limit incrementa um
  // contador de hits a cada chamada, não é idempotente, e retentar depois
  // de uma escrita que já aplicou infla o contador e pode transformar um
  // tropeço de infra de 1s num 429 espúrio minutos depois — troca um
  // atraso por um bloqueio, pior que o problema.
  //
  // Seguir sem teto é seguro SÓ AQUI, nesta rota específica: (a) o teto é
  // checado DEPOIS da autenticação por segredo (linha acima) — só chega
  // até aqui quem já provou o x-followup-token; (b) quem impede disparo
  // duplicado não é o teto, é a reivindicação atômica (status/lease) +
  // marca zapi_iniciado_em da 0060, nada disto depende do rate limit; (c)
  // o único chamador é o pg_cron, uma vez por minuto — o teto existe
  // contra volume de abuso vindo de fora, não é a peça que protege a
  // mensagem. NÃO generalizar este padrão pros outros 13 endpoints que
  // usam integrationRateLimit (chamados de fora, principalmente
  // /api/naia/* e /api/whatsapp/*) sem essa mesma análise — decisão à
  // parte, registrada no roadmap pelo maestro.
  const limited = await integrationRateLimit('web/app/api/followup/executar/route.ts')
  if (limited) {
    if (limited.status === 429) return limited
    console.error('followup: seguindo sem o teto de requisições — a checagem (fn_security_rate_limit) não respondeu:', limited.status)
  }

  let body: Record<string, unknown>
  try { body = await readBoundedJson(req) } catch { return NextResponse.json({ ok: false, erro: 'json inválido' }, { status: 400 }) }

  if (body.acao === 'desfecho') return processarDesfecho(body.opportunity_id)
  return processarDisparo(body.disparo_id)
}
