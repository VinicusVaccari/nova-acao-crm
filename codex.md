# Histórico técnico do projeto

Este arquivo registra as alterações feitas no sistema com ajuda do Codex, o problema que motivou cada mudança, as decisões adotadas, os arquivos afetados e a forma de validação.

## Regra de manutenção

A partir de 4 de setembro de 2026, toda alteração realizada pelo Codex neste repositório deve incluir uma atualização neste arquivo. Uma tarefa só é considerada concluída quando o histórico informar:

- data e objetivo da alteração;
- problema observado e causa identificada;
- comportamento decidido com o usuário;
- arquivos, banco de dados e integrações alterados;
- consequências importantes e limitações conhecidas;
- testes, migrations e deploys executados;
- commit relacionado, quando houver.

As novas entradas devem ser adicionadas no início da seção "Registro de alterações", preservando o histórico anterior.

## Comportamento funcional consolidado

### Formulário enviado para um contato já conhecido

O sistema identifica a pessoa pelos dados de contato e sempre grava um novo `touchpoint`, preservando as UTMs recebidas.

- Se a pessoa já possui um negócio aberto, o formulário não duplica o negócio. O negócio aberto é reutilizado e seu `last_touchpoint_id` passa a apontar para o novo envio. Assim, a ficha mostra as UTMs desse retorno.
- Se o negócio anterior está perdido (`lost_at` preenchido) ou vendido (`stage = 'ganho'`), um novo negócio é criado na etapa `novo`.
- Se o negócio anterior foi excluído fisicamente, ele não pode ser reutilizado. A pessoa e seu histórico podem continuar no banco, mas um novo negócio é criado.
- Ao reutilizar um negócio aberto, a ingestão atualiza o toque atribuído, mas não substitui automaticamente `company_id`, produto, valor esperado nem outros dados comerciais já preenchidos no negócio.
- Em um negócio novo, a empresa resolvida durante a ingestão é associada ao novo negócio.

### UTMs e campos comerciais

Os dados completos de atribuição continuam armazenados em `touchpoints`. O negócio mantém também uma projeção simplificada para os campos comerciais:

| Touchpoint | Campo do negócio |
| --- | --- |
| `utm_source` | `source` |
| `utm_campaign` | `campaign` |
| `utm_content` | `creative` |
| `channel` | `source_channel` |

Essa sincronização preenche campos vazios e não sobrescreve um valor comercial já preenchido manualmente. Na ficha, entretanto, a seção informativa **De onde veio** e os fallbacks de **Negociação** priorizam o touchpoint atribuído ao negócio atual.

### Pipeline e status

Os cards usam o slug da etapa para encontrar a coluna do Kanban. Por isso, `opportunities.stage` e `pipeline_stages.stage` precisam ter exatamente os mesmos valores.

`Perdido` é um status do negócio, representado por `lost_at` e `lost_reason`, e não uma etapa operacional. O negócio mantém a etapa em que foi perdido para permitir análise comercial. `Venda` continua representada pelo slug `ganho`.

## Registro de alterações

### 2026-09-04 — Criação deste histórico técnico

#### Objetivo

O usuário solicitou um arquivo permanente chamado `codex.md` para explicar detalhadamente cada feature e registrar tudo que for alterado com ajuda do Codex, incluindo o motivo das decisões.

#### Alteração

- criado `codex.md` na raiz do repositório;
- consolidado neste documento todo o trabalho de pipeline, cards, reentrada de leads, UTMs, Naia e deploy realizado durante a investigação;
- definida a atualização deste arquivo como parte obrigatória das próximas alterações feitas pelo Codex.

#### Arquivo afetado

- `codex.md`

#### Commit

- `Documenta histórico das correções do CRM`

### 2026-09-04 — Correção de pipeline, reentrada de leads e atribuição de UTMs

#### Problemas relatados

1. Um formulário criava ou atualizava um negócio no banco, mas o card não aparecia na pipeline.
2. Após o primeiro contato automático, o negócio era movido para `em_atendimento`, enquanto a pipeline atual esperava `primeiro_contato`.
3. O Kanban só renderiza um card quando encontra uma coluna com o mesmo slug; o desencontro fazia o card ser descartado silenciosamente na interface.
4. Ao enviar novamente o formulário para um contato conhecido, as novas UTMs eram armazenadas, mas a ficha mostrava o primeiro touchpoint histórico da pessoa, que podia ser antigo e não possuir UTMs.
5. Os campos de **Negociação** e a seção **De onde veio** usavam fontes diferentes, causando a impressão de que os dados não haviam sido recebidos.
6. O formulário enviava a página como `page_url`, enquanto o banco espera `landing_page`.
7. Regras antigas ainda tratavam `perdido` como etapa, apesar de o modelo atual usar `lost_at` como status.

