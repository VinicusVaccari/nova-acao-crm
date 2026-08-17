-- =============================================================
-- 0008_fix_auth_trigger
--
-- "Database error creating new user" ao criar usuário no Auth.
--
-- Causa: o serviço de Auth executa como supabase_auth_admin, cujo
-- search_path não inclui o schema public. A função do trigger dizia
-- apenas "profiles" e não encontrava a tabela, derrubando o insert
-- em auth.users inteiro.
--
-- Correção: search_path fixo na função + nomes qualificados. Vale
-- para toda função SECURITY DEFINER acionada por serviço interno.
-- =============================================================

create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  )
  on conflict (id) do nothing;
  return new;
exception
  -- nunca impedir a criação do usuário por causa do perfil
  when others then
    raise warning 'fn_handle_new_user falhou para %: %', new.id, sqlerrm;
    return new;
end $$;

drop trigger if exists trg_new_user on auth.users;
create trigger trg_new_user
  after insert on auth.users
  for each row execute function public.fn_handle_new_user();

-- Mesma blindagem nas demais funções SECURITY DEFINER: sem search_path
-- fixo elas quebram quando chamadas por outro papel (n8n, Auth, cron)
-- e ficam vulneráveis a sequestro de search_path.
alter function public.fn_resolve_person(text,text,text,text,text,text,text,text)
  set search_path = public, pg_temp;
alter function public.fn_ingest_lead(jsonb)             set search_path = public, pg_temp;
alter function public.fn_move_stage(uuid,opp_stage,uuid,text,text,jsonb)
  set search_path = public, pg_temp;
alter function public.fn_enqueue_conversion(uuid,opp_stage) set search_path = public, pg_temp;
alter function public.fn_log_activity(uuid,text,text,text,uuid,boolean,text,jsonb)
  set search_path = public, pg_temp;
alter function public.fn_sdr_context(text)              set search_path = public, pg_temp;
alter function public.fn_convert_to_account(uuid,uuid)  set search_path = public, pg_temp;
alter function public.fn_my_role()                      set search_path = public, pg_temp;
alter function public.fn_is_manager()                   set search_path = public, pg_temp;
