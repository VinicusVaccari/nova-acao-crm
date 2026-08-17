import Link from 'next/link'
import { carregarEstagios } from '@/lib/estagios-server'
import { EditorEtapas } from '@/components/editor-etapas'

export const dynamic = 'force-dynamic'

export default async function EtapasPage() {
  const estagios = await carregarEstagios()

  return (
    <div className="flex flex-col" style={{ gap: 'var(--s-5)', maxWidth: 760 }}>
      <div>
        <Link href="/pipeline" className="t-sm" style={{ color: 'var(--series-1)', fontWeight: 600 }}>← Pipeline</Link>
        <h1 className="t-h1" style={{ marginTop: 'var(--s-2)' }}>Etapas da pipeline</h1>
        <p className="t-sm muted" style={{ marginTop: 2 }}>
          Renomeie, recolora e reordene as etapas. As regras do funil (transições, probabilidade) seguem as mesmas —
          aqui você muda só como cada etapa aparece.
        </p>
      </div>
      <EditorEtapas estagios={estagios} />
    </div>
  )
}
