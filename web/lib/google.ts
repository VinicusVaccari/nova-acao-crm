import 'server-only'
import { db } from '@/lib/db'

/* -----------------------------------------------------------------
   Integração com o Google Calendar. Fala direto com as APIs REST do
   Google (sem SDK). Guarda a conexão em `calendar_accounts` via
   service_role — os tokens nunca saem do servidor.

   Fluxo: authUrl() → o usuário autoriza → trocarCodigo() no callback →
   salvarConexao(). Depois, tokenValido() renova sozinho quando expira.
   ----------------------------------------------------------------- */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CAL = 'https://www.googleapis.com/calendar/v3'

export const TIMEZONE = 'America/Sao_Paulo'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'openid',
  'email',
]

export function googleConfigurado(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

/** URL de consentimento do Google (offline → devolve refresh_token). */
export function authUrl(redirectUri: string, state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${p.toString()}`
}

type TokenResp = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  id_token?: string
}

/** Troca o `code` do callback pelos tokens. */
export async function trocarCodigo(code: string, redirectUri: string): Promise<TokenResp> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) throw new Error(`troca de código falhou: ${res.status} ${await res.text()}`)
  return res.json()
}

function emailDoIdToken(idToken?: string): string | null {
  if (!idToken) return null
  try {
    const payload = idToken.split('.')[1]
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    return json.email ?? null
  } catch {
    return null
  }
}

/** Grava a conexão do usuário que acabou de autorizar. Hoje há só uma
    conexão (a do Rodrigues): apagamos a anterior e inserimos a nova —
    como pedimos `prompt=consent`, o refresh_token sempre volta. */
export async function salvarConexao(userId: string | null, tok: TokenResp): Promise<void> {
  const expiry = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString()
  const linha = {
    provider: 'google',
    user_id: userId,
    google_email: emailDoIdToken(tok.id_token),
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? null,
    token_expiry: expiry,
    scope: tok.scope ?? null,
    updated_at: new Date().toISOString(),
  }
  await db.from('calendar_accounts').delete().eq('provider', 'google')
  const { error } = await db.from('calendar_accounts').insert(linha)
  if (error) {
    console.error('salvarConexao insert:', error)
    throw new Error(error.message)
  }
}

type Conexao = {
  id: string
  google_email: string | null
  calendar_id: string
  access_token: string | null
  refresh_token: string | null
  token_expiry: string | null
}

/** A conexão ativa (hoje há só uma — a do Rodrigues). */
export async function conexao(): Promise<Conexao | null> {
  const { data } = await db
    .from('calendar_accounts')
    .select('id, google_email, calendar_id, access_token, refresh_token, token_expiry')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as Conexao) ?? null
}

export async function agendaConectada(): Promise<{ conectada: boolean; email: string | null }> {
  const c = await conexao()
  return { conectada: !!c, email: c?.google_email ?? null }
}

export async function desconectar(): Promise<void> {
  await db.from('calendar_accounts').delete().neq('id', '00000000-0000-0000-0000-000000000000')
}

/** Access token válido — renova pelo refresh_token quando expirado.
    `force` ignora o expiry e força a renovação (usado quando o Google
    devolve 401 mesmo com o token "dentro da validade" — ele revoga
    tokens antigos quando muitos são emitidos). */
async function tokenValido(force = false): Promise<{ token: string; calendarId: string } | null> {
  const c = await conexao()
  if (!c) return null

  const folga = Date.now() + 60_000
  if (!force && c.access_token && c.token_expiry && new Date(c.token_expiry).getTime() > folga) {
    return { token: c.access_token, calendarId: c.calendar_id }
  }
  if (!c.refresh_token) return null

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: c.refresh_token,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    console.error('refresh token falhou:', res.status, await res.text())
    return null
  }
  const tok: TokenResp = await res.json()
  const expiry = new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString()
  await db
    .from('calendar_accounts')
    .update({ access_token: tok.access_token, token_expiry: expiry, updated_at: new Date().toISOString() })
    .eq('id', c.id)
  return { token: tok.access_token, calendarId: c.calendar_id }
}

async function calFetch(path: string, init: RequestInit, token: string) {
  return fetch(`${CAL}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

/** Chamada autenticada ao Calendar com retry: se o Google devolver 401
    (token revogado antes do expiry), força um refresh e tenta de novo.
    `montarPath` recebe o calendar_id. Retorna null se não há conexão. */
async function calAuth(montarPath: (calId: string) => string, init: RequestInit): Promise<Response | null> {
  const auth = await tokenValido()
  if (!auth) return null
  let res = await calFetch(montarPath(auth.calendarId), init, auth.token)
  if (res.status === 401) {
    const fresh = await tokenValido(true)
    if (fresh) res = await calFetch(montarPath(fresh.calendarId), init, fresh.token)
  }
  return res
}

export type NovoEvento = {
  summary: string
  description?: string
  inicioISO: string
  fimISO: string
  convidados?: string[]
  comMeet?: boolean
}

export type EventoCriado = { eventId: string; meetUrl: string | null; htmlLink: string | null }

/** Cria o evento na agenda (com link do Meet, se pedido). Best-effort: null em falha. */
export async function criarEvento(ev: NovoEvento): Promise<EventoCriado | null> {
  const body: Record<string, unknown> = {
    summary: ev.summary,
    description: ev.description ?? undefined,
    start: { dateTime: ev.inicioISO, timeZone: TIMEZONE },
    end: { dateTime: ev.fimISO, timeZone: TIMEZONE },
  }
  if (ev.convidados?.length) body.attendees = ev.convidados.map(email => ({ email }))
  if (ev.comMeet) {
    body.conferenceData = {
      createRequest: { requestId: `na-${ev.inicioISO}-${Math.round(ev.inicioISO.length)}`, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    }
  }

  const q = ev.comMeet ? '?conferenceDataVersion=1&sendUpdates=all' : '?sendUpdates=all'
  const res = await calAuth(
    cid => `/calendars/${encodeURIComponent(cid)}/events${q}`,
    { method: 'POST', body: JSON.stringify(body) },
  )
  if (!res) return null
  if (!res.ok) {
    console.error('criarEvento falhou:', res.status, await res.text())
    return null
  }
  const j = await res.json()
  const meet: string | null =
    j.hangoutLink ??
    (j.conferenceData?.entryPoints?.find((e: { entryPointType?: string; uri?: string }) => e.entryPointType === 'video')?.uri ?? null)
  return { eventId: j.id, meetUrl: meet, htmlLink: j.htmlLink ?? null }
}

export async function atualizarEvento(eventId: string, patch: Partial<NovoEvento>): Promise<boolean> {
  const body: Record<string, unknown> = {}
  if (patch.summary) body.summary = patch.summary
  if (patch.description !== undefined) body.description = patch.description
  if (patch.inicioISO) body.start = { dateTime: patch.inicioISO, timeZone: TIMEZONE }
  if (patch.fimISO) body.end = { dateTime: patch.fimISO, timeZone: TIMEZONE }

  const res = await calAuth(
    cid => `/calendars/${encodeURIComponent(cid)}/events/${eventId}?sendUpdates=all`,
    { method: 'PATCH', body: JSON.stringify(body) },
  )
  if (!res) return false
  if (!res.ok) console.error('atualizarEvento falhou:', res.status, await res.text())
  return res.ok
}

export async function cancelarEvento(eventId: string): Promise<boolean> {
  const res = await calAuth(
    cid => `/calendars/${encodeURIComponent(cid)}/events/${eventId}?sendUpdates=all`,
    { method: 'DELETE' },
  )
  if (!res) return false
  // 410 = já removido; tratamos como sucesso
  if (!res.ok && res.status !== 410) console.error('cancelarEvento falhou:', res.status, await res.text())
  return res.ok || res.status === 410
}

export type Convidado = { email: string; nome: string | null; status: string | null; organizador: boolean }

export type EventoAgenda = {
  id: string
  titulo: string
  inicio: string | null
  fim: string | null
  diaInteiro: boolean
  meetUrl: string | null
  htmlLink: string | null
  descricao: string | null
  local: string | null
  organizador: string | null
  convidados: Convidado[]
}

type ReuniaoRow = {
  id: string
  external_event_id: string | null
  status: string
  scheduled_at: string | null
  [k: string]: unknown
}

/** Sentido Google → sistema: para cada reunião ainda aberta que tem
    evento no Google, confere lá. Se o evento foi apagado/cancelado,
    marca a reunião como `cancelada`; se o horário mudou no Google,
    sincroniza o `scheduled_at`. Não faz nada se a agenda não estiver
    conectada. Devolve a lista já atualizada. */
export async function reconciliarReunioes(reunioes: ReuniaoRow[]): Promise<ReuniaoRow[]> {
  const abertas = reunioes.filter(m => m.external_event_id && ['agendada', 'confirmada'].includes(m.status))
  if (!abertas.length) return reunioes

  const auth = await tokenValido()
  if (!auth) return reunioes

  await Promise.all(
    abertas.map(async m => {
      const res = await calAuth(
        cid => `/calendars/${encodeURIComponent(cid)}/events/${m.external_event_id}`,
        { method: 'GET' },
      )
      if (!res) return
      const sumiu = res.status === 404 || res.status === 410
      if (!sumiu && !res.ok) return // erro transitório — não mexe

      let cancelado = sumiu
      let ini: string | undefined
      if (!sumiu) {
        const j = await res.json()
        cancelado = j.status === 'cancelled'
        ini = j.start?.dateTime
      }

      if (cancelado) {
        await db.from('meetings').update({ status: 'cancelada' }).eq('id', m.id)
        m.status = 'cancelada'
        return
      }
      if (ini && m.scheduled_at && new Date(ini).getTime() !== new Date(m.scheduled_at).getTime()) {
        const iso = new Date(ini).toISOString()
        await db.from('meetings').update({ scheduled_at: iso }).eq('id', m.id)
        m.scheduled_at = iso
      }
    }),
  )
  return reunioes
}

/** Lista eventos entre duas datas (para a página da Agenda). */
export async function listarEventos(timeMinISO: string, timeMaxISO: string): Promise<EventoAgenda[]> {
  const p = new URLSearchParams({
    timeMin: timeMinISO,
    timeMax: timeMaxISO,
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '250',
  })
  const res = await calAuth(cid => `/calendars/${encodeURIComponent(cid)}/events?${p.toString()}`, { method: 'GET' })
  if (!res) return []
  if (!res.ok) {
    console.error('listarEventos falhou:', res.status, await res.text())
    return []
  }
  const j = await res.json()
  type GAtt = { email?: string; displayName?: string; responseStatus?: string; organizer?: boolean; self?: boolean; resource?: boolean }
  type GEvt = {
    id: string
    summary?: string
    status?: string
    hangoutLink?: string
    htmlLink?: string
    description?: string
    location?: string
    organizer?: { email?: string; displayName?: string }
    attendees?: GAtt[]
    start?: { dateTime?: string; date?: string }
    end?: { dateTime?: string; date?: string }
  }
  return (j.items ?? [])
    .filter((e: GEvt) => e.status !== 'cancelled')
    .map((e: GEvt) => ({
      id: e.id,
      titulo: e.summary ?? '(sem título)',
      inicio: e.start?.dateTime ?? e.start?.date ?? null,
      fim: e.end?.dateTime ?? e.end?.date ?? null,
      diaInteiro: !e.start?.dateTime,
      meetUrl: e.hangoutLink ?? null,
      htmlLink: e.htmlLink ?? null,
      descricao: e.description ?? null,
      local: e.location ?? null,
      organizador: e.organizer?.displayName ?? e.organizer?.email ?? null,
      convidados: (e.attendees ?? [])
        .filter(a => !a.resource)
        .map(a => ({
          email: a.email ?? '',
          nome: a.displayName ?? null,
          status: a.responseStatus ?? null,
          organizador: !!a.organizer,
        })),
    }))
}
