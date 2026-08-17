# 05 — Camada de IA (comercial)

A IA no comercial da Nova Ação. Uma parte **já existe** (a Naia); o resto é o plano. Princípio: a IA elimina o trabalho de digitar, lembrar e procurar — o Rodrigues deve gastar 100% do tempo vendendo.

## 1. Naia — SDR / qualificação 🔵 (já existe, integrando ao sistema)

A IA que já roda, feita no **n8n**.

- **Onde:** WhatsApp. Atende o lead e faz a qualificação.
- **Faz:** responde, qualifica, agenda a primeira reunião, e preenche parte da qualificação no sistema.
- **Integração:** lê o contexto com `fn_sdr_context`, grava com `fn_log_activity` / `fn_move_stage`.
- **🔵 Foco agora — conectar a Naia ao sistema:** o WhatsApp passa a entrar pela **Z-API** e a Naia ganha as integrações para **operar sobre a nossa base** (contexto, resposta, atividade, etapa), mudando o fluxo atual. Assim a IA deixa de viver isolada e o estado é sempre o do Supabase — seja a lógica no n8n ou em código.

## 2. Análise de reunião 🟡 (a implementar)

O que mais devolve tempo ao Rodrigues.

- **Entrada:** transcrição da reunião (diagnóstico/fechamento) — as reuniões passam a ser **gravadas e transcritas**.
- **Saída:** análise da reunião, melhorias, e extração de informação — dores (com o verbatim), estado atual, decisores, sinais de verba e timing, próximo passo.
- **Dois destinos:**
  1. Preenche o CRM automaticamente (o Rodrigues só revisa).
  2. Alimenta o **mapa de objeções** (`objection_occurrences`). *(Cases não saem daqui — são do CS; a reunião só os usa como prova.)*

## 3. Copiloto do Rodrigues 🟡

Como Rodrigues é o único do comercial, ele conversa com a IA no chat do sistema:

- *"Me mostra o resumo do diagnóstico do deal X."*
- *"Por que perdemos o deal Y?"*
- *"Quais objeções mais mataram vendas este mês?"*

O copiloto responde a partir dos dados do sistema (somente leitura, sobre as views). Pode ser a própria Naia estendida ou um copiloto separado — a definir.

## 4. Proposta personalizada por lead 🟡

Gerar a proposta a partir do diagnóstico, nas palavras do próprio lead, com o escopo/preço do catálogo. Editável e com a info centralizada. *Pode ser mais intenso de construir — a validar se entra cedo ou depois.*

## 5. Follow-up contextual 🟡

Mensagens de follow-up que referenciam o que foi dito na reunião (não "passando para saber se viu"). Para os dois tipos de follow-up (qualificação e show rate).

---

## Engenharia dos agentes (quando entrarmos com Claude)

- **Saída estruturada** (JSON validado por schema), nunca texto livre parseado.
- **Versionamento de prompt** no git; cada execução registra qual versão rodou.
- **Escada de autonomia:** sombra → sugestão → autonomia com limiar → autônomo com auditoria. Nada nasce autônomo; sobe de degrau com dado medido.
- **Auditoria de custo e de correções** — quando um humano corrige a saída, a correção volta para melhorar o prompt.

## Estado hoje

- 🔵 **Naia** rodando (qualificação/atendimento, no n8n) — **em integração ao sistema via Z-API** (foco atual).
- 🟡 Análise de reunião, copiloto, proposta e follow-up — **planejados** (dependem de: chave da API do Claude, gravação/transcrição de reunião, e a decisão n8n × código).