#### Causa raiz

O problema era a combinação de dois desalinhamentos independentes:

- **Pipeline:** funções, filtros e automações ainda usavam slugs antigos depois da alteração das colunas visíveis.
- **Atribuição:** a ficha consultava os touchpoints da pessoa e escolhia o primeiro registro histórico, em vez de consultar diretamente o `last_touchpoint_id` do negócio aberto.

Isso explica por que um negócio podia existir no banco sem aparecer no Kanban e por que as UTMs podiam estar salvas sem aparecer na ficha.

#### Realinhamento das etapas

A migration `0043_realinhar_slugs_etapas.sql` realinhou colunas, negócios e histórico em duas fases, usando slugs temporários para evitar colisões. O mapeamento aplicado foi:

| Slug anterior | Slug atual |
| --- | --- |
| `em_atendimento` | `primeiro_contato` |
| `reuniao_agendada` no layout legado | `desqualificado` |
| `diagnostico_realizado` | `reuniao_agendada` |
| `fechamento_agendado` | `apresentacao_institucional` |
| `proposta_enviada` | `envio_proposta` |
| `negociacao` no layout legado | `apresentacao_proposta` |
| `negociacao_2` | `negociacao` |

Foram preservados os slugs que já eram válidos em instalações parcialmente atualizadas. Na aplicação, a lista passou a ser:

1. `novo` — Lead Aguardando Contato
2. `primeiro_contato` — Primeiro Contato Feito
3. `qualificado` — Qualificado
4. `desqualificado` — Desqualificado
5. `reuniao_agendada` — Reunião agendada
6. `apresentacao_institucional` — Apresentação Institucional
7. `envio_proposta` — Envio da Proposta
8. `apresentacao_proposta` — Apresentação da Proposta
9. `negociacao` — Negociação
10. `ganho` — Venda

A migration também corrigiu os cards existentes que estavam em etapas órfãs. Na verificação realizada durante a correção, dez negócios em `em_atendimento` foram realinhados para `primeiro_contato`.

#### Primeiro contato e movimentação automática

`fn_log_activity` foi recriada para que uma atividade outbound em um negócio na etapa `novo` chame `fn_move_stage` e mova o card para `primeiro_contato`. A movimentação continua registrada no histórico e deixa de gerar um slug inexistente.

As regras de reunião também foram atualizadas:

- reuniões agendadas podem mover negócios em `novo`, `primeiro_contato` ou `qualificado` para `reuniao_agendada`;
- reunião marcada como realizada move o negócio para `apresentacao_institucional`, substituindo o slug legado `diagnostico_realizado`.

#### Reentrada pelo formulário

`fn_ingest_lead` passou a considerar aberto somente o negócio que tenha `lost_at is null` e `stage <> 'ganho'`.

O comportamento decidido é:

- negócio aberto: reutilizar o negócio e atualizar `last_touchpoint_id` com o novo envio;
- negócio perdido: criar outro negócio;
- negócio vendido: criar outro negócio;
- negócio excluído fisicamente: criar outro negócio, pois não há mais oportunidade ativa para reutilizar.

Esse ajuste evita que um formulário novo recupere um negócio encerrado apenas porque sua etapa operacional foi preservada.

#### Exibição da origem na ficha

A ficha passou a carregar diretamente o touchpoint indicado por `opportunities.last_touchpoint_id`. A ordem de fallback é:

1. touchpoint consultado diretamente por `last_touchpoint_id`;
2. touchpoint correspondente encontrado na lista da pessoa;
3. `first_touchpoint_id` do negócio;
4. touchpoint mais recente disponível da pessoa.

A seção **De onde veio** permaneceu exatamente na posição em que já estava na ficha, conforme solicitado. Apenas a origem dos dados exibidos foi corrigida.

Ela mostra:

- origem (`utm_source`);
- mídia (`utm_medium`);
- campanha (`utm_campaign`);
- conteúdo (`utm_content`);
- termo (`utm_term`);
- página (`landing_page`);
- classificação do canal;
- presença de `fbclid` ou `gclid`, quando disponível.

