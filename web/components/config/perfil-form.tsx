'use client'

import { useRef, useState, useTransition } from 'react'
import { Avatar } from '@/components/ui'
import { papelLabel } from '@/lib/papeis'
import { atualizarMeuPerfil, alterarMinhaSenha, atualizarMinhaFoto } from '@/lib/config-actions'

export function PerfilForm({ nome, email, papel, avatar }: { nome: string; email: string; papel: string; avatar: string | null }) {
  return (
    <div style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 'var(--s-8)' }}>
      <FotoPerfil nome={nome} avatar={avatar} />
      <DadosBasicos nome={nome} email={email} papel={papel} />
      <TrocarSenha />
    </div>
  )
}

function FotoPerfil({ nome, avatar }: { nome: string; avatar: string | null }) {
  const [url, setUrl] = useState<string | null>(avatar)
  const [erro, setErro] = useState<string | null>(null)
  const [pend, iniciar] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const escolher = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setErro(null)
    const fd = new FormData()
    fd.append('foto', file)
    iniciar(async () => {
      const r = await atualizarMinhaFoto(fd)
      if (r.ok) setUrl(r.url); else setErro(r.erro)
      if (inputRef.current) inputRef.current.value = ''
    })
  }

  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 'var(--s-3)' }}>Foto de perfil</div>
      <div className="flex items-center" style={{ gap: 'var(--s-4)' }}>
        <Avatar nome={nome} src={url} tamanho={64} />
        <div>
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/gif" onChange={escolher} style={{ display: 'none' }} />
          <button className="btn btn-ghost btn-sm" onClick={() => inputRef.current?.click()} disabled={pend}>
            {pend ? 'Enviando…' : 'Escolher foto'}
          </button>
          <div className="t-xs muted" style={{ marginTop: 4 }}>Máx. 2 MB. Formatos: JPG, GIF, PNG.</div>
          {erro && <div className="t-xs" style={{ color: 'var(--serious)', marginTop: 4 }}>{erro}</div>}
        </div>
      </div>
    </div>
  )
}

function DadosBasicos({ nome, email, papel }: { nome: string; email: string; papel: string }) {
  const [n, setN] = useState(nome)
  const [pend, iniciar] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  const salvar = () => {
    setMsg(null)
    iniciar(async () => {
      const r = await atualizarMeuPerfil(n)
      setMsg(r.ok ? 'Salvo.' : r.erro)
    })
  }

  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 'var(--s-3)' }}>Seus dados</div>
      <label className="t-sm muted">Nome</label>
      <input className="field" value={n} onChange={e => setN(e.target.value)} style={{ marginTop: 4, marginBottom: 'var(--s-4)' }} />

      <label className="t-sm muted">E-mail</label>
      <input className="field" value={email} readOnly disabled style={{ marginTop: 4, marginBottom: 'var(--s-4)' }} />

      <div className="flex items-center" style={{ gap: 'var(--s-3)' }}>
        <span className="chip" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>{papelLabel(papel)}</span>
        <span className="t-xs muted">seu papel (definido pelo admin)</span>
      </div>

      <div className="flex items-center" style={{ gap: 'var(--s-3)', marginTop: 'var(--s-5)' }}>
        <button className="btn btn-primary" onClick={salvar} disabled={pend || !n.trim()}>Salvar</button>
        {msg && <span className="t-sm muted">{msg}</span>}
      </div>
    </div>
  )
}

function TrocarSenha() {
  const [atual, setAtual] = useState('')
  const [nova, setNova] = useState('')
  const [conf, setConf] = useState('')
  const [pend, iniciar] = useTransition()
  const [msg, setMsg] = useState<{ ok: boolean; txt: string } | null>(null)

  const trocar = () => {
    setMsg(null)
    if (nova.length < 8) { setMsg({ ok: false, txt: 'A nova senha precisa de ao menos 8 caracteres.' }); return }
    if (nova !== conf) { setMsg({ ok: false, txt: 'As senhas não conferem.' }); return }
    iniciar(async () => {
      const r = await alterarMinhaSenha(atual, nova)
      if (r.ok) { setAtual(''); setNova(''); setConf(''); setMsg({ ok: true, txt: 'Senha alterada com sucesso.' }) }
      else setMsg({ ok: false, txt: r.erro })
    })
  }

  const invalido = pend || !atual || nova.length < 8 || nova !== conf

  return (
    <div style={{ borderTop: '1px solid var(--hairline)', paddingTop: 'var(--s-6)' }}>
      <div style={{ fontWeight: 700, marginBottom: 'var(--s-3)' }}>Trocar senha</div>

      <label className="t-sm muted">Senha atual</label>
      <input className="field" type="password" value={atual} onChange={e => setAtual(e.target.value)}
        autoComplete="current-password" style={{ marginTop: 4, marginBottom: 'var(--s-4)' }} />

      <label className="t-sm muted">Nova senha (mín. 8 caracteres)</label>
      <input className="field" type="password" value={nova} onChange={e => setNova(e.target.value)}
        autoComplete="new-password" style={{ marginTop: 4, marginBottom: 'var(--s-4)' }} />

      <label className="t-sm muted">Confirmar nova senha</label>
      <input className="field" type="password" value={conf} onChange={e => setConf(e.target.value)}
        autoComplete="new-password" style={{ marginTop: 4, marginBottom: 'var(--s-4)' }} />
      {conf.length > 0 && nova !== conf && (
        <p className="t-xs" style={{ color: 'var(--serious)', marginTop: -8, marginBottom: 'var(--s-3)' }}>As senhas não conferem.</p>
      )}

      <div className="flex items-center" style={{ gap: 'var(--s-3)' }}>
        <button className="btn btn-primary" onClick={trocar} disabled={invalido}>Alterar senha</button>
        {msg && <span className="t-sm" style={{ color: msg.ok ? 'var(--series-3)' : 'var(--serious)' }}>{msg.txt}</span>}
      </div>
    </div>
  )
}
