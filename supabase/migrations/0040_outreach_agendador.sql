-- Agendador DENTRO do banco: o próprio sistema (Supabase) varre de minuto em
-- minuto e dispara o webhook do lead frio. Sem depender de n8n/Vercel cron.

create extension if not exists pg_net;   -- HTTP a partir do Postgres
create extension if not exists pg_cron;  -- agendador

-- Dispara o webhook para cada lead frio elegível (form sem msg há ≥10 min).
create or replace function fn_outreach_disparar()
returns int language plpgsql security definer as $$
declare
  r record;
  h int;
  n int := 0;
  webhook text := 'https://n8n.agencianovaacao.com.br/webhook/c8cc9d0d-3b8c-4040-b087-9d06438cda0a';
begin
  h := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  if h < 8 or h >= 20 then return 0; end if;         -- só horário comercial (BRT)

  for r in select * from fn_leads_para_outreach(10, 24) loop  -- 10 min silêncio, até 24h
    -- marca ANTES (dedup); só dispara se ainda não foi puxado
    update opportunities set outreach_at = now()
      where id = r.opportunity_id and outreach_at is null;
    if not found then continue; end if;

    perform net.http_post(
      url     := webhook,
      body    := jsonb_build_object(
        'evento',        'outbound_form',   -- identifica: webhook diferente
        'origem',        'outbound_form',
        'tipo',          'lead_frio',
        'mensagem',      'INICIAR_CONTATO_OUTBOUND',   -- sinal de abertura a frio (mesmo campo do fluxo normal)
        'opportunityId', r.opportunity_id,
        'telefone',      regexp_replace(r.phone, '[^0-9]', '', 'g'),  -- padroniza com o fluxo normal
        'nome',          r.nome
      ),
      headers := '{"Content-Type":"application/json"}'::jsonb
    );
    n := n + 1;
  end loop;
  return n;
end $$;

-- Agenda de minuto em minuto (idempotente: remove o job antigo se existir).
do $$ begin perform cron.unschedule('outreach_leads_frios'); exception when others then null; end $$;
select cron.schedule('outreach_leads_frios', '* * * * *', $$select fn_outreach_disparar()$$);
