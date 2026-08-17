# 07 — Métricas (comercial)

Só métricas do comercial. Marketing (CAC, ROI de mídia) e CS (churn, NRR) voltam quando abrirmos essas áreas.

## O painel comercial (a imagem que o Rodrigues/gestão olha)

Calculado por `fn_dash_comercial(de, até)` e `fn_funnel_series`. Estes são os KPIs do funil:

| Métrica | Cálculo | Meta | Status |
|---|---|---|---|
| Leads | volume por período | — | 🔵 |
| **Speed to lead** | mediana `1º contato − criação` | ≤ 5 min | 🔵 (fica preciso com a entrada automática) |
| **Parado há** | dias desde a última interação (`v_deal_parado`) | alerta 2d/5d | ✅ (no card) |
| TX qualificação (MQL→SQL) | qualificados ÷ leads | > 35% | 🔵 |
| TX agendamento | agendados ÷ qualificados | > 60% | 🔵 |
| **Show rate** | realizadas ÷ (realizadas + no-show) | > 75% | 🟡 régua (agenda já linkada ✅) |
| Conversão reunião → proposta | propostas ÷ diagnósticos | > 65% | 🔵 |
| **Win rate** | ganhos ÷ propostas | > 30% | 🔵 |
| Ticket médio (contrato) | média do valor dos ganhos | — | 🔵 |
| Ciclo de venda | mediana lead→ganho | ≤ 21 dias | 🔵 |
| Receita fechada | soma dos contratos ganhos | — | 🔵 |
| Pipeline ponderado | Σ valor × probabilidade | — | 🔵 |

## Diagnóstico rápido por etapa que trava

| Onde trava | Causa provável |
|---|---|
| Lead → contato | SLA (a Naia/atendimento demorou) |
| Contato → qualificado | lead fora do perfil chegando |
| Qualificado → agendado | oferta da reunião fraca / sem urgência |
| Agendado → realizado | show rate: confirmação, intervalo longo, sem pré-call |
| Realizado → proposta | diagnóstico raso |
| Proposta → ganho | preço, prova social, ou objeção não tratada |

## Mapa de objeções 🟡

`v_objection_map`: objeções por frequência × **quanto dinheiro cada uma custou** (deals mortos) × segmento. É o "por que a gente perde" com número, não achismo. Depende da análise de reunião estar ativa.

## Por vendedor (Rodrigues, e o time quando crescer)

`fn_dash_por_vendedor`: leads, reuniões, propostas, vendas, win rate, ticket médio, ciclo, speed to lead.

## Ritmo de leitura

| Cadência | O quê |
|---|---|
| **Diário** (tela Hoje / pipeline) | leads sem contato (SLA), **cards parados há X dias** (âmbar 2d / vermelho 5d), reuniões próximas, ações vencidas |
| **Semanal** | funil completo, top objeções, deals travados |
| **Mensal** | unit economics do comercial, produtividade |

**Regra:** métrica que ninguém olha em ritmo definido não existe. Melhor poucas métricas vivas do que um dashboard morto (que é o problema de hoje: dashboards espalhados).
