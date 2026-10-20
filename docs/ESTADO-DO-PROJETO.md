# CRM Nova Ação — estado do projeto

Atualizado em 19/10/2026. Este arquivo registra o que foi feito depois da perda do computador antigo, o porquê de cada mudança, as migrations aplicadas e as que faltam. Ao recuperar o computador antigo, use o checklist no final.

## Resumo

- O computador com o projeto foi perdido. O código do CRM foi recuperado do deploy em produção na Vercel (`dpl_2NK7MNXDBtdDSZRui3mkz7cw6tXW`) e salvo no GitHub em `VinicusVaccari/nova-acao-crm` (commit `a962572`).
- O WhatsApp foi reconectado numa instância nova da Z-API. Entrada e saída de mensagens foram testadas e funcionam.
- Decisão da call "Analise Google Ads" (19/10/2026): leads das LPs novas não são atendidos por nenhum agente (Naia, LUNA, MEL). Vão direto para o Rodrigues, avisados num grupo de WhatsApp, com um teste 50/50 de primeiro contato (ligação × mensagem).
- Tudo isso está em produção desde 19/10/2026 e foi validado com um lead real de teste (depois apagado).

## Onde está cada coisa

| O quê | Onde | Observação |
| --- | --- | --- |
| Código do CRM | GitHub `VinicusVaccari/nova-acao-crm`, branch `main` | App Next.js em `web/`, SQL em `supabase/`, testes em `scripts/` |
| Código do site | GitHub `VinicusVaccari/nova-acao-site`, branch `main` | LPs novas em `/lp/...` |
| CRM em produção | Vercel, time `vaccari`, projeto `nova-acao-crm` → https://nova-acao-crm.vercel.app | **Não** publica sozinho pelo GitHub. Deploy pela CLI, dentro de `web/`: `vercel deploy --prod --scope vaccari` |
| Site em produção | Vercel, time `vaccari`, projeto `nova_a-o_refazer_site` → https://novaa-orefazersite.vercel.app | Ligado ao GitHub: push no `main` publica |
| Banco | Supabase, projeto `qfrelmuxakfftadjufxg` (sa-east-1) | Pooler `aws-0-sa-east-1.pooler.supabase.com:5432` |
| WhatsApp | Z-API, instância nova (desde 19/10/2026) | Credenciais nas variáveis `ZAPI_*` do projeto CRM na Vercel |
| Grupo de aviso | WhatsApp "Aviso de Lead (LPs novas)", ID `120363429271213364-group` | ID guardado no cofre do Supabase como `lp_aviso_grupo_whatsapp` |
| Ambiente de teste local | `C:\Users\vinic\.crm-teste` (fora dos repositórios) | Supabase de teste (outra conta), Z-API e Naia falsas, scripts. Ver seção "Como publicar" |

Pessoas no CRM (tabela `profiles`): Rodrigues `8e4d1d15-77b2-4808-9e90-7d4e92d41e0c` (vendedor) · Naia (IA) `cc6e3827-e69f-41e1-aee6-502ad5912ca1`.

## O que fizemos e por quê

### 1. Lead de LP nova vai para o Rodrigues, sem agente

**Por quê:** o formulário das LPs novas já qualifica o lead (investimento atual, orçamento, dor principal). O comercial quer falar direto com ele, sem a Naia fazer o primeiro contato.

**Como funciona:**
- `fn_ingest_lead` reconhece lead de LP nova pela `landing_page` que começa em `/lp/` (com ou sem domínio).
- No mesmo insert que cria o negócio, grava `opportunities.atendimento = 'humano'` e dono = Rodrigues. Se fosse um update separado, uma falha no meio deixaria a Naia chamar o lead em 5 minutos.
- A fila do 1º contato da Naia (`fn_leads_para_outreach`) só pega `atendimento = 'naia'`.
- No código: o webhook de WhatsApp (`web/app/api/whatsapp/inbound/route.ts`) não aciona Naia nem LUNA para negócio `humano`. Os lembretes da LUNA (`web/app/api/luna/lembretes/executar/route.ts`) e a conversa da LUNA (`web/lib/agentes/luna/conversa.ts`) também respeitam isso. O MEL já só age em negócio cujo dono é a Naia.
- Lead que volta (mesma pessoa, negócio aberto) cai no negócio que já existe e continua com quem já atende.
- Formulários antigos (sem `/lp/`) continuam exatamente como antes, com a Naia.

### 2. Etiquetas "Rodrigues" e "Você"

