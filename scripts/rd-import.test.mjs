import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv,eligible } from './rd-csv.mjs'
import { rdDate,money,phones,normalize,resolveContacts } from './rd-import.mjs'

test('CSV mantém aspas, vírgulas internas, acentos e quebras de linha',()=>{
  assert.deepEqual(parseCsv('sep=,\r\nNome,Etapa\r\n"Lu, Ana","Apresentação ""A""\nsegunda linha"\r\n'),[{Nome:'Lu, Ana',Etapa:'Apresentação "A"\nsegunda linha'}])
  assert.throws(()=>parseCsv('A,B\nx,y,z'))
  assert.throws(()=>parseCsv('A,B\n"x,y'))
})
test('somente estados autorizados e pausa explicitamente negativa',()=>{
  for(const Estado of ['Em Andamento','Vendida']) assert.equal(eligible({Estado,Pausada:'Não'}),true)
  for(const Estado of ['Perdida','Pausada','Qualificado','']) assert.equal(eligible({Estado,Pausada:'Não'}),false)
  for(const Pausada of ['Sim','','talvez']) assert.equal(eligible({Estado:'Vendida',Pausada}),false)
})
test('valores e datas preservam centavos, fuso e rejeitam entradas inválidas',()=>{
  assert.equal(money('8099.0'),8099);assert.equal(money('3632.40'),3632.4)
  for(const x of ['1,200','R$ 500','-5','','1.123']) assert.throws(()=>money(x))
  assert.equal(rdDate('08/10/2025','17:20'),'2025-10-08T20:20:00.000Z')
  assert.throws(()=>rdDate('31/02/2026','10:00'))
  assert.deepEqual(phones('(11) 99999-1234;+5511999991234'),['+5511999991234'])
})
test('status vendido prevalece sobre etapa antiga; aberto em Venda exige mapeamento',()=>{
  const row={ID:'rd1',Nome:'Pessoa',Contatos:'Pessoa',Empresa:'',Telefone:'',Email:'',Estado:'Vendida',Pausada:'Não',Etapa:'Desqualificado','Data de criação':'01/01/2025','Hora de criação':'08:00','Data de fechamento':'01/02/2025','Hora de fechamento':'12:00','Valor Único':'810.0','Valor Recorrente':'0.0','Qualificação':'3'}
  assert.equal(normalize(row,{}).stage,'ganho')
  const open={...row,Estado:'Em Andamento',Etapa:'Venda','Data de fechamento':'','Hora de fechamento':''}
  assert.throws(()=>normalize(open,{}))
  assert.equal(normalize(open,{openSaleStage:'negociacao'}).sold,false)
  assert.throws(()=>normalize(open,{openSaleStage:'ganho'}))
  assert.equal(normalize({...row,Email:'oi@exemplo.com'},{}).email,null)
})
test('telefone/email conflitantes não fundem pessoas',()=>{
  const ctx={people:[{id:'a',phone_primary:'+5511999991234'},{id:'b',email_primary:'pessoa@empresa.com'}],identities:[],companies:[]}
  assert.throws(()=>resolveContacts([{title:'Pessoa',phones:['+5511999991234'],email:'pessoa@empresa.com',externalContact:'rd:1'}],ctx),/Identidades conflitantes/)
})
