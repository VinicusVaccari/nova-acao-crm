# 08 — Roadmap (comercial)

Foco único: **unificar o comercial**. Depois expandimos para as outras áreas. Usa a legenda: 🟢 já acontece · 🔵 em implementação · 🟡 a implementar.

## Onde estamos

### Já construído neste sistema ✅
- Banco comercial no Supabase (identidade, funil, ficha, espinha) + RLS + login.
- **Pipeline kanban** arrastável (filtros: status, data, qualificação, nome, produto, valor).
- **Etapas editáveis pelo CRM**: renomear, recolorir, reordenar e **adicionar/remover** etapas — sem tocar em código. As etapas deixaram de ser um enum fixo: `stage` virou texto e o funil (rank/probabilidade/transição) lê a tabela `pipeline_stages`. A etapa **Venda** (ganho) é de **função fixa** (move/renomeia, mas não remove nem troca o papel).
- **"Parado há X dias"** em cada card — tempo desde a última interação (mensagem, mudança de etapa, tarefa, nota ou reunião), com cor de alerta (âmbar 2d, vermelho 5d). Via `v_deal_parado`.
- **Ficha do lead** completa: negociação/contato/empresa editáveis, histórico, anotações, tarefas, reuniões, propostas (documento), produtos, arquivos. Contato com atalhos de WhatsApp/copiar/abrir nas Mensagens.
- **Tela de Mensagens** (inbox) com painel de contexto editável.
- **Agenda linkada ao Google Calendar** (OAuth): agendar reunião no deal cria o evento com **Meet**, página "Agenda" mostra a semana, e o sync é **bidirecional** (apagar/remarcar no Google reflete no deal ao abrir a ficha). Tabelas: `calendar_accounts` + `meetings.external_event_id`/`meeting_url`.
- **Dashboards comerciais** (funil, show rate, mapa de objeções, por vendedor).
- Ingestão de lead por API + funções para a Naia (`fn_sdr_context`, `fn_log_activity`, `fn_move_stage`).
- **Sistema publicado** na Vercel (`nova-acao-crm.vercel.app`), deploy via CLI (sem git). Login funcional.
- **Ingestão automática de leads** por formulário/CF7 com UTMs (`utm_*`, `gclid`/`fbclid`) amarradas ao negócio, aceitando nomes de campo em PT. Painel "De onde veio". (ver `10-ingestao-de-leads.md`)
- **WhatsApp dentro do app** (Z-API + Naia como cérebro): inbound loga no inbox e aciona a Naia; Rodrigues responde (pelo sistema ou na mão), captura via `fromApi`, trava/intervenção, mapa LID↔telefone pelo cadastro, áudios recebidos e tocáveis (player estilo WhatsApp). (ver `11-whatsapp-hub.md`)
- **Configurações** (admin/gestor): Usuários e equipes + **convites por e-mail (Resend)** com página de aceite; Perfil (nome, senha com verificação, foto); Segmentos, Motivos de perda, Produtos e serviços; Campos personalizados (deal/company/contact). (ver `12-configuracoes.md`)
- **Marca Nova Ação** aplicada (logo/símbolo, cores oficiais) na topbar e no login.

### Já existe na operação (fora deste sistema) 🔵/🟢
- **Naia** (SDR de IA no n8n) — qualificação/atendimento.
- **RD Station** — CRM atual (lento na entrada do lead — dor que o passo 1 resolve).
- Dashboards espalhados.

## Próximos passos (ordem sugerida)

> Prioridade definida: **1º** os leads entrando sozinhos (para **não perder lead/informação**), **2º** Z-API + Naia, **depois** o resto.

### 1. Ingestão automática de leads 🟢 — **foco #1 (não perder lead) — FEITO**
Sistema publicado na Vercel; `/api/ingest/lead` + `fn_ingest_lead` recebendo formulário/CF7 com UTMs (`utm_*` + `gclid`/`fbclid`) amarradas ao negócio desde o 1º toque, lead visível em segundos. Detalhe em `10-ingestao-de-leads.md`.
- **Ainda em aberto**: plugar **anúncios** (Meta Lead Ads, Google) direto; **dual-write com o RD** durante a migração.

### 2. Z-API + Naia no sistema 🟢 — **foco #2 — FEITO**
Z-API conectada; o app é o **hub** (recebe → loga → decide quem responde → envia). A Naia (n8n) recebe/responde via `/api/whatsapp/reply`; humano responde pelo sistema ou na mão (capturado por `fromApi`), com trava/intervenção. Detalhe em `11-whatsapp-hub.md`.
- **Ainda em aberto**: dar à Naia as ferramentas para **operar sobre a base** (mover etapa, etc.) além de responder; simplificar o fluxo n8n agora que o app é o hub.

### 3. Fechar a base comercial e conectar o resto
- **Sincronizar/migrar o RD Station** para o sistema.
- Consolidar a decisão **n8n × código** para as automações restantes.

### 4. Follow-up e show rate 🟡 — *destravado pela agenda, ainda não iniciado*
- Follow-up de **qualificação** (cadência).
- Follow-up de **reunião com foco em show rate** (régua T−24h/T−3h/T−15min). A agenda já está linkada, então o pré-requisito está pronto.

### 5. Reuniões inteligentes 🟡
- Gravação + **transcrição** das reuniões.
- **Análise de reunião** (Claude) → preenche CRM + alimenta o **mapa de objeções** (cases são do CS, não saem daqui).
- **Copiloto do Rodrigues** (perguntar sobre deals no chat).

### 6. Proposta e fechamento 🟡
- **Proposta personalizada por lead** (a partir do diagnóstico).
- **Geração de contrato/quote**.

### 7. Ponte para o cliente 🟡
- Deal ganho → **onboarding** (já mirando a futura área de CS).

## Depois do comercial

Só quando o comercial estiver unificado e rodando: **marketing** (incl. o closed-loop de conversões que já está "armado" no `outbox`) e **CS/advocacy**. O modelo de dados foi desenhado para recebê-los sem retrabalho.

## Custo operacional (comercial)

Supabase (~US$ 25) + Vercel (US$ 0–20) + **Z-API** (WhatsApp, plano mensal) + Naia/n8n (já existente) + API Claude (conforme uso, quando ligar a IA de reunião/copiloto). Ordem de grandeza baixa.
