'use client'

import { useState, useTransition } from 'react'
import { Painel, Selo, Kpi } from '@/components/ui'
import {
  definirFollowupAtivo, definirFollowupModo, definirFollowupSomenteNumerosTeste,
  atualizarFollowupParametros, salvarFollowupTexto,
} from '@/lib/followup-actions'
import { conversaoHoraDigitada, paraNumeroHora } from '@/lib/followup-tempos'

type Variante = 'padrao' | 'sem_resposta'
type Texto = { id: number; lote: number; toque: number; variante: Variante; texto: string; criado_em: string; autor: string | null }

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/* -------------------- bloco: painel do piloto -------------------- */

type Resumo = { enviados: number; sombra: number; falhas: number; custo: number }

function BlocoPainel({ hoje, mes, modo }: { hoje: Resumo; mes: Resumo; modo: string }) {
  const custo = (v: number) => v > 0 ? `US$ ${v.toFixed(2)}` : 'US$ 0,00'
  return (
    <Painel titulo="Painel do piloto" legenda="Hoje e no mês — toques enviados, gerados em sombra, falhas e custo.">
      <div className="grid grid-cols-2 gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <Kpi rotulo="Enviados hoje" valor={String(hoje.enviados)} nota={`${mes.enviados} no mês`} />
        {modo === 'sombra' && <Kpi rotulo="Gerados em sombra hoje" valor={String(hoje.sombra)} nota={`${mes.sombra} no mês`} />}
        <Kpi rotulo="Falhas hoje" valor={String(hoje.falhas)} estado={hoje.falhas > 0 ? 'warning' : null} nota={`${mes.falhas} no mês`} />
        <Kpi rotulo="Custo hoje" valor={custo(hoje.custo)} nota={`${custo(mes.custo)} no mês`} />
      </div>
    </Painel>
  )
}

/* -------------------- bloco: chave e modo -------------------- */

function BlocoChave({ config }: { config: Record<string, unknown> }) {
  const [pend, start] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const ativo = !!config.ativo
  const modo = config.modo as 'sombra' | 'autonomo'
  const ligadoEm = config.ligado_em as string | null
  const somenteTeste = !!config.somente_numeros_teste

  return (
    <Painel titulo="Chave e modo" legenda="Ligado/desligado é imediato — desligar para tudo no minuto seguinte, sem apagar nada.">
      <div className="flex items-center justify-between gap-4" style={{ minHeight: 40 }}>
        <div className="flex items-center gap-3">
          <Selo tipo={ativo ? 'good' : 'neutro'} texto={ativo ? 'Ligado' : 'Desligado'} forte />
          <Selo tipo={modo === 'autonomo' ? 'warning' : 'neutro'} texto={modo === 'autonomo' ? 'Modo automático' : 'Modo sombra (não envia)'} forte />
        </div>
        <button
          className={`btn btn-sm ${ativo ? 'btn-ghost' : 'btn-primary'}`}
          disabled={pend}
          onClick={() => { setErro(null); start(async () => { const r = await definirFollowupAtivo(!ativo); if (!r.ok) setErro(r.erro) }) }}
        >
          {ativo ? 'Desligar' : 'Ligar'}
        </button>
      </div>
      <p className="t-xs muted" style={{ marginTop: 'var(--s-2)', minHeight: 16 }}>
        {ligadoEm ? `Ligado pela primeira vez em ${quando(ligadoEm)} — só negócios criados a partir daí entram na cadência.` : 'Ainda nunca foi ligado.'}
      </p>
      <div className="flex items-center gap-2" style={{ marginTop: 'var(--s-4)' }}>
        <span className="t-sm" style={{ color: 'var(--ink-muted)' }}>Modo:</span>
        <button
          className="btn btn-ghost btn-sm" disabled={pend || modo === 'sombra'}
          onClick={() => start(async () => { const r = await definirFollowupModo('sombra'); if (!r.ok) setErro(r.erro) })}
        >Sombra</button>
        <button
          className="btn btn-ghost btn-sm" disabled={pend || modo === 'autonomo'}
          onClick={() => start(async () => { const r = await definirFollowupModo('autonomo'); if (!r.ok) setErro(r.erro) })}
        >Automático</button>
      </div>

      <div style={{ marginTop: 'var(--s-4)', paddingTop: 'var(--s-4)', borderTop: '1px solid var(--hairline)' }}>
        <div className="flex items-center justify-between gap-4">
          <Selo tipo={somenteTeste ? 'good' : 'warning'} texto={somenteTeste ? 'Só números de teste' : 'Vale para todos os leads'} forte />
          <button
            className={`btn btn-sm ${somenteTeste ? 'btn-primary' : 'btn-ghost'}`}
            disabled={pend}
            onClick={() => { setErro(null); start(async () => { const r = await definirFollowupSomenteNumerosTeste(!somenteTeste); if (!r.ok) setErro(r.erro) }) }}
          >
            {somenteTeste ? 'Liberar para todos os leads' : 'Restringir a números de teste'}
          </button>
        </div>
        <p className="t-xs muted" style={{ marginTop: 'var(--s-2)', minHeight: 16 }}>
          {somenteTeste
            ? 'Mesmo ligado, só dispara (em sombra ou automático) para telefones cadastrados em números de teste.'
            : 'Atenção: vale para todos os leads elegíveis — inclusive clientes de verdade.'}
        </p>
      </div>

      {erro && <p className="t-sm" style={{ color: 'var(--critical)', marginTop: 'var(--s-2)' }}>{erro}</p>}
    </Painel>
  )
}

