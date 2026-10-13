export function normalizarSaidaFollowup(params: {
  textoBase: string
  mensagem: string
  usouContexto: boolean
  referencia: string
}) {
  if (!params.usouContexto) {
    return { mensagem: params.textoBase, personalizou: false, usouContexto: false, referencia: '' }
  }
  return {
    mensagem: params.mensagem.trim(),
    personalizou: true,
    usouContexto: true,
    referencia: params.referencia,
  }
}
