/* Aponta a versão VIGENTE do prompt. Trocar de versão = criar
   prompt.v3.ts e mudar só este re-export — nunca editar um arquivo de
   versão já usado em produção. */
export * as v3 from './prompt.v3'
export { VERSAO as ATIVO } from './prompt.v3'
