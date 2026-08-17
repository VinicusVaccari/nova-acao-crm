# 01 — Arquitetura (comercial)

> Escopo: **só o comercial**. A arquitetura foi desenhada para unificar a operação de vendas da Nova Ação e conectar o que já existe (Naia no n8n, RD Station), não substituir tudo de uma vez.

## Visão em camadas

```
┌─────────────────────────────────────────────────────────────────────┐
│  L4  INTERFACE — o sistema (Next.js na Vercel)                      │
│  Pipeline kanban (etapas editáveis) · Ficha do lead · Mensagens ·   │
│  Agenda (Google Calendar) · Dashboards · Login                      │
└─────────────────────────────────────────────────────────────────────┘
                                  ▲
┌─────────────────────────────────────────────────────────────────────┐
│  L3  INTELIGÊNCIA — Naia (SDR) 🔵 integrando · Claude 🟡            │
│  Naia opera na base · Análise de reunião · Copiloto · Proposta       │
└─────────────────────────────────────────────────────────────────────┘
                                  ▲
┌─────────────────────────────────────────────────────────────────────┐
│  L2  DOMÍNIO (Postgres: funções + RLS)                              │
│  Funil data-driven (pipeline_stages) · fn_move_stage · eventos      │
└─────────────────────────────────────────────────────────────────────┘
                                  ▲
┌─────────────────────────────────────────────────────────────────────┐
│  L1  DADO — Supabase Postgres (fonte da verdade do comercial)       │
│  Identidade · funil · etapas · reuniões · propostas · produtos ·    │
│  tarefas · toques(UTM) · calendar_accounts                          │
└─────────────────────────────────────────────────────────────────────┘
                                  ▲
┌─────────────────────────────────────────────────────────────────────┐
│  L0  ENTRADA — 🔵 foco atual                                        │
│  Site/formulário · Anúncios + UTM · Z-API (WhatsApp) · Naia ·       │
│  RD Station (sync) — tudo por fn_ingest_lead, em segundos           │
└─────────────────────────────────────────────────────────────────────┘
```

> **Integrações externas já ligadas:** **Google Calendar** (OAuth) para a Agenda — agendar no deal cria o evento com Meet e sincroniza os dois lados.

## O que já existe na operação (a base a conectar)

- 🔵 **Naia — o SDR de IA, feito no n8n.** Já em produção. Atende o lead e preenche parte da qualificação. É o "Rodrigues agenda a primeira reunião — isso eu quero botar a IA para cobrir" do quadro: a Naia cobre a qualificação e o agendamento.
- 🟢 **RD Station — o CRM atual.** É de onde os dados de negociação vivem hoje. O sistema precisa **sincronizar** com ele (ou migrar).
- 🟢 **Dashboards espalhados.** Existem, mas desconectados. Este sistema centraliza.
- 🟢 **Rodrigues — o único vendedor.** Assume o lead qualificado, faz diagnóstico, fechamento e venda (tudo manual hoje).

## As duas grandes indefinições de arquitetura

Estas decisões atravessam todo o resto e estão **em aberto** (ver [09](09-decisoes-abertas.md)):

### 1. O SDR (Naia) fica no n8n ou vem para o código?

```
   Opção A — Naia continua no n8n           Opção B — Naia em código no sistema
   ┌───────────────┐                        ┌──────────────────────────────┐
   │ Naia (n8n)    │  webhooks / API        │ Sistema (Next + Claude)      │
   │ WhatsApp+IA   │ ───────────────▶       │ atende, qualifica, agenda    │
   └───────────────┘   lê/escreve no        │ tudo por trás, sem n8n       │
                       Supabase             └──────────────────────────────┘
```

- **Opção A (hoje):** a Naia roda no n8n e conversa com o Supabase por webhooks/funções (`fn_sdr_context`, `fn_log_activity`). Vantagem: já funciona, não mexe no que está de pé.
- **Opção B:** reescrever a Naia como serviço dentro do próprio sistema (Next + Claude), sem depender do n8n. Vantagem: tudo num lugar só, mais controle.

O sistema é desenhado para **funcionar dos dois jeitos** — o Supabase é a memória; quem escreve nela (n8n ou código) é intercambiável.

> **Direção atual (🔵 foco):** conectar a **Naia ao sistema via Z-API** e dar a ela as integrações para **operar sobre a nossa base** — ler contexto, responder no WhatsApp, registrar atividade e mover etapa. Seja a lógica no n8n ou em código, o WhatsApp passa a entrar pela Z-API e o estado vive no Supabase.

### 2. Como sincronizar com o RD Station

O RD Station tem os negócios de hoje. Opções: importar uma vez, sincronizar continuamente (via API), ou migrar de vez. **A definir.** Enquanto isso, o sistema tem sua própria entrada de lead (`fn_ingest_lead` + API).

## Princípios inegociáveis

### 1. Supabase é a memória; a Naia (n8n ou código) é o músculo
Nenhum estado de negócio dentro de um workflow. A Naia lê o contexto do lead do Postgres, conversa, e escreve de volta. Assim, migrar a Naia do n8n para código (ou o contrário) não perde nada.

### 2. Toda mudança de estágio passa por uma função
`fn_move_stage` valida a transição, grava o histórico (`stage_history`) e emite evento (`events`) — atomicamente. Nunca `UPDATE opportunities SET stage` direto. É o que garante o funil confiável e a base do mapa de objeções e das métricas.

### 3. Um único contrato de dados
Estágios, motivos de perda e status são listas fechadas versionadas. Sem campo livre em taxonomia.

### 4. Conectar antes de substituir
Naia e RD Station continuam existindo. O sistema se pluga neles. Só substituímos quando fizer sentido, não por princípio.

## Como o lead atravessa o comercial

```
[Lead entra]  🔵 site/formulário · anúncios+UTM · Z-API (WhatsApp) · API
     │  fn_ingest_lead → resolve identidade, cria oportunidade, grava o
     │  toque (UTM), emite evento — em SEGUNDOS (dor da RD: é lento)
     ▼
[Qualificação]  🔵 Naia atende, qualifica, agenda a 1ª reunião
     ▼
[Rodrigues assume]  🟢 diagnóstico → fechamento → venda
     │  reuniões gravadas e transcritas  🟡
     ▼
[Análise de reunião]  🟡 Claude extrai dores, objeções, próximo passo
     │        └──▶ Mapa de objeções  🟡   (cases vêm do CS; aqui só se usa como prova)
     ▼
[Proposta]  🟡 personalizada por lead → contrato/quote
     ▼
[Venda]  🟢
```

## Segurança

RLS ligado em todas as tabelas. Papéis: `admin`, `gestor`, `vendedor` (Rodrigues), `sdr` (Naia). Segredos em variáveis de ambiente. O sistema tem login (Supabase Auth) e proteção de rotas.
