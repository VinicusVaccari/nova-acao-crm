# 04 — Automações (comercial)

Onde a automação entra no comercial, o que já roda e o que falta. A grande questão de arquitetura aqui é **onde a automação vive: no n8n ou em código dentro do sistema**.

## A decisão central: n8n × código

Hoje a automação da Nova Ação vive no **n8n** (é onde a Naia foi feita). Para o novo sistema, há dois caminhos — e **ainda não decidimos**:

| | n8n (como hoje) | Código no sistema |
|---|---|---|
| Naia (SDR) | roda no n8n, chama o Supabase | serviço Next + Claude, sem n8n |
| Cadências/réguas | workflows n8n | jobs/rotas no sistema |
| Vantagem | já existe, visual, rápido de mexer | tudo num lugar, mais controle, versionado no git |
| Risco | lógica espalhada em duas casas | reescrever o que já funciona |

**Princípio que vale nos dois casos:** o estado mora no Supabase. Quem automatiza (n8n ou código) só lê e escreve lá — então dá para migrar de um para o outro sem perder dados. Ver [01](01-arquitetura.md) e [09](09-decisoes-abertas.md).

> **Direção atual (🔵 foco):** o WhatsApp entra pela **Z-API** e a **Naia é conectada ao sistema** com as integrações para operar sobre a base (contexto, resposta, atividade, etapa). O canal e o estado passam a ser nossos, esteja a lógica no n8n ou em código.

---

## O que já roda ✅

| Automação | Onde | Status |
|---|---|---|
| **Naia — atendimento e qualificação** do lead (WhatsApp) | n8n | 🔵 em produção |
| **Ingestão de lead** (formulário/API → `fn_ingest_lead`) | sistema | ✅ pronto |
| **Speed to lead** (marcado no 1º contato) | sistema (`fn_log_activity`) | ✅ pronto |
| **Máquina de estados** do funil (`fn_move_stage`, lê `pipeline_stages`) | sistema | ✅ pronto |
| **Agenda ↔ Google Calendar** (agendar cria evento+Meet; sync bidirecional) | sistema | ✅ pronto |
| **"Parado há X dias"** por negócio (`v_deal_parado`) | sistema | ✅ pronto |
| **Sincronização "próxima tarefa" → tela Hoje** | sistema | ✅ pronto |

## O que a Naia usa do sistema

Dois "encaixes" no Supabase, que funcionam esteja a Naia no n8n ou em código:

- `fn_sdr_context(telefone)` — devolve, numa chamada: quem é a pessoa, de qual origem veio, o histórico e a próxima reunião.
- `fn_log_activity(...)` e `fn_move_stage(...)` — registrar contato e mover o estágio.

## O que falta automatizar

### Foco agora 🔵 — a entrada do lead (rápida e automática)

| # | Automação | O que faz |
|---|---|---|
| E1 | **Z-API (WhatsApp)** | conectar o canal de WhatsApp ao sistema (envio/recebimento), tirando o WhatsApp da caixa-preta do n8n |
| E2 | **Naia conectada ao sistema** | dar à IA as integrações para ler contexto, responder, registrar atividade e mover etapa **direto na base**; mudar o fluxo atual |
| E3 | **Ingestão automática de leads** | site/formulário, **anúncios** e **UTMs** caem no CRM via `/api/ingest/lead` + `fn_ingest_lead`, sem intermediário |
| E4 | **UTMs rastreadas** | origem/campanha/criativo amarrados ao negócio desde o 1º toque (`touchpoints`, `identities` de clique) |
| E5 | **Velocidade de entrada** | lead visível no CRM em segundos (a dor da RD é ser lento); speed-to-lead começa na hora |

### Depois 🟡

| # | Automação | O que faz |
|---|---|---|
| A1 | **Sincronismo com RD Station** | importar/sincronizar os negócios do CRM atual |
| A2 | **Follow-up de qualificação** | cadência de contato até qualificar ou nutrir |
| A3 | **Follow-up de reunião (show rate)** | régua T−24h / T−3h / T−15min + confirmação ativa (agenda já linkada) |
| A5 | **Ingestão de transcrição** | gravação da reunião → texto → dispara a análise |
| A6 | **Análise de reunião** (Claude) | extrai dores/objeções/próximo passo → mapa de objeções + CRM |
| A7 | **Proposta personalizada** | monta a proposta por lead a partir do diagnóstico |
| A8 | **Contrato / quote** | gera o documento de contrato |
| A9 | **Deal ganho → onboarding** | dispara o início do cliente (já mira a fase de CS) |

## Padrão obrigatório

Toda automação: **valida a entrada → escreve no Supabase → registra em `automation_runs` → erro vira alerta**. Nunca engolir exceção. `automation_runs` já existe no banco para esse log (ainda não usado).

## Fora do escopo agora (fase futura)

Sync de custo de mídia (Meta/Google), despacho do `outbox` (conversões offline), automações de CS e advocacy — voltam quando abrirmos marketing e CS.
