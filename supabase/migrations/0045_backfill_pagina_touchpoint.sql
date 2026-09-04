-- O formulário envia a URL como page_url. A coluna de atribuição usa
-- landing_page; recupera os registros anteriores sem alterar o payload cru.
update touchpoints
   set landing_page = nullif(raw->>'page_url', '')
 where nullif(landing_page, '') is null
   and nullif(raw->>'page_url', '') is not null;
