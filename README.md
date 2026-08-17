# Sistema Operacional Nova Ação — Comercial

Sistema que **unifica a operação comercial** da Nova Ação: da qualificação do lead ao fechamento da venda, numa única espinha de dados.

> **Escopo atual: só o comercial (vendas).** Marketing, CS e advocacy ficam para depois. A meta não é unificar *tudo* — é unificar **o máximo possível do comercial** primeiro, e só então expandir para as outras áreas.

## Por que este sistema existe

A operação da Nova Ação hoje funciona, mas **cada coisa vive de um lado**:

- A **qualificação do lead já é automatizada** por uma IA chamada **Naia** (um SDR feito no **n8n**) — ela atende e preenche parte da qualificação.
- O CRM em uso é o **RD Station**.
- Existem **alguns dashboards**, mas espalhados e desconectados.

O resultado é uma operação que funciona em ilhas. Este sistema junta essas ilhas numa espinha só, começando pelo comercial, e conecta o que já existe (Naia, RD Station) em vez de jogar fora.

**Rodrigues é o único vendedor do comercial hoje** — ele assume o lead qualificado, faz a reunião de diagnóstico, o fechamento e a venda.

## Legenda de status (a mesma do quadro da operação)

Cada parte do processo tem um estado, e a documentação usa essas marcas:

- 🟢 **Verde — Já acontece hoje**, mas **sem IA/automação** (é manual). Ex.: Rodrigues assume, reunião de diagnóstico, reunião de fechamento, venda.
- 🔵 **Azul — Em implementação agora**, já com IA/automação sendo desenvolvida. Ex.: qualificação do lead (atendimento + SDR/Naia) e o próprio CRM/sistema (preenchimento por lead, pipeline, métricas).
- 🟡 **Amarelo — A implementar**, será com IA/automação mas ainda não começou. Ex.: mapa de objeções, análise de reunião, follow-up com foco em show rate, proposta personalizada por lead, geração de contrato, onboarding.

## O funil comercial (do quadro)

```
Qualificação do lead        Rodrigues      Reunião          Reunião                    Venda
(Atendimento + SDR/Naia) →  assume    →   Diagnóstico  →   Fechamento   → … →         (fechamento)
        🔵                    🟢            🟢               🟢                          🟢
        │                     │             │                │                           │
   Follow-up 🟡          CRM/sistema 🔵   Reunião de      Follow-up               Proposta 🟡
   estruturado          (preenche, mede)  vendas 🟡      show rate 🟡           personalizada
                                          (análise +     (mapa de                   + contrato/
                                           transcrição)   objeções) 🟡              quote 🟡
```

> **Case ≠ comercial.** No quadro aparece "Mapa de objeção & Cases", mas o **case** (resultado do cliente) é do **CS** — é *usado* na reunião de vendas como prova, mas **não é extraído** dela. O que a reunião produz é o **mapa de objeções**. Cases entram na fase de CS.

## Stack

| Camada | Escolha | Papel |
|---|---|---|
| Fonte da verdade | **Supabase** (Postgres + Auth + Storage) | Todo o estado do comercial vive aqui |
| Interface | **Next.js + shadcn/ui (Vercel)** | O sistema — pipeline, ficha do lead, dashboards |
| SDR / qualificação | **Naia (n8n)** — *hoje* | Atendimento e qualificação automática |
| CRM atual | **RD Station** | De onde vamos sincronizar / migrar dados |
| Inteligência | **Claude (API)** | Análise de reunião, copiloto, proposta (a implementar) |

### Duas decisões em aberto que atravessam tudo

1. **O SDR (Naia) continua no n8n ou vai para código dentro do sistema?** Ainda indefinido. Os docs assumem os dois caminhos possíveis.
2. **Como o sistema sincroniza com o RD Station e com a Naia?** A definir — ver [09](docs/09-decisoes-abertas.md).

## O que já está construído (neste sistema)

- **Pipeline kanban** com etapas **editáveis pelo próprio CRM** (renomear, recolorir, reordenar, **adicionar/remover**) — a etapa **Venda** é fixa (o ganho). Cada card mostra **"parado há X dias"** (tempo desde a última interação).
- **Ficha do lead** completa: negociação/contato/empresa editáveis, histórico, anotações, tarefas, reuniões, propostas (documento), produtos, arquivos. Contato com **atalhos de WhatsApp/copiar/abrir nas Mensagens**.
- **Tela de Mensagens** (inbox) com painel de contexto editável.
- **Agenda linkada ao Google Calendar** ✅: marcar reunião no deal cria o evento (com Meet), a página "Agenda" mostra a semana, e o vínculo é **bidirecional** (apagou/remarcou no Google → reflete no deal).
- **Dashboards comerciais** e **ingestão de lead por API**.

Detalhe em [08 — Roadmap](docs/08-roadmap.md).

**Foco agora 🔵 — a entrada do lead, rápida e automática.** O que a RD Station faz mal (lead demora muito a aparecer no CRM), aqui é prioridade:
- **Conectar a Z-API** (WhatsApp) e ligar a **Naia** ao sistema — mudando o fluxo para a IA operar direto na nossa base.
- **Ingestão automática de leads**, como um CRM de verdade: **site/formulário, anúncios e UTMs** caem direto no CRM.
- **UTMs rastreadas de ponta a ponta** (origem do lead amarrada ao negócio).
- **Velocidade de entrada**: o lead aparece no CRM em segundos, não em minutos/horas.

## Documentação

| Doc | Conteúdo |
|---|---|
| [01 — Arquitetura](docs/01-arquitetura.md) | Camadas, Naia/n8n, sincronismo com RD Station, princípios |
| [02 — Modelo de dados](docs/02-modelo-de-dados.md) | Schema comercial implementado no Supabase |
| [02b — Modelo explicado](docs/02b-modelo-explicado.md) | O modelo em linguagem simples |
| [03 — Regras de negócio](docs/03-regras-de-negocio.md) | Estágios, SLA, qualificação, show rate, propostas, produtos |
| [04 — Automações](docs/04-automacoes-n8n.md) | Naia (SDR), automações comerciais, n8n × código |
| [05 — Camada de IA](docs/05-camada-ia.md) | Naia, análise de reunião, copiloto do Rodrigues, proposta |
| [07 — Métricas](docs/07-metricas.md) | KPIs do comercial |
| [08 — Roadmap](docs/08-roadmap.md) | O que existe, o que está sendo feito, o que vem |
| [09 — Decisões em aberto](docs/09-decisoes-abertas.md) | O que precisa de definição |
