-- =============================================================
-- 0028_numeros_teste — números de TESTE que sempre chegam ao n8n.
--   Diferente da isenção antiga: aqui NÃO mexemos no fn_trava_status.
--   O número trava normal (badge "Travado" aparece igual a todo mundo).
--   A única diferença: no /inbound, um número de teste SEMPRE é
--   encaminhado ao n8n — mesmo travado — pra permitir o comando #reset
--   (n8n limpa cadastro + memória da IA e recomeça o teste).
-- =============================================================

create table if not exists numeros_teste (
  phone text primary key,   -- só dígitos
  nota  text
);
alter table numeros_teste enable row level security;

insert into numeros_teste (phone, nota)
values ('5511989369538', 'número de teste do Vinicius (#reset via n8n)')
on conflict (phone) do nothing;

-- true = é número de teste → /inbound sempre aciona o n8n.
create or replace function fn_numero_teste(p_phone text)
returns boolean language sql stable as $$
  select exists (
    select 1 from numeros_teste
    where phone = regexp_replace(p_phone, '[^0-9]', '', 'g')
  );
$$;
