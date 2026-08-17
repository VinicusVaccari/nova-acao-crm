# 02b — O modelo de dados explicado sem jargão (comercial)

O doc [02](02-modelo-de-dados.md) tem os detalhes técnicos. Aqui é o "por quê" de cada coisa, em português simples.

## A ideia em uma frase

O sistema é um **prontuário do negócio**. Cada lead do comercial tem uma ficha, e tudo que acontece com ele — de onde veio, o que a Naia conversou, o que foi dito na reunião, a proposta, os produtos, as tarefas — fica na mesma ficha, para sempre.

O que separa isso de uma planilha (ou do RD Station solto) são **quatro gavetas**.

---

## Gaveta 1 — QUEM É

### `people` + `identities` — a pessoa e seus "documentos"
O mesmo lead aparece de várias formas: a Naia fala com ele no **WhatsApp** (`wa_id`), ele deixou um **e-mail** no formulário, tem um **telefone**. Sem unir isso, viram três leads diferentes. A tabela `identities` guarda todos os identificadores apontando para a mesma pessoa — é o que evita duplicata e liga tudo.

### `companies` + `person_company` — a empresa e o vínculo
Você vende para a empresa, mas conversa com a pessoa. Separado porque numa empresa pode haver mais de um contato.

## Gaveta 2 — A NEGOCIAÇÃO (o funil)

### `opportunities` — o card do kanban
É o negócio em si: etapa, valor, qualificação (as estrelas de 0–5), responsável (Rodrigues), quem qualificou (Naia). **É o CRM propriamente dito** — o que hoje está no RD Station.

### `pipeline_stages` — as etapas do funil, editáveis por você
As colunas do kanban não são mais "chumbadas" no código: viraram uma tabela. Dá para **renomear, trocar a cor, reordenar e até criar/apagar** etapas pelo próprio CRM (tela "Editar etapas"). Três delas têm papel fixo e não podem ser removidas: **Venda** (o ganho), **Perdido** e **Nutrição** — dá para mover e renomear, mas a função é travada. Cada card também mostra **"parado há X dias"**: o tempo desde a última coisa que aconteceu no negócio (mensagem, mudança de etapa, tarefa, nota ou reunião) — vermelho quando ninguém mexe há muito tempo.

### `stage_history` — a fita cassete do card
Toda vez que o card muda de etapa, grava uma linha. É o que responde "qual etapa trava?", "quanto tempo fica em proposta?", "agosto foi melhor que julho?". Todo relatório de conversão nasce aqui.

### `activities` — a timeline de contatos
Cada WhatsApp, ligação, e-mail. **É o que a Naia preenche automaticamente.** Daqui sai o **speed to lead** (quanto tempo até o primeiro contato), medido pelo sistema, sem ninguém digitar.

### `meetings` — as reuniões
Diagnóstico, fechamento, follow-up — com status (realizada / no-show). É daqui que sai o **show rate**. Cada reunião fica **linkada ao Google Calendar**: agendar no deal cria o evento com link do Meet, e se você apagar/remarcar no Google, o deal se ajusta. No futuro, essas reuniões serão **gravadas e transcritas**, e isso alimenta o mapa de objeções.

### `objections` + `objection_occurrences` — o Mapa de Objeções vivo
O catálogo de objeções e cada vez que uma apareceu numa call, com a frase exata que o lead falou e se aquilo matou o negócio. É o **Mapa de Objeções** do quadro, preenchendo-se sozinho a cada reunião analisada.

> **Sobre os "Cases":** no quadro aparece "Mapa de objeção & Cases", mas são coisas diferentes. O **case** (resultado do cliente virando prova) **pertence ao CS** — ele é *usado* na reunião de vendas como prova social, mas **não é extraído** da reunião. Cases entram quando abrirmos a área de CS.

### `touchpoints` — de onde veio
O rastro do lead (canal, campanha). Aparece na ficha em "De onde veio".

## Gaveta 3 — DENTRO DA FICHA

Tudo que o Rodrigues (ou a Naia) anexa ao negócio:

- **`notes`** — anotações livres.
- **`tasks`** — tarefas (ligar, mandar proposta…), com prazo e responsável. A próxima tarefa em aberto vira o "próximo passo" que aparece na tela **Hoje**.
- **`proposals`** — a **proposta é um documento anexado** (PDF), versionado, com status aceita/recusada.
- **`products` + `opportunity_products`** — os serviços da Nova Ação que o lead vai contratar (quantidade, valor, recorrência, desconto). A soma vira o **Valor total** do negócio.
- **`deal_files`** — quaisquer arquivos do negócio.

## Gaveta 4 — A ESPINHA (não aparece na tela, sustenta tudo)

- **`events`** — diário de bordo: registra cada coisa relevante, para sempre. Serve para auditar e para análises futuras.
- **`outbox`** — fila para devolver vendas ao Meta/Google (o loop de mídia). **Está congelada** — só liga quando entrarmos em marketing.
- **`calendar_accounts`** — a "chave" da conexão com o Google Calendar (guardada só no servidor, nunca no navegador). É o que deixa a Agenda funcionar.

---

## Como isso conversa com a Naia e o RD Station

- A **Naia** (SDR no n8n) lê o contexto do lead com `fn_sdr_context(telefone)` — numa chamada ela sabe quem é, de onde veio e o histórico — e grava o que faz com `fn_log_activity` e `fn_move_stage`. **O próximo passo é conectá-la ao sistema via Z-API** (WhatsApp), pra ela operar direto na nossa base.
- O **RD Station** é de onde os negócios vêm hoje; o plano é sincronizar/migrar (a definir). A dor dele — lead demora a entrar — é o que o foco atual resolve: **site/anúncios/UTM caindo no CRM em segundos**.

## Por onde começamos

O núcleo mínimo que já roda o comercial: `people`, `identities`, `companies`, `opportunities`, `stage_history`, `activities`, `meetings` — mais a ficha (`notes`, `tasks`, `proposals`, `products`, `deal_files`). Tudo isso **já está de pé**.
