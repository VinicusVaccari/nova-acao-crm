import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Existe um package-lock.json no diretório do usuário; sem isto o
  // Turbopack infere a raiz errada do workspace.
  turbopack: { root: __dirname },
}

export default nextConfig
