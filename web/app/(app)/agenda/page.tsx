import { requireActiveUser } from '@/lib/security/authorization'
import { userDatabase } from '@/lib/security/user-db'
import { isManager } from '@/lib/security/policy'
import { agendaConectada, listarEventos } from '@/lib/google'
import { AgendaSemana, AgendaConectar } from '@/components/agenda'

export type NegocioOpcao = { id: string; nome: string }

async function negociosAbertos(): Promise<NegocioOpcao[]> {
  const db = await userDatabase()
  const { data } = await db
    .from('opportunities')
    .select('id, title, stage, people:person_id ( full_name ), companies:company_id ( trade_name )')
    .is('lost_at', null)
    .order('stage_since', { ascending: false })
    .limit(300)
  return (data ?? [])
    .filter(o => o.stage !== 'ganho' && o.stage !== 'cliente')
    .map(o => {
      const lead = ((o.people as { full_name?: string } | null)?.full_name) || (o.title as string) || 'Sem nome'
      const empresa = (o.companies as { trade_name?: string } | null)?.trade_name
      return { id: o.id as string, nome: empresa ? `${lead} · ${empresa}` : lead }
    })
}

export const dynamic = 'force-dynamic'

/* Brasil não tem mais horário de verão → BRT é sempre UTC−3.
   Fazemos a matemática de calendário em datas puras (UTC) e fixamos
   o fuso em −03:00 nas bordas da semana. */

function hojeBRT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}
function addDias(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
function segunda0(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7 // 0 = segunda
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireActiveUser()
  const sp = await searchParams
  const { conectada, email } = await agendaConectada()

  const base = sp.dia && /^\d{4}-\d{2}-\d{2}$/.test(sp.dia) ? sp.dia : hojeBRT()
  const segunda = addDias(base, -segunda0(base))
  const dias = Array.from({ length: 7 }, (_, i) => addDias(segunda, i))

  const [eventosBrutos, negocios] = conectada
    ? await Promise.all([
        listarEventos(`${segunda}T00:00:00-03:00`, `${addDias(segunda, 7)}T00:00:00-03:00`),
        negociosAbertos(),
      ])
    : [[], []]
  let eventos = eventosBrutos
  const user = await requireActiveUser()
  if (!isManager(user)) {
    const db = await userDatabase()
    const { data: meetings } = await db.from('meetings').select('external_event_id').not('external_event_id', 'is', null)
    const allowed = new Set((meetings ?? []).map(m => m.external_event_id))
    eventos = eventosBrutos.filter(event => allowed.has(event.id))
  }

  // e-mails dos colaboradores mais usados — sugestões ao convidar (lista fixa)
  const colaboradores = [
    'novaacaomkt@gmail.com',
    'vaccarivinicius2@gmail.com',
    'clisnobre@gmail.com',
    'lincoln.lucena.12@gmail.com',
    'gabrielaraujo1711@gmail.com',
    'jtdigitalcompany@gmail.com',
    'diegomn07@gmail.com',
  ]

  return (
    <div className="flex flex-col" style={{ gap: 'var(--s-5)' }}>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="t-h1">Agenda</h1>
          <p className="t-sm muted">
            {conectada ? <>Google Calendar{email ? ` · ${email}` : ''}</> : 'Google Calendar não conectado'}
          </p>
        </div>
        <AgendaConectar conectada={conectada} email={email} aviso={sp.conectado ? 'ok' : sp.erro ?? null} />
      </div>

      {conectada ? (
        <AgendaSemana dias={dias} hoje={hojeBRT()} eventos={eventos} segunda={segunda} negocios={negocios} colaboradores={colaboradores} />
      ) : (
        <div className="card" style={{ padding: 'var(--s-8)', textAlign: 'center' }}>
          <p className="t-body" style={{ marginBottom: 'var(--s-2)' }}>Conecte o Google Calendar para ver a agenda aqui.</p>
          <p className="t-sm muted">Depois de conectado, marcar uma reunião num negócio cria o evento direto na agenda.</p>
        </div>
      )}
    </div>
  )
}