**Por quê:** as etiquetas só olhavam a trava do telefone, então o lead de LP nova aparecia como "Naia" mesmo sem agente nenhum.

**Como funciona:** `atendimento = 'humano'` também conta. No pipeline o card mostra "Rodrigues" (`web/lib/crm.ts`); em Mensagens a conversa mostra "Você" (`web/lib/mensagens.ts`, `web/components/inbox.tsx`).

### 3. Aviso no grupo "Aviso de Lead (LPs novas)"

**Por quê:** como nenhum agente atende, o Rodrigues precisa saber do lead na hora.

**Como funciona:**
- A rota de entrada (`web/app/api/ingest/lead/route.ts`) chama `avisarGrupoLpNova` (`web/lib/lp-nova.ts`) só para negócio **novo** de LP nova, depois de responder ao formulário.
- O ID do grupo vem do cofre (`fn_lp_aviso_grupo_whatsapp`), no mesmo modelo do grupo da LUNA.
- Cada tentativa fica em `automation_runs` (workflow `lp_nova_aviso_grupo`). Se o envio falhar, o lead entra igual e a falha fica registrada.
- Mensagem: nome da LP, nome, WhatsApp, empresa e site, respostas do formulário, origem (UTMs), tipo de primeiro contato e link do lead.

### 4. Teste 50/50 de primeiro contato

**Por quê:** pedido na call de 19/10 — descobrir se o lead de LP converte mais quando o primeiro contato é ligação ou mensagem.

**Como funciona:**
- Sorteio alternado (ligação, mensagem, ligação…) dentro de `fn_ingest_lead`, com trava (`pg_advisory_xact_lock`) para dois leads simultâneos não caírem no mesmo grupo.
- Cada lead ganha uma anotação ("Teste de primeiro contato (50/50): LIGAÇÃO…") e um evento `lead.teste_primeiro_contato` com `payload.grupo` = `ligacao` ou `mensagem`.
- O resultado aparece também no aviso do grupo.

Para medir (negócios apagados saem sozinhos pelo `join`):

```sql
select e.payload->>'grupo' as grupo,
       count(*) as leads,
       count(*) filter (where o.stage in ('reuniao_agendada','apresentacao_institucional','envio_proposta',
                                          'apresentacao_proposta','negociacao','ganho')) as chegaram_a_reuniao,
       count(*) filter (where o.stage = 'ganho') as vendas
  from events e
  join opportunities o on o.id = e.subject_id
 where e.event_name = 'lead.teste_primeiro_contato'
 group by 1;
```

### 5. Site manda o lead e as UTMs para o CRM

**Por quê:** a rota de lead do site não entregava nada ao CRM em produção. Faltavam as variáveis de ambiente, e as UTMs iam num formato que o CRM não lia.

**Como funciona:** `src/app/api/lead/route.ts` (repo do site) manda os campos no formato do CRM: `name`, `phone`, `email`, `company_name`, `website`, `servico`, `mensagem` (respostas do formulário), `landing_page` (URL completa), `referrer`, `utm_*`, `gclid`, `fbclid`. Variáveis no projeto do site (só Production): `CRM_LEAD_ENDPOINT` e `CRM_LEAD_TOKEN`. O token tem o mesmo valor do `INGEST_API_KEY` do CRM.

### Publicações de 19/10/2026

| Parte | Versão nova | Versão anterior (para voltar) |
| --- | --- | --- |
| Banco | migration `20261019_lp_nova_atendimento_humano.sql` + segredo `lp_aviso_grupo_whatsapp` | `C:\Users\vinic\.crm-teste\voltar-atras-prod.sql` |
| CRM | commit `d612540`, deploy `dpl_H63nadK2LvnptCRLorVF6kCe2Qox` | `dpl_348juNikLSnkqEpoHzN5uaXc1K61` |
| Site | commit `ce7ca38`, deploy `dpl_EFmboTT3qYmWFgNktLwqFUMwBsZ8` | `dpl_6YDHr3BPQQq3DUZ1m2DYkGdDHiAc` |

## Migrations

As migrations são aplicadas à mão (psql ou SQL Editor do Supabase). O banco **não** guarda o histórico delas: os arquivos `.sql` só existem no repositório.

### Feita em 19/10/2026

**`supabase/migrations/20261019_lp_nova_atendimento_humano.sql`**, aplicada em produção em 19/10/2026.

