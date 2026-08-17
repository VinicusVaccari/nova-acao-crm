# 10 — Ingestão de leads (formulários + UTM)

Guia prático para o lead entrar **automaticamente** no CRM (site, landing pages, anúncios), com a origem (UTM) amarrada — em segundos. É o **passo #1** do [roadmap](08-roadmap.md).

## Como funciona (visão geral)

```
[Formulário do site]  ──(webhook, server-side, com chave)──▶  POST /api/ingest/lead
        ▲                                                              │
   GTM injeta utm_*/gclid/fbclid                                       ▼
   em campos ocultos                                           fn_ingest_lead
                                                     (une identidade · cria negócio ·
                                                      grava UTM em touchpoints · evento)
                                                                       │
                                                                       ▼
                                                            Lead no CRM em segundos
```

## Pré-requisito: publicar o sistema

O endpoint só recebe de fora quando o sistema estiver numa **URL pública** (deploy na Vercel + domínio, ex.: `https://crm.agencianovaacao.com.br`). Enquanto estiver em `localhost`, nada externo alcança.

## Contrato do endpoint

- **URL:** `https://SEU-DOMINIO/api/ingest/lead`
- **Método:** `POST`
- **Headers:** `Content-Type: application/json` · `x-api-key: <INGEST_API_KEY>`
- **Corpo (JSON):** ao menos **`phone` ou `email`**. Campos aceitos:

| Campo | Exemplo | Observação |
|---|---|---|
| `name` | "Maria Silva" | |
| `email` | "maria@empresa.com" | phone ou email obrigatório |
| `phone` | "+5511998887777" | idem |
| `company_name` / `cnpj` | "Empresa X" | opcional (cria a empresa) |
| `channel` | "site" / "landing" / "indicacao" | origem macro |
| `utm_source/medium/campaign/content/term` | "google", "cpc"… | rastreamento |
| `gclid` / `fbclid` / `ga_client_id` | id de clique | atribuição por plataforma |
| `campaign_id` / `adset_id` / `ad_id` | ids do anúncio | opcional |
| `landing_page` / `referrer` | URL | de onde veio |

> **Segurança:** a `x-api-key` **fica no lado servidor** (config do plugin de formulário ou backend do site) — **nunca** no HTML/JS público da página. As UTMs, sim, podem estar no cliente (não são segredo).

## Passo 1 — Capturar UTM na página (Google Tag Manager)

Uma tag de **HTML personalizado** que dispara em todas as páginas: guarda os parâmetros da URL num cookie e preenche campos ocultos do formulário.

```html
<script>
(function () {
  var params = new URLSearchParams(location.search);
  var keys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid'];
  keys.forEach(function (k) {
    var v = params.get(k);
    if (v) document.cookie = k + '=' + encodeURIComponent(v) + ';path=/;max-age=' + 60*60*24*90;
  });
  function cookie(k){ var m = document.cookie.match('(^|;)\\s*'+k+'\\s*=\\s*([^;]+)'); return m ? decodeURIComponent(m.pop()) : ''; }
  // preenche <input type="hidden" name="utm_source"> etc. no envio
  document.addEventListener('submit', function (e) {
    keys.forEach(function (k) {
      var f = e.target.querySelector('[name="'+k+'"]');
      if (f && !f.value) f.value = cookie(k);
    });
  }, true);
})();
</script>
```

No formulário, criar os campos ocultos: `utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid`.

## Passo 2 — Enviar o formulário ao endpoint

### A. WordPress / Elementor Pro / WPForms (mais comum)
Usar a ação **Webhook** do formulário:
- **URL:** `https://SEU-DOMINIO/api/ingest/lead`
- **Header:** `x-api-key: <chave>` (no campo de headers do plugin — fica server-side)
- **Mapear campos** do form → `name`, `email`, `phone`, e os `utm_*`.

### B. RD landing pages / outro builder
Se tiver ação de webhook, mesma coisa. Se não tiver, usamos o **n8n como ponte** (o RD/anúncio manda pro n8n → n8n repassa pro endpoint) — atalho enquanto migramos.

### C. Site custom (com backend)
O backend do site recebe o form e faz o `POST` server-side com a chave. Exemplo:

```js
await fetch('https://SEU-DOMINIO/api/ingest/lead', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.INGEST_API_KEY },
  body: JSON.stringify({ name, email, phone, channel: 'site',
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, gclid, fbclid,
    landing_page: location.href }),
})
```

## Passo 3 — Anúncios (depois do site)

- **Meta Lead Ads:** webhook de `leadgen` → busca o lead → `POST` no endpoint (via app Meta ou pelo n8n, que já tem as credenciais).
- **Google Ads (lead form):** no formulário do anúncio, o "webhook URL" = nosso endpoint + a chave.

## Rede de segurança na virada

Enquanto valida, o lead entra **no nosso sistema E no RD ao mesmo tempo** (o webhook do form dispara para os dois). Só desliga o RD quando confiar — **zero risco de perder lead**.

## Checklist da reunião

- [ ] Plataforma do site/LP (WordPress/Elementor? RD? custom?)
- [ ] Quais formulários entram primeiro
- [ ] Quem tem acesso ao site e ao Google Tag Manager
- [ ] Domínio/subdomínio + quem gerencia o DNS
- [ ] Manter RD em paralelo no início? (recomendado: sim)
