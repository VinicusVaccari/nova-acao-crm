# 02 — Modelo de dados (comercial)

Fonte da verdade: um único Postgres (Supabase). Este doc descreve **o schema que está de fato implementado** para o comercial. A explicação em linguagem simples está em [02b](02b-modelo-explicado.md).

## Mapa das entidades implementadas

```
IDENTIDADE            FUNIL COMERCIAL          DENTRO DO DEAL          ESPINHA / INTEGRAÇÃO
─────────             ───────────────          ──────────────          ────────────────────
people                opportunities            notes                   events
identities            pipeline_stages          tasks                   outbox (parado*)
companies             stage_history            proposals (+arquivo)    automation_runs (n8n)
person_company        activities               opportunity_products    calendar_accounts (Google)
                      meetings                 deal_files (Storage)
                      objections               products (catálogo)
                      objection_occurrences
                      lost_reasons
                      touchpoints
                      profiles (usuários)
```

`*` `outbox` existe (o closed-loop de mídia enfileira conversões), mas **não há despachante** — está congelado até entrarmos em marketing. Ver [09](09-decisoes-abertas.md).

---

## Bloco 1 — Identidade

Uma pessoa, muitos identificadores. É o que liga o lead que a Naia atendeu no WhatsApp ao contrato fechado depois, sem duplicar.

- **`people`** — a pessoa (nome, e-mail, telefone E.164, base legal LGPD).
- **`identities`** — cada jeito de reconhecer a pessoa: `email`, `phone`, `wa_id` (WhatsApp da Naia), `cpf`, e ids de clique (`fbclid`, `gclid`, `ga_client_id`) para o futuro loop de mídia. Chave única `(kind, value)`.
- **`companies`** — a empresa (razão/nome fantasia, CNPJ, endereço, site, segmento).
- **`person_company`** — vínculo pessoa↔empresa (permite mais de um contato por empresa).

`fn_resolve_person` recebe qualquer combinação de identificadores e devolve **uma** pessoa (ordem de confiança: telefone > e-mail > wa_id > ids de clique).

## Bloco 2 — Funil comercial

- **`opportunities`** — o negócio (deal). Campos-chave, todos editáveis pela ficha:
  - `stage` (**texto**, referencia `pipeline_stages.stage`), `stage_since`, `board_rank` (ordem no kanban)
  - `title` (nome do negócio), `qualificacao` (0–5, as estrelas), `source`, `campaign`, `creative`
  - `expected_value` (MRR), `setup_value`, `term_months` → **compostos pelos produtos**
  - `score` (0–100, lead score interno), `qualification` (jsonb legado — em desuso)
  - `owner_id` (Rodrigues), `sdr_id` (Naia), `first_contact_at` (base do speed to lead)
  - `next_step` / `next_step_due` — a **tarefa aberta mais próxima** (sincronizada), alimenta a tela Hoje
  - `lost_reason` (lista fechada) quando perdido
- **`pipeline_stages`** — as etapas do funil como **dados** (não mais um enum fixo). Cada linha: `stage` (id), `label`, `color`, `sort_order`, `on_board` (é coluna do kanban), `probability`, e as flags de papel `won`/`lost`/`nurture`. É o que permite **renomear, recolorir, reordenar e adicionar/remover** etapas pelo CRM. As funções do funil (rank, probabilidade, transição) leem daqui. **Venda** (`won`), **Perdido** (`lost`) e **Nutrição** (`nurture`) têm função fixa: movem/renomeiam, mas não removem.
- **`stage_history`** — toda mudança de etapa (de/para, quando, quem, duração). Base dos relatórios de conversão.
- **`activities`** — timeline de contatos (whatsapp/ligação/e-mail/áudio/nota). É o que a **Naia** grava via `fn_log_activity`; o primeiro contato de saída marca o speed to lead.
- **`meetings`** — reuniões (diagnóstico/fechamento/follow-up) com status `agendada/realizada/no_show/…`. É daqui que sai o **show rate**. `external_event_id` + `meeting_url` guardam o vínculo com o **Google Calendar** (evento + link do Meet). 🟡 Gravação/transcrição alimentará a análise de reunião.
- **`objections`** + **`objection_occurrences`** — o **mapa de objeções vivo** 🟡: o catálogo e cada vez que uma objeção apareceu numa call (com o verbatim e se matou o deal).
- **`lost_reasons`** — lista fechada de motivos de perda.
- **`touchpoints`** — a origem do lead (canal, UTM, ids de clique). Mostrada na ficha ("De onde veio").

## Bloco 3 — Dentro do deal (a ficha)

- **`notes`** — anotações livres do negócio.
- **`tasks`** — tarefas do negócio (assunto, descrição, tipo, prazo, responsável, concluída). A mais próxima em aberto vira o `next_step` do deal.
- **`proposals`** — a proposta como **documento anexado** (arquivo no Storage: `file_name`, `file_path`, `file_mime`, `file_size`) + `version` e `status` (enviada/aceita/recusada). *Campos estruturados antigos (mrr/setup/scope/slug) existem mas estão em desuso.* 🟡 A geração automática/personalizada é o passo futuro.
- **`products`** — catálogo dos serviços da Nova Ação (7 linhas: Sites e Páginas, SEO, Tráfego Pago, E-mail Marketing, Hospedagem, Google Meu Negócio, Identidade Visual).
- **`opportunity_products`** — produtos do deal (quantidade, valor unitário, recorrência único/mensal, desconto). Somados, definem o **Valor total** e recompõem `expected_value`/`setup_value`.
- **`deal_files`** — arquivos do negócio (binário no bucket privado `deal-files` do Storage).

## Bloco 4 — Espinha

- **`events`** — diário de bordo append-only (lead.created, opportunity.stage_changed…). Emitido pelas funções. Base de auditoria/análise futura.
- **`outbox`** — fila de conversões para Meta/Google (closed-loop). **Congelado**: enfileira, mas não despacha (marketing é fase futura).
- **`automation_runs`** — log de execuções de automação (para o n8n). Ainda não usado.
- **`calendar_accounts`** — a conexão OAuth com o **Google Calendar** (tokens de acesso/refresh, e-mail da conta, calendário). RLS ligado **sem policies**: só o servidor lê os tokens; nenhum cliente enxerga.

## A função que segura o funil

```sql
fn_move_stage(opportunity_id, to_stage, actor, actor_type, reason, meta)
-- valida transição · grava stage_history · emite evento · (enfileira conversão no outbox)
```

Tudo — kanban, ficha, Naia — muda estágio por aqui. Também:
- `fn_ingest_lead(payload)` — entrada única de lead (resolve identidade, cria toque + oportunidade, emite evento).
- `fn_log_activity(...)` — registra contato e marca o speed to lead (usada pela Naia).
- `fn_sdr_context(phone)` — devolve à Naia, numa chamada, quem é a pessoa, de onde veio, histórico e próxima reunião.

## Views que os dashboards consomem

`v_opp_journey` (a jornada achatada de cada deal), `v_objection_map` (mapa de objeções vivo), `v_sla_breaches` (leads fora do SLA), `v_stale_deals` (deals parados), `v_deal_parado` (última interação por negócio → alimenta o **"parado há X dias"** dos cards) — mais as funções `fn_dash_comercial`, `fn_funnel_series`, `fn_dash_por_vendedor`.

## Removido do escopo (voltará no futuro)

CS/onboarding, health score, NPS, faturas, advocacy (depoimentos/cases), catálogo/gasto de mídia — **foram retirados do banco** ao focar no comercial. Reentram quando abrirmos essas áreas.
