# 11 — WhatsApp Hub (Z-API + Naia)

O app é o **hub**. A Z-API é só transporte; a Naia (n8n) é o "cérebro" plugável. Fluxo:

```
WhatsApp → Z-API → /api/whatsapp/inbound → (loga + decide) → Naia (n8n) → /api/whatsapp/reply → Z-API → WhatsApp
                                                          └→ ou humano responde (sistema/na mão)
```

## Endpoints

- **`POST /api/whatsapp/inbound?secret=…`** — webhook da Z-API ("ao receber" **e** "ao enviar/notificar enviadas por mim"). Loga a mensagem no inbox, resolve/cria o lead, e decide quem responde.
- **`POST /api/whatsapp/reply?secret=…`** — a Naia (n8n) chama aqui para **enviar** a resposta. Tudo que vem do n8n é da Naia (`is_automated=true`).

Rotas públicas no `proxy.ts` (`/api/whatsapp`, `/api/ingest`, `/convite`), cada uma protegida por segredo próprio.

## Quem responde (gate no inbound)

- `fromMe=false` (mensagem do lead): loga inbound. Se **não travado** → aciona a Naia. Exceção: **número de teste** (`numeros_teste`) sempre aciona, mesmo travado (para rodar `#reset` no n8n).
- `fromMe=true` + **`fromApi=true`**: eco do que o próprio sistema/Naia enviou → **ignora** (já logamos no envio).
- `fromMe=true` + **`fromApi=false`**: o **Rodrigues digitou na mão** no WhatsApp → loga como outbound humano + **intervenção** (a Naia para). `fromApi` é o sinal decisivo; há um dedup por conteúdo como rede de segurança.

## Trava vs. intervenção

Tabela `"CADASTRO N8N | NOVA AÇÃO"` (migrada do projeto n8n antigo) controla a trava. Regra: **travado = permanente** (uma vez travado, a Naia não volta).

- **`trava`** = a Naia fechou o lead (tool de encerramento dela).
- **`intervenção`** = um humano mandou mensagem no meio da execução (botão "Assumir" ou envio pelo sistema, ou resposta na mão).
- `fn_trava_status(phone)` = existe linha com (`trava` OR `intervenção`) para o telefone (normalizado só por dígitos). `fn_intervencao(phone, name)` faz **UPDATE** na linha existente (não duplica).
- `numeros_teste` — números que **sempre** chegam ao n8n mesmo travados (para testes/`#reset`). Não mexe no badge, só no gate.

## LID ↔ telefone

O WhatsApp passou a identificar contatos por **LID** (ex.: `152291554422899@lid`) em vez do telefone, principalmente em mensagens `fromMe`. O cadastro já guarda `phone` + `chatlid`, então:

- `fn_phone_from_lid(lid)` — converte o `@lid` no telefone real (busca no `chatlid` do cadastro).
- `fn_set_chatlid(phone, lid, name)` — grava/atualiza o `chatlid` quando chegam telefone + lid juntos (o mapa cresce sozinho; o n8n também alimenta).

`parseZapiInbound` extrai `phone`, `lid`, `fromApi`, `messageId`, `tipo` (text/audio/image) e filtra grupos (`@g.us`/120363), tratando `@lid` como contato 1:1 (não grupo).

## Áudio

Mensagens de áudio (`tipo='audio'`) chegam com uma URL **temporária** da Z-API (Backblaze). O `/inbound` **baixa e re-hospeda** no Storage (`bucket wa-media`, público) e guarda a URL permanente no `meta.audioUrl`. O inbox mostra um **player estilo mensagem de voz** (play/pause, ondas, bolinha de progresso).

## Envio

`enviarWhatsapp(telefone, mensagem, delayTyping)` (Z-API `send-text` com `Client-Token`) devolve o `messageId`. Envios humanos pelo sistema gravam **intervenção** e logam outbound não-automatizado; a Naia loga outbound automatizado.

## Variáveis de ambiente

`ZAPI_INSTANCE`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`, `ZAPI_BASE_URL`, `NAIA_WEBHOOK_URL`, `WHATSAPP_WEBHOOK_SECRET`.

## Em aberto

- Dar à Naia ferramentas para **operar a base** (mover etapa, agendar, etc.), não só responder.
- Simplificar o fluxo n8n agora que o app é o hub (a trava/cadastro pode passar a ser lida do app).
- `wa_webhook_log` é uma tabela de **diagnóstico** (log cru dos webhooks) — pode ser podada/removida depois.
