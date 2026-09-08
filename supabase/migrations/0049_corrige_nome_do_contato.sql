-- Reparo: contatos gravados com o nome de QUEM ENVIOU a mensagem.
--
-- A Z-API manda senderName (quem enviou) e chatName (de quem é a conversa).
-- Em mensagens fromMe o remetente é o nosso próprio perfil, então todo lead
-- criado a partir de uma delas ficou com o nome do vendedor. O nome certo
-- estava no mesmo payload, em chatName — e o log cru dos webhooks guardou.
--
-- A escolha do campo já foi corrigida em parseZapiInbound; isto é só reparo
-- do que ficou para trás.

with candidato as (
  select regexp_replace(coalesce(w.phone, ''), '[^0-9]', '', 'g') as fone,
         btrim(w.raw->>'chatName')                                as nome,
         count(*)                                                 as n
    from wa_webhook_log w
   where w.raw->>'chatName' ~ '[A-Za-zÀ-ÿ]'   -- descarta LID cru e só-dígitos
     and w.raw->>'chatName' not like '%@%'
   group by 1, 2
),
melhor as (
  select distinct on (fone) fone, nome
    from candidato
   where fone <> ''
   order by fone, n desc, nome
)
update people p
   set full_name  = m.nome,
       updated_at = now()
  from melhor m
 where p.full_name = 'Rodrigues Jr Agência Nova Ação'
   and regexp_replace(coalesce(p.phone_primary, ''), '[^0-9]', '', 'g') = m.fone
   and m.nome <> p.full_name;

-- Sobra quem nunca escreveu e só chegou por @lid: não existe nome guardado em
-- lugar nenhum. Fica vazio em vez de mentir — a auto-cura do inbound preenche
-- na primeira mensagem que essas pessoas mandarem.
update people
   set full_name  = null,
       updated_at = now()
 where full_name = 'Rodrigues Jr Agência Nova Ação';