/* -------------------- bloco: os três textos -------------------- */

function TextoDoToque({ lote, toque, variante, versoes }: { lote: number; toque: number; variante: Variante; versoes: Texto[] }) {
  const vigente = versoes[0]
  const [valor, setValor] = useState(vigente?.texto ?? '')
  const [pend, start] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [verHistorico, setVerHistorico] = useState(false)
  const mudou = valor.trim() !== (vigente?.texto ?? '').trim()

  return (
    <div style={{ paddingBlock: 'var(--s-4)', borderTop: toque > 1 ? '1px solid var(--hairline)' : undefined }}>
      <div className="flex items-center justify-between gap-2" style={{ marginBottom: 'var(--s-2)' }}>
        <span className="t-h3" style={{ fontSize: 'var(--text-md)' }}>Toque {toque}</span>
        {versoes.length > 1 && (
          <button className="t-xs" style={{ color: 'var(--brand-teal)' }} onClick={() => setVerHistorico(v => !v)}>
            {verHistorico ? 'ocultar' : 'ver'} histórico ({versoes.length - 1} {versoes.length - 1 === 1 ? 'versão anterior' : 'versões anteriores'})
          </button>
        )}
      </div>
      <textarea
        className="field" rows={3} value={valor} maxLength={1200}
        onChange={e => { setValor(e.target.value); setOk(false) }}
        placeholder="Texto base deste toque…"
      />
      <div className="flex items-center gap-2" style={{ marginTop: 'var(--s-2)' }}>
        <button
          className="btn btn-primary btn-sm" disabled={pend || !mudou || valor.trim().length < 10}
          onClick={() => {
            setErro(null); setOk(false)
            start(async () => {
              const r = await salvarFollowupTexto(lote, toque, variante, valor)
              if (!r.ok) setErro(r.erro); else setOk(true)
            })
          }}
        >{pend ? 'Salvando…' : 'Salvar'}</button>
        <span className="t-xs muted">{valor.length}/1200</span>
        {ok && <span className="t-xs" style={{ color: 'var(--good)' }}>salvo — versão nova registrada</span>}
      </div>
      {erro && <p className="t-sm" style={{ color: 'var(--critical)', marginTop: 'var(--s-1)' }}>{erro}</p>}
      {vigente && (
        <p className="t-2xs muted" style={{ marginTop: 'var(--s-2)' }}>
          Versão vigente desde {quando(vigente.criado_em)}{vigente.autor ? ` · ${vigente.autor}` : ''}
        </p>
      )}
      {verHistorico && versoes.length > 1 && (
        <div className="flex flex-col" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-3)', paddingLeft: 'var(--s-3)', borderLeft: '2px solid var(--hairline)' }}>
          {versoes.slice(1).map(v => (
            <div key={v.id}>
              <p className="t-sm muted" style={{ whiteSpace: 'pre-wrap' }}>{v.texto}</p>
              <p className="t-2xs muted">{quando(v.criado_em)}{v.autor ? ` · ${v.autor}` : ''}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BlocoTextos({ lote, variante, textosPorToque }: { lote: number; variante: Variante; textosPorToque: Record<number, Texto[]> }) {
  const loteDois = lote === 2
  return (
    <Painel
      titulo={`Lote ${lote}`}
      legenda={loteDois
        ? 'Só entra em jogo se o lead responder e sumir de novo depois do lote 1.'
        : 'O texto base de cada toque. O modelo só personaliza — a intenção da mensagem é sempre a sua.'}
    >
      <TextoDoToque lote={lote} toque={1} variante={variante} versoes={textosPorToque[1] ?? []} />
      <TextoDoToque lote={lote} toque={2} variante={variante} versoes={textosPorToque[2] ?? []} />
      <TextoDoToque lote={lote} toque={3} variante={variante} versoes={textosPorToque[3] ?? []} />
    </Painel>
  )
}

/* -------------------- bloco: tempos e tetos -------------------- */

function CampoNumero({ rotulo, valor, onSalvar, sufixo, minimo, mostrarConversaoHoras = false }: {
  rotulo: string; valor: number; onSalvar: (n: number) => Promise<Resultado>
  sufixo?: string; minimo?: number; mostrarConversaoHoras?: boolean
}) {
  const [v, setV] = useState(String(valor))
  const [pend, start] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const numero = paraNumeroHora(v)
  const mudou = v.trim() !== '' && (numero === null || numero !== valor)
  const conversao = mostrarConversaoHoras ? conversaoHoraDigitada(v) : null
  return (
    <label className="flex flex-col gap-1">
      <span className="campo-label">{rotulo}</span>
      <div className="flex items-center gap-2">
        <input
          type="text" inputMode="decimal" className="field" value={v}
          onChange={e => { setV(e.target.value); setErro(null) }}
          aria-label={rotulo} style={{ maxWidth: 140 }}
        />
        {sufixo && <span className="t-sm muted">{sufixo}</span>}
        {mudou && (
          <button
            className="btn btn-ghost btn-sm" disabled={pend}
            onClick={() => start(async () => {
              if (numero === null || (minimo !== undefined && numero < minimo)) {
                setErro(`Informe um número válido${minimo !== undefined ? `, no mínimo ${minimo}` : ''}.`)
                return
              }
              const r = await onSalvar(numero)
              if (!r.ok) { setErro(r.erro); setV(String(valor)) }
            })}
          >salvar</button>
        )}
      </div>
      {mostrarConversaoHoras && <span className="t-xs muted" style={{ minHeight: 16 }}>{conversao ?? ' '}</span>}
      {erro && <p className="t-xs" style={{ color: 'var(--critical)' }}>{erro}</p>}
    </label>
  )
}

type Resultado = { ok: true } | { ok: false; erro: string }

function BlocoTempos({ config }: { config: Record<string, unknown> }) {
  const salvar = (campo: string) => (n: number) => atualizarFollowupParametros({ [campo]: n })
  return (
    <>
      <Painel titulo="Tempos do lote 1" legenda="Editável para teste (tempos curtos) e depois restaurado.">
        <div className="grid grid-cols-2 gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          <CampoNumero rotulo="Toque 1 (silêncio)" valor={Number(config.horas_toque_1)} sufixo="horas" mostrarConversaoHoras onSalvar={salvar('horas_toque_1')} />
          <CampoNumero rotulo="Toque 2 (silêncio)" valor={Number(config.horas_toque_2)} sufixo="horas" mostrarConversaoHoras onSalvar={salvar('horas_toque_2')} />
          <CampoNumero rotulo="Toque 3 (silêncio)" valor={Number(config.horas_toque_3)} sufixo="horas" mostrarConversaoHoras onSalvar={salvar('horas_toque_3')} />
          <CampoNumero rotulo="Espera antes de perder" valor={Number(config.horas_desfecho)} sufixo="horas após o 3º toque" mostrarConversaoHoras onSalvar={salvar('horas_desfecho')} />
        </div>
      </Painel>
      <Painel titulo="Tempos do lote 2" legenda="Usados apenas se o lote 2 abrir; nascem iguais aos do lote 1 e podem ser ajustados à parte.">
        <div className="grid grid-cols-2 gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          <CampoNumero rotulo="Toque 1 (silêncio)" valor={Number(config.horas_toque_1_lote2)} sufixo="horas" mostrarConversaoHoras onSalvar={salvar('horas_toque_1_lote2')} />
          <CampoNumero rotulo="Toque 2 (silêncio)" valor={Number(config.horas_toque_2_lote2)} sufixo="horas" mostrarConversaoHoras onSalvar={salvar('horas_toque_2_lote2')} />
          <CampoNumero rotulo="Toque 3 (silêncio)" valor={Number(config.horas_toque_3_lote2)} sufixo="horas" mostrarConversaoHoras onSalvar={salvar('horas_toque_3_lote2')} />
          <CampoNumero rotulo="Espera antes de perder" valor={Number(config.horas_desfecho_lote2)} sufixo="horas após o 3º toque" mostrarConversaoHoras onSalvar={salvar('horas_desfecho_lote2')} />
        </div>
      </Painel>
      <Painel titulo="Limites de envio e custo" legenda="Limites compartilhados pelos dois lotes.">
        <div className="grid grid-cols-2 gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
        <CampoNumero rotulo="Tentativas de envio por toque" valor={Number(config.max_tentativas_envio)} minimo={1} onSalvar={salvar('max_tentativas_envio')} />
        <CampoNumero rotulo="Prazo da reserva" valor={Number(config.lease_minutos)} sufixo="minutos" minimo={3} onSalvar={salvar('lease_minutos')} />
        <CampoNumero rotulo="Teto de disparos por dia" valor={Number(config.teto_disparos_dia)} onSalvar={salvar('teto_disparos_dia')} />
          <CampoNumero rotulo="Teto de custo por dia" valor={Number(config.teto_custo_dia_usd)} sufixo="USD" onSalvar={salvar('teto_custo_dia_usd')} />
        </div>
      </Painel>
    </>
  )
}

/* -------------------- composição -------------------- */

function GrupoTextos({ variante, textosPorLote }: { variante: Variante; textosPorLote: Record<number, Record<number, Texto[]>> }) {
  const semResposta = variante === 'sem_resposta'
  return (
    <section className="flex flex-col" style={{ gap: 'var(--s-3)' }}>
      <div>
        <h3 className="t-h3">{semResposta ? 'Quando o lead nunca respondeu' : 'Quando o lead já conversou'}</h3>
        <p className="t-sm muted" style={{ marginTop: 'var(--s-1)' }}>
          {semResposta
            ? 'Usados no lote 1 quando não existe nenhuma mensagem recebida desse lead.'
            : 'Usados quando o lead já respondeu. O lote 2 só abre depois de uma resposta.'}
        </p>
      </div>
      <BlocoTextos lote={1} variante={variante} textosPorToque={textosPorLote[1] ?? {}} />
      {!semResposta && <BlocoTextos lote={2} variante={variante} textosPorToque={textosPorLote[2] ?? {}} />}
    </section>
  )
}

export function FollowupAdmin({
  config, textosPorVariante, painelHoje, painelMes,
}: {
  config: Record<string, unknown> | null
  textosPorVariante: Record<Variante, Record<number, Record<number, Texto[]>>>
  painelHoje: Resumo
  painelMes: Resumo
}) {
  if (!config) return <p className="t-sm muted">Configuração ainda não existe — aplique a migration 0057.</p>
  return (
    <div className="flex flex-col" style={{ gap: 'var(--s-5)' }}>
      <BlocoPainel hoje={painelHoje} mes={painelMes} modo={String(config.modo)} />
      <BlocoChave config={config} />
      <GrupoTextos variante="padrao" textosPorLote={textosPorVariante.padrao} />
      <GrupoTextos variante="sem_resposta" textosPorLote={textosPorVariante.sem_resposta} />
      <BlocoTempos config={config} />
    </div>
  )
}