Os campos **Fonte**, **Campanha** e **Criativo** em **Negociação** também usam as UTMs do touchpoint atribuído como fallback, mantendo separados o dado rastreado e o dado comercial editável.

#### Sincronização das UTMs no negócio

A migration `0044_sincronizar_utms_no_deal.sql` adicionou:

- função `fn_sync_opp_attribution`;
- trigger `trg_sync_opp_attribution` antes de inserir uma oportunidade ou atualizar `last_touchpoint_id`;
- backfill dos negócios existentes.

O trigger preenche `source`, `campaign`, `creative` e `source_channel` a partir do touchpoint atribuído somente quando esses campos estão vazios. Valores preenchidos manualmente são preservados.

#### Página de entrada

O endpoint `/api/ingest/lead` passou a normalizar tanto `landing_page` quanto `page_url` para `landing_page` antes de chamar `fn_ingest_lead`.

A migration `0045_backfill_pagina_touchpoint.sql` recuperou `raw.page_url` para `touchpoints.landing_page` nos registros anteriores em que havia uma URL válida. Se o formulário enviar `page_url` vazio, a ficha continuará mostrando `—`, pois não existe URL a recuperar.

#### Status de perdido e histórico

As consultas da agenda, da página inicial, da Naia e do WhatsApp deixaram de excluir `stage = 'perdido'` e passaram a usar `lost_at is null`, sempre excluindo também negócios vendidos quando necessário.

Ao marcar um negócio como perdido:

- `lost_at` e `lost_reason` são preenchidos;
- a etapa operacional real é mantida;
- uma entrada em `stage_history` registra quem marcou a perda e o motivo;
- ações da Naia usam `actor_type = 'ai'`.

Pausar e reabrir negociações agora gera atividades de sistema legíveis na timeline. O componente de histórico exibe atividades `kind = 'sistema'` como mensagens diretas, sem o prefixo genérico de atividade enviada.

#### Integração da Naia

Foram adicionados três endpoints protegidos por `NAIA_API_SECRET`, com fallback para `WHATSAPP_WEBHOOK_SECRET`:

- `POST /api/naia/estrelas`: altera apenas a qualificação de 0 a 5 de um negócio existente e nunca cria negócio;
- `POST /api/naia/motivo-perda`: cria um motivo de perda de forma idempotente e devolve seu slug;
- `POST /api/naia/perder`: marca um negócio existente como perdido usando um motivo válido e registra a ação como IA.

Os resolvedores por telefone da Naia e do WhatsApp passaram a procurar somente o negócio aberto mais recente. `fn_sdr_context` também usa o touchpoint do negócio aberto atual para devolver a origem correta à Naia.

#### Conversões e visões analíticas

`fn_enqueue_conversion` foi alinhada aos slugs atuais para continuar enfileirando corretamente:

- Lead Qualificado;
- Reunião Agendada;
- Reunião Realizada;
- Proposta Enviada;
- Purchase.

As views `v_stale_deals`, `v_sla_breaches` e `v_opp_journey` foram atualizadas para usar o modelo atual de status e os novos marcos da pipeline.

#### Ferramenta de migrations

`scripts/migrate.mjs` recebeu a opção `--only=<arquivo.sql>`. Ela permite aplicar ou verificar uma migration específica sem tentar executar todo o conjunto, o que foi necessário para uma correção controlada em produção.

#### Arquivos alterados

- `scripts/migrate.mjs`
- `supabase/migrations/0043_realinhar_slugs_etapas.sql`
- `supabase/migrations/0044_sincronizar_utms_no_deal.sql`
- `supabase/migrations/0045_backfill_pagina_touchpoint.sql`
- `web/app/(app)/agenda/page.tsx`
- `web/app/(app)/lead/[id]/page.tsx`
- `web/app/(app)/page.tsx`
- `web/app/api/ingest/lead/route.ts`
- `web/app/api/naia/deal/route.ts`
- `web/app/api/naia/estrelas/route.ts`
- `web/app/api/naia/motivo-perda/route.ts`
- `web/app/api/naia/perder/route.ts`
- `web/app/api/naia/reuniao/route.ts`
- `web/app/api/whatsapp/inbound/route.ts`
- `web/app/api/whatsapp/reply/route.ts`
- `web/components/ficha-tabs.tsx`
- `web/lib/actions.ts`
- `web/lib/crm.ts`
- `web/lib/estagios.ts`

