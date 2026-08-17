# 12 — Configurações

Seção de administração do sistema. **Só admin/gestor** acessam (gate no layout + no menu do usuário, na topbar). Rota base: `/configuracoes`, com sub-nav à esquerda.

Server actions em `lib/config-actions.ts` (usuários/equipes/convites/perfil/foto), `lib/config-listas.ts` (listas simples) e `lib/config-campos.ts` (campos personalizados). Todas checam papel antes de mutar.

## Usuários e equipes

- **Usuários** — tabela dos perfis (`profiles`): editar **papel** (`admin, gestor, vendedor, sdr, csm, analista`), **equipe**, **capacidade** de leads e **ativo/inativo**. Salva na hora. Mostra a **foto** (avatar).
- **Equipes** (`teams` + `profiles.team_id`) — criar, renomear, remover. 1 equipe por usuário.
- **Convites** (`invites`: token/status/expiração) — convidar por e-mail (papel + equipe). Cria o convite, **envia por e-mail via Resend** e gera o link. Lista pendentes com copiar-link/cancelar.

### Convite por e-mail (Resend)

- `enviarEmailConvite` usa a API do Resend. Envs: **`RESEND_API_KEY`** e **`RESEND_FROM`** (`Nova Ação <convites@agencianovaacao.com.br>` — domínio **verificado** no Resend/Hostinger).
- Template HTML branded (cabeçalho teal, símbolo da logo hospedado em Storage, painel lateral com quem convidou/acesso/validade, botão amarelo, rodapé com endereço da agência).
- **Aceite**: página pública `/convite/[token]` → a pessoa cria **nome + senha** → `aceitarConvite` cria o login (Supabase auth, `admin.createUser`) + o perfil com papel/equipe do convite → marca aceito → vai pro login. Convite inválido/expirado mostra tela de erro.

## Perfil (do próprio usuário)

- **Dados**: editar nome (e-mail e papel só leitura).
- **Trocar senha**: exige **senha atual** (validada via `signInWithPassword` num cliente isolado) + confirmação da nova; nova ≠ atual, mín. 8 caracteres.
- **Foto**: upload (`atualizarMinhaFoto`, `FormData`) para o bucket **`avatars`** (público), máx. 2 MB, JPG/PNG/GIF; grava `profiles.avatar_url` com cache-buster. Aparece na topbar, na lista de usuários e no componente `Avatar` do sistema.

## Listas simples (CRUD compartilhado)

Componente `ListaConfig` + actions em `config-listas.ts` (entidades **whitelisted**). Cada item = `{id, label, ativo}` — adicionar, renomear (duplo-clique/botão), ativar-inativar, remover.

- **Segmentos** — tabela nova `segments`.
- **Motivos de perda** — `lost_reasons` (já vinha populada).
- **Produtos e serviços** — `products` (mostra a descrição).

## Campos personalizados

`custom_fields` — definições de campos extras por **entidade** (`deal` | `company` | `contact`): nome, tipo (Texto/Número/Data/Seleção/Sim-Não), opções (para Seleção) e obrigatório. Abas por entidade; criar/ativar/remover.

- **Em aberto**: **exibir e salvar** esses campos nos formulários de negócio/empresa/contato (hoje é só o cadastro das definições).

## Idioma (EN/ES)

**Decidido não fazer** por ora — exigiria i18n do sistema inteiro (traduzir todas as telas). Fica registrado como possível fase futura; não há seletor "morto" no app.

## Tabelas criadas

`teams`, `profiles.team_id`, `invites`, `segments`, `custom_fields`. Buckets de Storage: `avatars` (fotos), `wa-media` (áudios + símbolo da logo).
