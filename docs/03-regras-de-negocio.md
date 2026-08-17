# 03 — Regras de negócio (comercial)

Regra vale mais que ferramenta. Isto é o que o sistema **força** — não o que se espera que alguém lembre. Cada bloco leva o status: 🟢 já acontece · 🔵 em implementação · 🟡 a implementar.

---

## 1. Máquina de estados do funil 🔵

As etapas agora são **editáveis pelo próprio CRM** (tela "Editar etapas"): dá para **renomear, recolorir, reordenar e adicionar/remover**. Elas vivem na tabela `pipeline_stages` e o funil (rank, probabilidade, transição) lê de lá. A configuração **padrão** é:

| # | Estágio (id) | Entra quando | Quem | Status |
|---|---|---|---|---|
| 1 | `novo` | Lead capturado | Naia/sistema | 🔵 |
| 2 | `em_atendimento` | 1º contato feito | Naia | 🔵 |
| 3 | `qualificado` | Passou nos critérios de SQL | Naia | 🔵 |
| 4 | `reuniao_agendada` | Diagnóstico com data no calendário | Naia | 🔵 |
| 5 | `diagnostico_realizado` | Reunião de diagnóstico aconteceu | Rodrigues | 🟢 |
| 6 | `fechamento_agendado` | 2ª reunião marcada | Rodrigues | 🟢 |
| 7 | `proposta_enviada` | Proposta anexada/enviada | Rodrigues | 🟢/🟡 |
| 8 | `negociacao` | Lead respondeu pedindo ajuste | Rodrigues | 🟢 |
| 9 | `ganho` → **Venda** | Venda fechada (função fixa: ganho) | — | 🟢 |
| — | `perdido` | Motivo obrigatório (lista fechada) | — | 🟢 |
| — | `nutricao` | Fit certo, timing errado | — | 🟡 |

**Etapas de função fixa:** `ganho` (rotulada **Venda**), `perdido` e `nutricao` sustentam as regras do funil — dá para movê-las e renomeá-las, mas **não remover nem trocar o papel**. As demais são livres.

**Regra dura:** mudança de estágio só por `fn_move_stage` (valida a transição contra `pipeline_stages`, grava histórico, emite evento). Nunca por edição direta. Cada card carrega um **status**: Em andamento / Vendido / Perdido — derivado do papel da etapa.

## 2. Qualificação do lead 🔵 (a Naia)

No quadro: *"Rodrigues agenda a primeira reunião — isso eu quero botar a IA para cobrir."* **É a Naia.** Ela já atende e preenche parte da qualificação (feita no n8n).

- A Naia atende o lead (WhatsApp), qualifica e agenda a 1ª reunião.
- Ela grava a atividade e move o estágio no sistema (via `fn_log_activity` / `fn_move_stage`).
- O sistema guarda a **qualificação em estrelas (0–5)** no card, além do lead score interno.
- **Em aberto:** a Naia continua no n8n ou vira código dentro do sistema? E como sincroniza com o RD Station? Ver [09](09-decisoes-abertas.md).

## 3. SLA de atendimento + "parado há" 🔵

Lead que espera converte muito menos. Duas medidas:

- **Speed-to-lead** — tempo até o 1º contato (`first_activity - opportunity.created_at`), em `v_sla_breaches` e na tela Hoje. Com a **entrada automática** (foco atual), o cronômetro começa no segundo em que o lead chega.
- **"Parado há X dias"** — cada card mostra há quanto tempo o negócio está sem qualquer interação (mensagem, mudança de etapa, tarefa, nota ou reunião), via `v_deal_parado`. Cor de alerta: **âmbar a partir de 2 dias, vermelho a partir de 5**. É o retrato de "a IA não respondeu, ninguém mexeu, o lead sumiu".

| Origem | 1º contato |
|---|---|
| WhatsApp inbound (Naia) | ≤ 2 min |
| Formulário/LP em horário comercial | ≤ 5 min |
| Indicação | ≤ 15 min |