#### Validação de dados realizada

Durante a investigação, foi confirmado que o negócio `3eef33bf-97af-4116-8206-a36915a4eefc` apontava para o touchpoint `136`, que continha:

- `utm_source = teste-origem`;
- `utm_medium = teste-midia`;
- `utm_campaign = teste-campanha`;
- `utm_content = teste-conteudo`;
- `utm_term = teste-termo`;
- `landing_page = null`, porque o envio testado continha `page_url` vazio.

Também foi confirmado que os campos comerciais do negócio receberam `source = teste-origem`, `campaign = teste-campanha` e `creative = teste-conteudo` após o backfill.

#### Migrations e testes

- `0043_realinhar_slugs_etapas.sql` aplicada no Supabase;
- `0044_sincronizar_utms_no_deal.sql` aplicada no Supabase;
- `0045_backfill_pagina_touchpoint.sql` aplicada no Supabase;
- `npm run build` executado no projeto `web` com compilação e verificação TypeScript concluídas;
- build de produção da Vercel concluído com sucesso.

#### Commits da correção

- `50c4d40` — Corrige pipeline, cards e atribuição de UTMs
- `2dcf0a1` — Sincroniza UTMs nos campos do negócio
- `50f314d` — Corrige origem rastreada na ficha
- `d9f3006` — Dispara deploy com autor autorizado

### 2026-09-04 — Correção da autoria Git e deploy na Vercel

#### Problema

As primeiras tentativas de deploy foram criadas, mas a Vercel não iniciou o build e mostrou o estado `BLOCKED`. A API informou:

> The deployment was blocked because the commit author doesn’t have permission to create deployments for this project.

O login da CLI já estava na conta correta, mas o commit Git ainda tinha como autor `vaccarivinicius2@gmail.com`. Em projetos Hobby com essa política de colaboração, a Vercel valida também a identidade do autor do commit, não apenas a sessão que executa o comando.

#### Alteração

- A sessão da Vercel foi autenticada e confirmada como `vinicius2008vaccarii@gmail.com`, usuário `vinicius2008vaccarii-2804`.
- O `user.email` local deste repositório foi alterado para `vinicius2008vaccarii@gmail.com`.
- Foi criado o commit vazio `d9f3006` com o autor correto para preservar o histórico existente sem reescrever commits anteriores.
- O commit foi enviado para `origin/main`.
- Um novo deploy de produção foi executado.

O segmento `vaccari` presente nas URLs administrativas da Vercel é o slug da equipe proprietária do projeto, não o e-mail utilizado para autenticação.

#### Resultado e validação

- Deployment: `dpl_FQES9vGstfQH8vngTzRXYv2T8M7M`
- URL imutável: `https://nova-acao-kf1ueikg7-vaccari.vercel.app`
- Domínio de produção: `https://nova-acao-crm.vercel.app`
- Estado final: `READY`
- `/login` respondeu HTTP `200`, com cache novo (`Age: 0`) após a publicação.

Os deploys bloqueados anteriores não executaram build e não substituíram a versão de produção.

## Limitações e decisões que devem ser preservadas

- Não mover a seção **De onde veio** de sua posição atual sem solicitação explícita do usuário.
- Não voltar a usar `em_atendimento` ou outros slugs legados em novas regras.
- Não tratar `perdido` como etapa; usar `lost_at` e `lost_reason`.
- Não mostrar automaticamente o primeiro touchpoint histórico da pessoa como origem do negócio atual.
- Não sobrescrever campos comerciais editados manualmente apenas porque chegou um novo touchpoint.
- A exclusão física de negócios ainda não possui auditoria; não é possível determinar retrospectivamente quem ou qual processo excluiu um negócio.
- Um formulário de um contato com negócio aberto atualiza a atribuição desse negócio, mas não substitui automaticamente empresa, produto ou valores comerciais.
- `landing_page` só pode ser exibida se `landing_page` ou `page_url` vier preenchida no envio.

## Modelo para próximas entradas

```md
### AAAA-MM-DD — Título da alteração

#### Objetivo

#### Problema e causa

#### Decisão

#### Alterações realizadas

#### Arquivos afetados

#### Validação

#### Commit e deploy

#### Limitações ou próximos passos
```
