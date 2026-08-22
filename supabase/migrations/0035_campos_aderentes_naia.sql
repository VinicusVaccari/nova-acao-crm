-- =============================================================
-- 0035_campos_aderentes_naia — alinha os campos personalizados ao
--   payload de encerrar_conversa da Naia.
--   (6) keys iguais aos nomes da Naia; (1) porte/urgência viram texto
--   livre (a Naia manda prosa); (2) novo campo resultado_esperado.
--   Renomear a key não perde valores (custom_field_values usa field_id).
-- =============================================================

-- (6) keys alinhadas
update custom_fields set key = 'o_que_vende'          where entity = 'company' and key = 'o_que_vendem';
update custom_fields set key = 'para_quem'            where entity = 'company' and key = 'para_quem_vendem';
update custom_fields set key = 'dor'                  where entity = 'contact' and key = 'dor_principal';
update custom_fields set key = 'serviço_de_interesse' where entity = 'contact' and key = 'servico_interesse';

-- (1) porte e urgência → texto livre (limpa as opções da lista)
update custom_fields set field_type = 'text', options = '{}' where key in ('porte', 'urgencia');

-- (2) novo campo de contato: resultado_esperado
insert into custom_fields (entity, key, label, field_type, options, required, sort_order)
values ('contact', 'resultado_esperado', 'Resultado esperado', 'text', '{}', false, 7)
on conflict (entity, key) do nothing;