## 4. Follow-up estruturado 🟡 — **dois tipos**

O quadro mostra que existem dois follow-ups diferentes:

1. **Follow-up focado na qualificação** — cadência de contato até o lead qualificar ou virar nutrição.
2. **Follow-up de reunião, com foco em show rate** — a régua que garante presença nas reuniões.

Ambos serão automatizados. Hoje o "follow-up estruturado" existe de forma manual/parcial.

## 5. Show rate 🟡

A métrica mais subestimada. Para calculá-la, **a agenda precisa estar linkada ao sistema** (as reuniões precisam existir como registro com data). Isso **já está pronto** ✅: a agenda está linkada ao **Google Calendar** (marcar reunião no deal cria o evento com Meet; página "Agenda" no sistema; sync bidirecional). Ou seja, o pré-requisito do show rate está resolvido — falta só a **régua de follow-up** abaixo, que ainda não foi construída.

**Régua por reunião agendada:** confirmação ativa T−24h, lembrete + pré-call T−3h, "estou entrando" T−15min, ligação imediata no T+5min sem presença, marca `no_show` no T+15min.

Show rate = `reuniões realizadas ÷ (realizadas + no-show)`. O sistema já calcula quando as reuniões existem; a **régua automática** é o que falta.

## 6. Reunião de diagnóstico e de fechamento 🟢 → 🟡

Hoje o Rodrigues faz manualmente (🟢). O plano (🟡):

- **Reuniões gravadas e transcritas.**
- A partir da transcrição, a IA extrai: **análise da reunião, melhorias, extração de informação** (dores, decisores, verba, timing, próximo passo).
- Isso alimenta **dois resultados**: o **mapa de objeções** e o preenchimento automático do CRM.
- **Regra dura (futura):** não avança para fechamento sem o diagnóstico registrado.

## 7. Mapa de objeções 🟡

Alimentado sozinho a cada reunião analisada: cada objeção vira uma linha com o verbatim e se matou o deal. Ordenado por **quanto dinheiro cada objeção custou**. Vira insumo para o pitch e para conteúdo.

> **Case ≠ objeção.** O quadro traz "Mapa de objeção & Cases", mas o **case** (resultado do cliente) é do **CS**, não do comercial. Ele é **usado** na reunião de vendas como prova social, mas **não é extraído** dela. Cases entram na fase de CS; aqui o comercial apenas os consome.

## 8. Proposta 🟢/🟡

- Hoje: a proposta é um **documento anexado** ao negócio (versionado, com status). 🟢
- Plano: **proposta estruturada e personalizada por lead** (editável, info centralizada), possivelmente gerada por IA a partir do diagnóstico. 🟡 (pode ser mais intenso de construir — a validar).
- Depois: **geração de contrato e quote** e **onboarding**. 🟡

## 9. Produtos e valor da negociação 🔵

Cada negócio recebe produtos do **catálogo de serviços da Nova Ação** (Sites e Páginas, SEO, Tráfego Pago, E-mail Marketing, Hospedagem, Google Meu Negócio, Identidade Visual), com **quantidade, valor, recorrência (único/mensal) e desconto**. A soma compõe o **Valor total** do deal.

## 10. Copiloto do Rodrigues 🟡

Rodrigues (o único vendedor) chega no chat e pergunta à IA sobre um negócio — ex.: *"me mostra o resumo do diagnóstico do deal X"*, *"por que perdemos o deal Y"*. O copiloto responde a partir dos dados do sistema. Ver [05](05-camada-ia.md).

## 11. Regras de higiene 🔵

- Sem lead órfão: todo lead tem dono.
- Sem estágio parado: deal sem próxima ação/tarefa vira alerta (tela Hoje / `v_stale_deals`).
- Motivo de perda obrigatório, de lista fechada, sempre.
- Nada se apaga: `events` é imutável.
- Duplicata bloqueada na entrada (via `identities`), não limpa depois.
