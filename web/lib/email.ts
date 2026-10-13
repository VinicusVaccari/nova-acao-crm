import 'server-only'

/* Envio de e-mail transacional via Resend (API HTTP). O app manda o e-mail
   do servidor usando a RESEND_API_KEY. Sem a chave, não envia (o convite
   ainda é criado e o link fica disponível pra copiar). */

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export function resendConfigurado() {
  return !!process.env.RESEND_API_KEY
}

/** Remetente. Precisa ser de um domínio verificado no Resend. Configurável
    por RESEND_FROM (ex.: "Nova Ação <convites@agencianovaacao.com.br>"). */
function remetente() {
  return process.env.RESEND_FROM || 'Nova Ação <onboarding@resend.dev>'
}

function escapar(s: string) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export async function enviarEmailConvite(
  para: string, link: string, convidadoPor?: string, papelNome?: string,
): Promise<{ enviado: boolean; motivo?: string }> {
  if (!resendConfigurado()) return { enviado: false, motivo: 'sem_resend' }

  const logo = `${(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/wa-media/brand/simbolo.png`
  const quemNome = escapar(convidadoPor || 'A equipe da Nova Ação')
  const iniciais = escapar((convidadoPor || 'Nova Ação').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('') || 'NA')
  const acesso = escapar(papelNome || 'Membro')
  const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const expFmt = exp.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: 'numeric', month: 'long' })
  const linkSemProto = link.replace(/^https?:\/\//, '')
  const linkCurto = linkSemProto.length > 44 ? `${linkSemProto.slice(0, 44)}…` : linkSemProto

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Você foi convidado para o CRM da Nova Ação</title>
<!--[if mso]>
<style>body,table,td,a{font-family:Tahoma,Verdana,Arial,sans-serif !important;}</style>
<![endif]-->
<style>
  @media only screen and (max-width:620px){
    .stack{display:block !important;width:100% !important;max-width:100% !important;}
    .sidepad{padding:24px 28px !important;}
    .h1{font-size:26px !important;line-height:32px !important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#EFEDE8;">
<span style="display:none;font-size:1px;color:#EFEDE8;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${quemNome} te convidou para o CRM comercial da Nova Ação. Crie sua senha e já comece.</span>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#EFEDE8;">
<tr><td align="center" style="padding:32px 12px 40px 12px;">

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background-color:#FDFDFC;border-radius:20px;overflow:hidden;">

    <!-- topo -->
    <tr>
      <td bgcolor="#009E9B" style="background-color:#009E9B;padding:24px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td align="left" valign="middle">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              <td valign="middle"><img src="${logo}" width="42" height="42" alt="" style="display:block;border:0;outline:none;"></td>
              <td valign="middle" style="padding-left:12px;">
                <div style="font-family:Tahoma,Verdana,Arial,sans-serif;font-size:24px;line-height:26px;mso-line-height-rule:exactly;font-weight:bold;letter-spacing:1px;color:#FFFFFF;text-transform:lowercase;">nova <span style="color:#FAB800;">ação</span></div>
                <div style="font-family:Tahoma,Verdana,Arial,sans-serif;font-size:9px;line-height:13px;mso-line-height-rule:exactly;letter-spacing:3px;color:#BFE6E5;padding-top:5px;text-transform:uppercase;">marketing e publicidade</div>
              </td>
            </tr></table>
          </td>
          <td align="right" valign="middle">
            <div style="font-family:Tahoma,Verdana,Arial,sans-serif;font-size:11px;line-height:16px;mso-line-height-rule:exactly;letter-spacing:1px;color:#FFFFFF;text-transform:uppercase;">CRM comercial</div>
          </td>
        </tr>
        </table>
      </td>
    </tr>
    <tr><td bgcolor="#FAB800" height="5" style="height:5px;line-height:5px;font-size:0;background-color:#FAB800;">&nbsp;</td></tr>

    <!-- corpo: painel + conteudo -->
    <tr>
      <td style="padding:0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <!-- painel lateral -->
          <td class="stack sidepad" width="196" valign="top" bgcolor="#E7F3F2" style="width:196px;background-color:#E7F3F2;padding:36px 24px 36px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="56" height="56" align="center" valign="middle" bgcolor="#412257" style="width:56px;height:56px;background-color:#412257;border-radius:28px;font-family:Tahoma,Verdana,Arial,sans-serif;font-size:19px;line-height:56px;mso-line-height-rule:exactly;font-weight:bold;color:#FFFFFF;letter-spacing:1px;">${iniciais}</td>
            </tr>
            </table>
            <div style="font-family:Tahoma,Verdana,Arial,sans-serif;font-size:15px;line-height:20px;mso-line-height-rule:exactly;font-weight:bold;color:#202020;padding-top:14px;">${quemNome}</div>
            <div style="font-family:Tahoma,Verdana,Arial,sans-serif;font-size:12px;line-height:18px;mso-line-height-rule:exactly;color:#6E7A79;padding-top:3px;">convidou você</div>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
            <tr><td height="1" bgcolor="#C9E3E1" style="height:1px;line-height:1px;font-size:0;background-color:#C9E3E1;padding-top:20px;">&nbsp;</td></tr>
            </table>

            <div style="font-family:Tahoma,Verdana,Arial,sans-serif;font-size:10px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:2px;color:#7D8C8B;padding-top:20px;text-transform:uppercase;">Seu acesso</div>
            <div style="font-family:Tahoma,Verdana,Arial,sans-serif;font-size:15px;line-height:20px;mso-line-height-rule:exactly;font-weight:bold;color:#00706E;padding-top:5px;">${acesso}</div>

            <div style="font-family:Tahoma,Verdana,Arial,sans-serif;font-size:10px;line-height:14px;mso-line-height-rule:exactly;letter-spacing:2px;color:#7D8C8B;padding-top:18px;text-transform:uppercase;">Convite válido até</div>
            <div style="font-family:Tahoma,Verdana,Arial,sans-serif;font-size:15px;line-height:20px;mso-line-height-rule:exactly;font-weight:bold;color:#202020;padding-top:5px;">${expFmt}</div>
            <div style="font-family:Tahoma,Verdana,Arial,sans-serif;font-size:11px;line-height:16px;mso-line-height-rule:exactly;color:#6E7A79;padding-top:3px;">7 dias a partir de hoje</div>
          </td>

          <!-- conteudo -->
          <td class="stack" width="404" valign="top" style="width:404px;padding:38px 36px 34px 32px;">
            <div style="font-family:Tahoma,Verdana,Arial,sans-serif;font-size:11px;line-height:16px;mso-line-height-rule:exactly;letter-spacing:3px;color:#009E9B;text-transform:uppercase;">Convite de acesso</div>
            <h1 class="h1" style="margin:10px 0 0 0;font-family:Tahoma,Verdana,Arial,sans-serif;font-size:30px;line-height:36px;mso-line-height-rule:exactly;font-weight:bold;color:#202020;">Que bom ter você<br>com a gente.</h1>
            <p style="margin:16px 0 0 0;font-family:Tahoma,Verdana,Arial,sans-serif;font-size:15px;line-height:24px;mso-line-height-rule:exactly;color:#4A4A48;">${quemNome} abriu um lugar para você no CRM comercial da Nova Ação — onde a gente acompanha propostas, clientes e o funil do dia a dia.</p>
            <p style="margin:12px 0 0 0;font-family:Tahoma,Verdana,Arial,sans-serif;font-size:15px;line-height:24px;mso-line-height-rule:exactly;color:#4A4A48;">É rápido: você cria sua senha e já entra.</p>

            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;">
            <tr>
              <td align="center" bgcolor="#FAB800" style="background-color:#FAB800;border-radius:10px;">
                <a href="${link}" style="display:block;padding:16px 30px;font-family:Tahoma,Verdana,Arial,sans-serif;font-size:15px;line-height:18px;mso-line-height-rule:exactly;font-weight:bold;color:#202020;text-decoration:none;">Criar meu acesso</a>
              </td>
            </tr>
            </table>

            <p style="margin:22px 0 0 0;font-family:Tahoma,Verdana,Arial,sans-serif;font-size:12px;line-height:20px;mso-line-height-rule:exactly;color:#8A8A86;">Se o botão não funcionar, cole este endereço no navegador:<br>
              <a href="${link}" style="color:#009E9B;text-decoration:underline;word-break:break-all;">${linkCurto}</a>
            </p>
          </td>
        </tr>
        </table>
      </td>
    </tr>

    <!-- rodape -->
    <tr>
      <td bgcolor="#412257" style="background-color:#412257;padding:24px 32px 26px 32px;">
        <div style="font-family:Tahoma,Verdana,Arial,sans-serif;font-size:12px;line-height:20px;mso-line-height-rule:exactly;color:#D6CBE0;">Não esperava este convite? Pode ignorar este e-mail — sem o link, ninguém entra.</div>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
        <tr><td height="16" style="height:16px;line-height:16px;font-size:0;">&nbsp;</td></tr>
        </table>
        <div style="font-family:Tahoma,Verdana,Arial,sans-serif;font-size:11px;line-height:18px;mso-line-height-rule:exactly;color:#A899B4;">Agência Nova Ação · Marketing e Publicidade<br>Rua Frei Gaspar, 22 sala 213 — Centro, São Bernardo do Campo/SP<br><a href="mailto:atendimento@agencianovaacao.com.br" style="color:#FAB800;text-decoration:none;">atendimento@agencianovaacao.com.br</a> · (11) 4021-7791</div>
      </td>
    </tr>
  </table>

</td></tr>
</table>
</body>
</html>`

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: remetente(),
        to: [para],
        subject: 'Seu convite para o CRM da Nova Ação',
        html,
      }),
    })
    if (!res.ok) {
      const txt = await res.text()
      console.error('Resend falhou:', res.status, txt)
      return { enviado: false, motivo: `resend_${res.status}` }
    }
    return { enviado: true }
  } catch (e) {
    console.error('Resend erro:', e)
    return { enviado: false, motivo: 'excecao' }
  }
}

export async function enviarEmailRecuperacao(para: string, link: string): Promise<{ enviado: boolean; motivo?: string }> {
  if (!resendConfigurado()) return { enviado: false, motivo: 'sem_resend' }

  const logo = `${(process.env.SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/wa-media/brand/simbolo.png`
  const href = escapar(link)
  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Redefina sua senha — Nova Ação</title></head>
<body style="margin:0;padding:0;background:#EFEDE8;font-family:Tahoma,Verdana,Arial,sans-serif;color:#202020;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#FDFDFC;border-radius:20px;overflow:hidden;">
      <tr><td style="background:#009E9B;padding:24px 32px;"><img src="${logo}" width="42" height="42" alt="" style="vertical-align:middle;border:0;"><span style="margin-left:12px;font-size:24px;font-weight:bold;letter-spacing:1px;color:#fff;vertical-align:middle;">nova <span style="color:#FAB800;">ação</span></span></td></tr>
      <tr><td style="background:#FAB800;height:5px;line-height:5px;font-size:0;">&nbsp;</td></tr>
      <tr><td style="padding:38px 36px;"><div style="font-size:11px;letter-spacing:3px;color:#009E9B;text-transform:uppercase;">Recuperação de senha</div>
        <h1 style="margin:10px 0 0;font-size:30px;line-height:36px;">Redefina sua senha.</h1>
        <p style="font-size:15px;line-height:24px;color:#4A4A48;">Recebemos um pedido para redefinir a senha do seu acesso ao CRM da Nova Ação.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:26px;"><tr><td style="background:#FAB800;border-radius:10px;"><a href="${href}" style="display:block;padding:16px 30px;font-weight:bold;color:#202020;text-decoration:none;">Redefinir minha senha</a></td></tr></table>
        <p style="font-size:12px;line-height:20px;color:#8A8A86;">Se você não pediu a redefinição, pode ignorar este e-mail.</p>
      </td></tr>
      <tr><td style="background:#412257;padding:24px 32px;color:#D6CBE0;font-size:12px;line-height:20px;">Agência Nova Ação · Marketing e Publicidade<br>Rua Frei Gaspar, 22 sala 213 — Centro, São Bernardo do Campo/SP</td></tr>
    </table>
  </td></tr></table>
</body></html>`

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: remetente(), to: [para], subject: 'Redefina sua senha do CRM Nova Ação', html }),
    })
    if (!res.ok) {
      console.error('Resend falhou:', res.status, await res.text())
      return { enviado: false, motivo: `resend_${res.status}` }
    }
    return { enviado: true }
  } catch (e) {
    console.error('Resend erro:', e)
    return { enviado: false, motivo: 'excecao' }
  }
}
