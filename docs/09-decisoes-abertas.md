# 09 — Decisões em aberto (comercial)

O que precisa da tua definição. Atualizado para o foco comercial e a operação real.

## Foco atual — a entrada do lead (Z-API, Naia, ingestão)

**0a. Z-API — conta e números.** Qual instância/plano da Z-API, qual número de WhatsApp, e quem administra? É o canal que substitui a caixa-preta atual do WhatsApp no n8n.
→ *Impacto: sem isso, a Naia não passa a operar pelo sistema.*

**0b. Fluxo da Naia ao conectar no sistema.** Com a Z-API no meio, a Naia continua com a lógica no n8n (chamando nossas funções) ou migra para código? O que ela lê/escreve muda? (ver #1). Precisamos do desenho do novo fluxo: mensagem chega → contexto → resposta → atividade/etapa.

**0c. Fontes de ingestão automática.** Quais entram primeiro: **site/formulário**, **anúncios** (Meta/Google lead ads), indicação? Cada uma chama `/api/ingest/lead`. Precisamos das credenciais/endpoints de cada fonte.

**0d. UTMs — padrão de captura.** Como as UTMs chegam (querystring no site, campos do lead ad, parâmetros do anúncio)? Padronizar `utm_source/medium/campaign/content` + ids de clique (`fbclid`/`gclid`) para amarrar origem ao negócio.

## As duas que travam o resto

**1. A Naia (SDR) continua no n8n ou vira código dentro do sistema?**
Hoje a Naia roda no n8n e funciona. Direção atual: **conectá-la via Z-API** e dar as integrações para operar na base — mantendo a lógica no n8n (pluga via `fn_sdr_context`/`fn_log_activity`) **ou** reescrevendo como serviço em código (Next + Claude). O canal e o estado já passam a ser nossos; a casa da lógica é o que falta cravar.
→ *Impacto: define onde as automações comerciais vivem. O banco funciona dos dois jeitos.*

**2. Como sincronizar com o RD Station?**
O RD Station tem os negócios de hoje. Opções: (a) importar uma vez, (b) sincronização contínua via API, (c) migrar de vez e aposentar o RD.
→ *Precisa definir antes de considerar o sistema a fonte da verdade do comercial.*

## Qualificação / Naia

**3. O que exatamente a Naia grava no sistema?** Ela já preenche "parte da qualificação". Precisamos alinhar quais campos (estrelas, critérios, próximo passo) ela escreve e em que estágio ela deixa o lead.

**4. Critérios de qualificação (SQL).** Faturamento mínimo, verba mínima, segmentos atendidos, blocklist — para o score/estrelas fazer sentido.

## Reuniões e IA

**5. Ferramenta de reunião e transcrição.** Google Meet/Zoom? Já grava? Como a transcrição chega ao sistema? (pré-requisito da análise de reunião e do mapa de objeções). Aviso de gravação — LGPD.

**6. Chave da API do Claude.** Necessária para ligar análise de reunião, copiloto e proposta.

**7. Copiloto do Rodrigues:** é a Naia estendida ou um assistente separado no sistema?

## Proposta / fechamento

**8. Proposta personalizada por IA** — entra cedo ou depois? (pode ser mais custosa de construir).

**9. Assinatura eletrônica / contrato** — Autentique, Clicksign, D4Sign ou nenhum hoje?

## Agenda / show rate

**10. Linkar a agenda — ✅ FEITO: Google Calendar.** Já está em produção: agendar reunião no deal cria o evento (com Meet), a página "Agenda" mostra a semana, e o sync é **bidirecional** (apagar/remarcar no Google reflete no deal ao abrir a ficha). Conexão hoje é **única** (conta `novaacaomkt@gmail.com`). Sobra uma decisão:
- **Naia agendando:** quando a Naia agenda a 1ª reunião, ela cria direto no Calendar (via mesma integração) ou grava a reunião no sistema e o sistema propaga para o Calendar? *(Recomendado: gravar no sistema → o sistema cria o evento, reaproveitando o que já existe.)*

## Dados

**11. Histórico do RD Station** — quanto tempo de histórico importar? Isso define se dá para calcular conversão por etapa já na largada ou se acumula 60 dias.

---

## Riscos mapeados

| Risco | Mitigação |
|---|---|
| Lógica comercial espalhada entre n8n e sistema | Decidir n8n × código cedo; manter o estado só no Supabase |
| Naia e sistema desalinhados (dado dobrado/furado) | Contrato claro do que a Naia escreve; funções únicas de escrita |
| Rodrigues não adotar e voltar pro RD Station | O sistema tem que **poupar** trabalho já — entrada rápida do lead, preenchimento automático, ficha completa |
| Lead demorar a entrar (dor da RD) | Ingestão direta (`fn_ingest_lead`) por site/ads/UTM, sem intermediário — lead no CRM em segundos |
| Dependência da Z-API (canal) | Estado sempre no Supabase; Z-API é só transporte — trocável sem perder dados |
| LGPD (gravação de reunião) | Base legal, aviso de gravação, retenção |
