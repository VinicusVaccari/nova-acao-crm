import { requireActiveUser } from '@/lib/security/authorization'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { carregarFicha, rotuloLead } from '@/lib/crm'
import { Avatar, Selo } from '@/components/ui'
import { carregarEstagios } from '@/lib/estagios-server'
import { StageStepper } from '@/components/stage-stepper'
import { AcoesNegocio } from '@/components/acoes-negocio'
import { FichaTabs } from '@/components/ficha-tabs'
import { PainelNegociacao, PainelContato, PainelEmpresa } from '@/components/ficha-paineis'
import { carregarCamposCustom } from '@/lib/campos'

export const dynamic = 'force-dynamic'

export default async function Ficha({ params }: { params: Promise<{ id: string }> }) {
  await requireActiveUser()
  const { id } = await params
  const [ficha, motivos, usuariosRes, estagios, segRes] = await Promise.all([
    carregarFicha(id),
    db.from('lost_reasons').select('code,label').eq('active', true),
    db.from('profiles').select('id, full_name').eq('is_active', true).neq('role', 'ia').order('full_name'),
    carregarEstagios(),
    db.from('segments').select('name').eq('active', true).order('name'),
  ])
  if (!ficha) notFound()
  const segmentos = (segRes.data ?? []).map(s => s.name as string)
  const mapaEstagio = Object.fromEntries(estagios.map(e => [e.id, e]))
  const labelEstagio = (s: string) => mapaEstagio[s]?.label ?? s
  const corEstagio = (s: string) => mapaEstagio[s]?.cor ?? '#7c7595'
  const usuarios = (usuariosRes.data ?? []) as { id: string; full_name: string }[]

  const { opp, atividades, atividadesTruncadas, reunioes, propostas, historico, toques, toqueAtribuido: toqueDireto, objecoes, notas, tarefas, produtos, catalogo, arquivos, followups } = ficha
  const pessoa = (opp.people as Record<string, string | null> | null) ?? {}
  const empresa = opp.companies as Record<string, string | null> | null
  const dono = opp.profiles as Record<string, string | null> | null
  const nomePessoa = rotuloLead(pessoa.full_name, pessoa.phone_primary)
  const texto = (valor: unknown) => typeof valor === 'string' && valor.trim() ? valor.trim() : null
  const tituloNegociacao = texto(opp.title) ?? nomePessoa
  const nomeEmpresa = texto(empresa?.trade_name)
  const responsavel = texto(dono?.full_name) ?? 'Naia (IA)'

  // campos personalizados (Contato/Empresa) — Empresa só se houver empresa
  const [contatoCampos, empresaCampos] = await Promise.all([
    carregarCamposCustom('contact', opp.person_id as string),
    carregarCamposCustom('company', empresa ? (empresa.id as unknown as string) : null),
  ])

  const valorContrato = Number(opp.expected_value ?? 0) * Number(opp.term_months ?? 12) + Number(opp.setup_value ?? 0)
  const speed = opp.first_contact_at
    ? (new Date(opp.first_contact_at).getTime() - new Date(opp.created_at).getTime()) / 60000
    : null
  // O contato pode ter touchpoints de negócios anteriores. A ficha deve
  // mostrar o toque atribuído a ESTE negócio; em um retorno pelo formulário,
  // last_touchpoint_id aponta justamente para as UTMs recém-enviadas.
  const toqueAtribuido = (
    toqueDireto
    ?? toques.find(t => String(t.id) === String(opp.last_touchpoint_id))
    ?? toques.find(t => String(t.id) === String(opp.first_touchpoint_id))
    ?? toques.at(-1)
  ) as Record<string, string> | undefined
  const temCliqueGoogle = toques.some(toque => Boolean(toque.gclid || toque.gbraid || toque.wbraid))
  const temCliqueMeta = toques.some(toque => Boolean(toque.fbclid || toque.fbc))

  const stage = opp.stage as string
  const statusNeg = opp.lost_at ? 'perdido' : opp.paused_at ? 'pausado' : stage === 'ganho' ? 'vendido' : 'andamento'
  const cor = corEstagio(stage)
  const diasNoEstagio = Math.floor((Date.now() - new Date(opp.stage_since as string).getTime()) / 86400000)

  // Valor total do negócio, composto pelos produtos (qtd × valor − desconto)
  const prods = produtos as Array<Record<string, unknown>>
  const totalLinha = (p: Record<string, unknown>) =>
    Math.max(0, Number(p.quantity ?? 1) * Number(p.mrr ?? 0) - Number(p.discount ?? 0))
  const valorTotal = prods.reduce((s, p) => s + totalLinha(p), 0)
  const valorMrr = prods.filter(p => p.recurrence === 'mensal').reduce((s, p) => s + totalLinha(p), 0)
  const setupProdutos = valorTotal - valorMrr

  return (
    <>
      <Link href="/pipeline" className="t-sm" style={{ color: 'var(--ink-muted)' }}>← Pipeline</Link>

      {/* ---------- Banner ---------- */}
      <div className="hero" style={{ marginTop: 'var(--s-2)', marginBottom: 'var(--s-4)', padding: 'var(--s-6)' }}>
        <div className="flex flex-wrap items-start justify-between" style={{ gap: 'var(--s-5)' }}>
          <div className="flex items-start" style={{ gap: 'var(--s-4)', minWidth: 0 }}>
            <Avatar nome={nomePessoa} tamanho={56} cor={cor} />
            <div style={{ minWidth: 0 }}>
              <h1 className="t-h1 hero-ink">{nomePessoa}</h1>
              <div className="flex flex-wrap items-center" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-2)' }}>
                <span className="chip-stage" style={{ ['--sc' as string]: cor, color: '#fff', background: 'color-mix(in srgb, #fff 16%, transparent)', borderColor: 'transparent' }}>
                  <span aria-hidden className="chip-dot" style={{ background: cor === '#fdb92e' ? cor : '#fff' }} />
                  {labelEstagio(stage)}
                </span>
                {nomeEmpresa && <span className="t-sm hero-ink-2">{nomeEmpresa}</span>}
                {empresa?.segment && <span className="t-sm hero-ink-2">· {empresa.segment}</span>}
              </div>
              <div className="flex flex-wrap" style={{ gap: 'var(--s-4)', marginTop: 'var(--s-3)' }}>
                {pessoa.phone_primary && <span className="t-sm hero-ink-2">{pessoa.phone_primary}</span>}
                {pessoa.email_primary && <span className="t-sm hero-ink-2">{pessoa.email_primary}</span>}
              </div>
            </div>
          </div>

          <div className="shrink-0">
            <AcoesNegocio oppId={id} status={statusNeg} motivos={motivos.data ?? []} />
          </div>
        </div>

      </div>

      {/* stepper em chevron clicável (estilo RD) */}
      <div className="mb-4">
        <StageStepper oppId={id} atual={stage} dias={diasNoEstagio} perdido={!!opp.lost_at} pausado={!!opp.paused_at} />
      </div>

      {/* ---------- Corpo: esquerda (info) + direita (abas) ---------- */}
      <div className="grid lg:grid-cols-[minmax(380px,1fr)_2fr] gap-5">
        {/* coluna de informações */}
        <div className="flex flex-col gap-4">
          <PainelNegociacao
            oppId={id}
            neg={{
              title: (opp.title as string) ?? null,
              nomePessoa,
              qualificacao: Number(opp.qualificacao ?? 0),
              source: toqueAtribuido?.utm_source || (opp.source as string) || null,
              campaign: toqueAtribuido?.utm_campaign || (opp.campaign as string) || null,
              creative: toqueAtribuido?.utm_content || (opp.creative as string) || null,
              valorTotal: produtos.length ? valorTotal : valorContrato,
              valorMrr,
              setup: setupProdutos,
              term: Number(opp.term_months ?? 12),
              responsavel,
              criadaEm: opp.created_at as string,
              speedMin: speed,
              produtos: produtos.length,
            }}
          />

          <PainelContato
            oppId={id}
            personId={opp.person_id as string}
            contato={{ full_name: nomePessoa, phone: pessoa.phone_primary ?? null, email: pessoa.email_primary ?? null }}
            campos={contatoCampos}
          />

          <PainelEmpresa
            oppId={id}
            personId={opp.person_id as string}
            empresa={
              empresa
                ? {
                    id: empresa.id as unknown as string,
                    trade_name: nomeEmpresa ?? 'Sem nome',
                    cnpj: (empresa.cnpj as string) ?? null,
                    address: (empresa.address as string) ?? null,
                    website: (empresa.website as string) ?? null,
                    segment: (empresa.segment as string) ?? null,
                  }
                : null
            }
            campos={empresaCampos}
            segmentos={segmentos}
          />

          {/* De onde veio — origem rastreada (informativo, distinto da Fonte editável) */}
          <div className="card" style={{ padding: 'var(--s-5)' }}>
            <h3 className="t-h2" style={{ marginBottom: 'var(--s-1)' }}>De onde veio</h3>
            {toqueAtribuido ? (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3" style={{ marginTop: 'var(--s-3)' }}>
                  {([
                    ['Origem', 'utm_source'],
                    ['Mídia', 'utm_medium'],
                    ['Campanha', 'utm_campaign'],
                    ['Conteúdo/criativo', 'utm_content'],
                    ['Termo', 'utm_term'],
                    ['Página', 'landing_page'],
                  ] as const).map(([rotulo, campo]) => (
                    <div key={campo} className="min-w-0">
                      <div className="t-xs muted">{rotulo}</div>
                      <div className="t-sm" style={{ fontWeight: 600, wordBreak: 'break-word' }}>{toqueAtribuido[campo] || '—'}</div>
                    </div>
                  ))}
                </div>
                <p className="t-xs muted" style={{ marginTop: 'var(--s-3)' }}>
                  {toques.length} toque(s) no contato · origem mais recente deste negócio classificada como <b style={{ color: 'var(--ink-2)' }}>{toqueAtribuido.channel ?? '—'}</b>.
                  {temCliqueGoogle && ' Clique do Google identificado neste contato.'}
                  {temCliqueMeta && ' Clique do Meta identificado neste contato.'}
                  {!temCliqueGoogle && !temCliqueMeta && ' Não há clique identificado neste contato: nenhum toque trouxe gclid, gbraid, wbraid, fbclid ou fbc.'}
                </p>
              </>
            ) : (
              <p className="t-sm muted" style={{ marginTop: 'var(--s-2)' }}>Sem toque registrado.</p>
            )}
          </div>

          {objecoes.length > 0 && (
            <div className="card" style={{ padding: 'var(--s-5)' }}>
              <h3 className="t-h2" style={{ marginBottom: 'var(--s-4)' }}>Objeções</h3>
              <div className="flex flex-col" style={{ gap: 'var(--s-3)' }}>
                {objecoes.map(o => {
                  const ob = o.objections as { label: string } | null
                  return (
                    <div key={o.id as string}>
                      <div className="flex items-center gap-2">
                        <span className="t-body" style={{ fontWeight: 500 }}>{ob?.label}</span>
                        <Selo tipo={o.outcome === 'superada' ? 'good' : o.outcome === 'matou_o_deal' ? 'critical' : 'warning'} texto={String(o.outcome ?? '')} />
                      </div>
                      {o.verbatim ? <p className="t-sm muted" style={{ marginTop: 2, fontStyle: 'italic' }}>&ldquo;{o.verbatim as string}&rdquo;</p> : null}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* coluna de abas */}
        <FichaTabs
          oppId={id}
          criadoEm={opp.created_at as string}
          donoNome={texto(dono?.full_name) ?? undefined}
          donoId={(opp.owner_id as string) ?? undefined}
          negNome={tituloNegociacao}
          empresaNome={nomeEmpresa ?? undefined}
          usuarios={usuarios}
          atividades={atividades}
          atividadesTruncadas={atividadesTruncadas}
          historico={historico}
          reunioes={reunioes}
          propostas={propostas}
          notas={notas}
          tarefas={tarefas}
          produtos={produtos}
          catalogo={catalogo}
          arquivos={arquivos}
          followups={followups}
        />
      </div>
    </>
  )
}

function Info({ rotulo, valor, alerta }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="t-body shrink-0" style={{ color: 'var(--ink-muted)' }}>{rotulo}</span>
      <span className="t-body text-right truncate" style={{ color: alerta ? 'var(--critical)' : 'var(--ink)', fontWeight: 600 }}>{valor}</span>
    </div>
  )
}