| O que mudou | Para quê |
| --- | --- |
| `fn_ingest_lead` (recebe todo lead) | Lead de LP nova (`/lp/…`) nasce com dono Rodrigues e `atendimento = 'humano'`; sorteia o teste 50/50 e cria a anotação |
| `fn_leads_para_outreach` (fila da Naia) | A Naia só pega negócio com `atendimento = 'naia'` |
| `fn_lp_aviso_grupo_whatsapp` (nova) | Lê do cofre o ID do grupo de aviso; só o `service_role` pode executar |

- Fora do arquivo, aplicado à mão no mesmo dia: o segredo `lp_aviso_grupo_whatsapp` no cofre (`vault.create_secret`), para o ID do grupo não ir para o código.
- Teste: `supabase/tests/lp_nova_atendimento.sql`. Rode sempre dentro de `begin; … rollback;`. Passou em produção sem deixar rastro.
- Para desfazer: `C:\Users\vinic\.crm-teste\voltar-atras-prod.sql` (as duas funções como estavam antes).

**Sobre o nome:** o repositório tem `0001` a `0051`. O computador antigo tinha migrations depois da `0051` que não estão aqui, e não se sabe o último número. Por isso a de 19/10 leva a data no nome e não um número, para não colidir. Quando o computador antigo voltar, ela pode ser renomeada para vir logo depois da última de lá. Renomear não exige aplicar de novo.

## Pendências

- [ ] **Trocar credenciais que passaram pela conversa de recuperação:** senha do banco de produção, token do Supabase (`sbp_…`), `INGEST_API_KEY`. Este último precisa mudar ao mesmo tempo no CRM, no `CRM_LEAD_TOKEN` do site e nos formulários antigos.
- [ ] **Ligar o CRM ao GitHub na Vercel** (`vercel git connect --scope vaccari`), para push no `main` publicar como no site.
- [ ] **Testes antigos:** 10 testes em `scripts/` já falhavam no código recuperado (autorização, arquivos, perda). Também há 10 erros de lint antigos.
- [ ] **`/api/mcp`:** estoura o tempo de 30 s de vez em quando (já acontecia antes de 19/10).
- [ ] **Medir o teste 50/50** com a consulta acima quando houver volume.

## Como publicar com segurança (processo usado em 19/10)

1. **Mudar num branch**, nunca direto no `main`.
2. **Testar no ambiente local** (`C:\Users\vinic\.crm-teste`):
    - `rodar-crm.ps1`: CRM em `localhost:3000`, ligado ao Supabase de teste, com toda integração apontando para a Z-API e a Naia falsas.
    - `mundo-falso.mjs`: Z-API e Naia falsas em `localhost:4599`; o que receberiam vai para `chamadas.log`.
    - `rodar-site.ps1`: site em `localhost:4600`, mandando lead para o CRM local.
    - O Supabase de teste nunca recebe dados de clientes nem os cron jobs de produção.
3. **Verificar:** testes (`node --test scripts/<arquivo>.test.cjs`), checagem de tipos (`npx tsc --noEmit -p web`), lint dos arquivos mudados, teste SQL em `begin/rollback`.
4. **Publicar em ordem, cada passo com OK:**
    1. banco (migration + teste SQL em produção com rollback);
    2. CRM (push `main` + `vercel deploy --prod --scope vaccari` em `web/`);
    3. variáveis do site;
    4. site (push `main`).
5. **Conferir em produção** com um lead real de teste, usando um número que ainda não existe no CRM. Depois, apagar o negócio de teste.

No Claude Code em modo automático, alterar o banco de produção e mandar WhatsApp real são bloqueados pelo filtro de segurança. Para publicar, troque para o modo Manual (Shift+Tab) e aprove cada comando.

## Checklist ao recuperar o computador antigo

- [ ] **Não sobrescrever nada antes de comparar.** O GitHub tem as mudanças de 19/10 que o computador antigo não tem.
- [ ] Copiar do computador antigo as migrations depois da `0051` para `supabase/migrations/` e renomear a de 19/10 para vir depois da última delas.
- [ ] Comparar o código antigo com o `main` atual (`git diff`). Pode haver mudanças locais que nunca foram publicadas.
- [ ] Atualizar o projeto antigo: `git remote add origin https://github.com/VinicusVaccari/nova-acao-crm.git`, `git fetch`, e juntar com cuidado.
- [ ] Recuperar as configurações dos agentes antigos (Maestro, Sentinela, Alice) se ainda forem úteis.
- [ ] Revisar este arquivo e marcar as pendências resolvidas.
