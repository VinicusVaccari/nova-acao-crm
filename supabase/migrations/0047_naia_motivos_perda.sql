-- Códigos usados pela NAIA; preserva rótulos já personalizados no sistema.
-- Apenas catálogo: não altera oportunidades, histórico ou permissões.
begin;

insert into public.lost_reasons (code, label, active) values
  ('nao_e_lead', 'Não é lead', true),
  ('lead_evasivo', 'Lead evasivo', true),
  ('conteudo_ofensivo', 'Conteúdo ofensivo', true)
on conflict (code) do update set active = true
where public.lost_reasons.active is distinct from true;

do $$
begin
  if (select count(*) from public.lost_reasons
      where code in ('nao_e_lead', 'lead_evasivo', 'conteudo_ofensivo')
        and active = true) <> 3 then
    raise exception 'Os três motivos de perda NAIA devem estar ativos.';
  end if;
end;
$$;

commit;
