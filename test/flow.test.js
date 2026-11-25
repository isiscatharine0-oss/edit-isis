'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { open } = require('../src/db');
const { createStore } = require('../src/store');
const { fresh, ev, hookEv, approvedLead } = require('./helpers');

test('evita profissionais duplicados (nome+cidade, Instagram)', () => {
  const { store } = fresh();
  const a = store.createLead({ name: 'Dra. Maria Souza', city: 'Salvador', instagram: '@maria.souza' });
  const b = store.createLead({ name: 'Maria Souza', city: 'Salvador - BA' });
  const c = store.createLead({ name: 'Outra Pessoa', instagram: 'https://instagram.com/Maria.Souza/' });
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(c.duplicate, true);
  assert.equal(store.listLeads().length, 1);
});

test('evidência sem fonte ou sem URL (pesquisa) é recusada', () => {
  const { store } = fresh();
  const { lead } = store.createLead({ name: 'X' });
  assert.throws(() => store.addEvidence(lead.id, ev({ source_name: '' })), /fonte/);
  assert.throws(() => store.addEvidence(lead.id, ev({ url: null })), /URL/);
  assert.throws(() => store.addEvidence(lead.id, hookEv({ reliability: 'hipotese', url: null })), /Hipóteses/);
});

test('mensagem só é gerada após aprovação do profissional e a partir de fato real', () => {
  const { store } = fresh();
  const { lead } = store.createLead({ name: 'Dr. Sem Aprovação', city: 'Salvador' });
  store.addEvidence(lead.id, hookEv());
  assert.throws(() => store.generateMessage(lead.id), /Aprove o profissional/);
  const { lead: l2 } = store.createLead({ name: 'Dr. Sem Fato', city: 'Salvador' });
  store.addEvidence(l2.id, ev());
  store.decideLead(l2.id, 'aprovar');
  assert.throws(() => store.generateMessage(l2.id), /fato real/);
});

test('rejeição exige motivo', () => {
  const { store } = fresh();
  const { lead } = store.createLead({ name: 'Y' });
  assert.throws(() => store.decideLead(lead.id, 'rejeitar', ''), /motivo/);
});

test('aprovada não é enviada; envio exige aprovação e é registrado separadamente', () => {
  const { store } = fresh();
  const lead = approvedLead(store);
  const m = store.generateMessage(lead.id);
  assert.match(m.text, /inaugurou seu novo consultório no Itaigara/);
  assert.throws(() => store.confirmSent(m.id), /aprovadas/);
  store.decideMessage(m.id, 'aprovar');
  let met = store.metrics({ include_demo: true }).totals;
  assert.equal(met.mensagens_aprovadas, 1);
  assert.equal(met.mensagens_enviadas, 0);
  assert.equal(store.getMessage(m.id).send_status, 'nao_enviada');
  store.confirmSent(m.id, 'Enviado pelo Instagram');
  met = store.metrics({ include_demo: true }).totals;
  assert.equal(met.mensagens_enviadas, 1);
  assert.equal(store.getLead(lead.id).lead.status, 'contatado');
  assert.throws(() => store.editMessage(m.id, 'outro'), /já enviada/);
});

test('mensagem com promessa ou preço não pode ser aprovada', () => {
  const { store } = fresh();
  const lead = approvedLead(store);
  const m = store.generateMessage(lead.id);
  store.editMessage(m.id, 'Oi! Garanto mais pacientes por R$ 5.000.');
  assert.throws(() => store.decideMessage(m.id, 'aprovar'), /Corrija antes de aprovar/);
});

test('nova versão substitui o rascunho e varia o texto', () => {
  const { store } = fresh();
  const lead = approvedLead(store);
  const m1 = store.generateMessage(lead.id);
  const m2 = store.decideMessage(m1.id, 'nova_versao');
  assert.notEqual(m1.text, m2.text);
  assert.equal(m2.version, 2);
});

test('retomada: só após envio, sem resposta, prazo mínimo e no máximo uma', () => {
  const { db, store } = fresh();
  const lead = approvedLead(store);
  assert.throws(() => store.generateMessage(lead.id, { purpose: 'retomada' }), /depois de a mensagem inicial/);
  const m = store.generateMessage(lead.id);
  store.decideMessage(m.id, 'aprovar');
  store.confirmSent(m.id);
  assert.throws(() => store.generateMessage(lead.id, { purpose: 'retomada' }), /Aguarde/);
  const old = new Date(Date.now() - 10 * 86400000).toISOString();
  db.prepare('UPDATE outreach_message SET sent_at = ? WHERE id = ?').run(old, m.id);
  db.prepare('UPDATE interaction SET occurred_at = ? WHERE message_id = ?').run(old, m.id);
  const r = store.generateMessage(lead.id, { purpose: 'retomada' });
  assert.equal(r.purpose, 'retomada');
  assert.throws(() => store.generateMessage(lead.id, { purpose: 'retomada' }), /uma retomada/);
});

test('pedido de não contato bloqueia mensagens e reimportação', () => {
  const { store } = fresh();
  const lead = approvedLead(store, 'Dra. Bloqueio');
  store.generateMessage(lead.id);
  store.addInteraction(lead.id, { kind: 'pedido_nao_contato', summary: 'Pediu para não receber mensagens' });
  const d = store.getLead(lead.id);
  assert.equal(d.lead.do_not_contact, true);
  assert.ok(d.messages.every((m) => m.approval_status === 'rejeitada'));
  assert.throws(() => store.generateMessage(lead.id), /bloqueado/);
  const imp = store.importRun({ run: { region: 'Salvador - BA' }, leads: [{ name: 'Dra. Bloqueio', city: 'Salvador', relevant_change: 'x' }] });
  assert.equal(imp.run.leads_skipped, 1);
});

test('rejeitados não reaparecem, salvo mudança relevante documentada', () => {
  const { store } = fresh();
  const { lead } = store.createLead({ name: 'Dr. Rejeitado', city: 'Salvador' });
  store.decideLead(lead.id, 'rejeitar', 'Fora do perfil');
  let imp = store.importRun({ run: { region: 'Salvador - BA' }, leads: [{ name: 'Dr. Rejeitado', city: 'Salvador' }] });
  assert.equal(imp.run.leads_skipped, 1);
  imp = store.importRun({ run: { region: 'Salvador - BA' }, leads: [{ name: 'Dr. Rejeitado', city: 'Salvador', relevant_change: 'Inaugurou consultório próprio' }] });
  assert.equal(imp.run.leads_duplicate, 1);
  assert.equal(store.getLead(lead.id).lead.status, 'em_revisao');
});

test('respostas e reuniões atualizam status e indicadores; reunião solicitada ≠ agendada', () => {
  const { store } = fresh();
  const lead = approvedLead(store);
  const m = store.generateMessage(lead.id);
  store.decideMessage(m.id, 'aprovar');
  store.confirmSent(m.id);
  const r = store.addInteraction(lead.id, { kind: 'reuniao_solicitada', summary: 'Quer conversar semana que vem' });
  assert.ok(r.interaction.next_action, 'deve notificar a Isis');
  let t = store.metrics({ include_demo: true }).totals;
  assert.equal(t.respostas_recebidas, 1);
  assert.equal(t.reunioes_solicitadas, 1);
  assert.equal(t.reunioes_agendadas, 0);
  store.addInteraction(lead.id, { kind: 'reuniao_agendada', summary: 'Terça 15h' });
  t = store.metrics({ include_demo: true }).totals;
  assert.equal(t.reunioes_agendadas, 1);
  assert.equal(store.getLead(lead.id).lead.status, 'reuniao_agendada');
  assert.equal(store.pendingActions().length, 1);
});

test('dados de demonstração ficam fora dos indicadores por padrão', () => {
  const { store } = fresh();
  approvedLead(store);
  assert.equal(store.metrics({}).totals.perfis_aprovados, 0);
  assert.equal(store.metrics({ include_demo: true }).totals.perfis_aprovados, 1);
});

test('aprendizado sugere ajuste, mas só aplica após aprovação e cria nova versão', () => {
  const { store } = fresh();
  for (let i = 0; i < 3; i++) {
    const { lead } = store.createLead({ name: `Dr. Sofisticado ${i}`, city: 'Salvador' });
    store.addEvidence(lead.id, ev({ signal: 'expansao_estrutura', description: 'Consultório recém-reformado', url: `https://e${i}.test/` }));
    store.decideLead(lead.id, 'rejeitar', 'Consultório bonito, mas sem estrutura operacional');
  }
  const before = store.activeCriteria();
  const r = store.analyzeLearning();
  const sug = r.suggestions.find((s) => s.target === 'expansao_estrutura');
  assert.ok(sug, 'deve sugerir redução');
  assert.equal(store.activeCriteria().version, before.version, 'não pode alterar sozinho');
  store.decideSuggestion(sug.id, 'aprovar');
  const after = store.activeCriteria();
  assert.equal(after.version, before.version + 1);
  const pts = after.definition.criteria[0].signals.find((s) => s.code === 'expansao_estrutura').points;
  assert.ok(pts < 7);
  assert.equal(store.criteriaHistory().length, 2);
});

test('frases removidas repetidamente viram sugestão de "evitar"', () => {
  const { store } = fresh();
  for (let i = 0; i < 2; i++) {
    const lead = approvedLead(store, `Dra. Frase ${i}`);
    const m = store.generateMessage(lead.id);
    const extra = `${m.text} Achei muito bacana mesmo.`;
    store.editMessage(m.id, extra);
    store.editMessage(m.id, m.text);
  }
  const r = store.analyzeLearning();
  assert.ok(r.suggestions.some((s) => s.kind === 'frase_evitar' && s.target.includes('achei muito bacana mesmo')));
});

test('referências são classificadas e não recebem abordagem', () => {
  const { store } = fresh();
  const { lead } = store.createLead({ name: 'Ref', instagram: '@ref.saude', reference_label: 'ideal' });
  assert.equal(lead.is_reference, true);
  assert.throws(() => store.decideLead(lead.id, 'aprovar'), /referência/);
  assert.equal(store.listLeads().length, 0);
  assert.equal(store.listLeads({ reference: 'only' }).length, 1);
});

test('histórico persiste após reiniciar a aplicação', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isis-'));
  const file = path.join(dir, 't.db');
  let db = open(file);
  let store = createStore(db);
  const lead = approvedLead(store);
  const m = store.generateMessage(lead.id);
  store.decideMessage(m.id, 'aprovar');
  store.confirmSent(m.id);
  db.close();
  db = open(file);
  store = createStore(db);
  const d = store.getLead(lead.id);
  assert.equal(d.messages[0].send_status, 'enviada');
  assert.equal(d.approvals.length, 2);
  assert.ok(d.score.total > 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('reimportar a mesma pesquisa não duplica evidências', () => {
  const { store } = fresh();
  const payload = { run: { region: 'Salvador - BA' }, leads: [{ name: 'Dra. Repetida', city: 'Salvador', evidence: [ev()] }] };
  store.importRun(payload);
  store.importRun(payload);
  assert.equal(store.listLeads()[0] && store.getLead(store.listLeads()[0].id).evidence.length, 1);
});

test('integrações pagas ficam bloqueadas por padrão (operação sem custos)', () => {
  const { store } = fresh();
  const providers = require('../src/providers');
  process.env.GOOGLE_PLACES_API_KEY = 'chave-teste';
  try {
    const gp = providers.list(store.getSettings()).find((p) => p.id === 'google_places');
    assert.equal(store.getSettings().allow_paid_integrations, false);
    assert.equal(gp.available, false);
    assert.match(gp.detail, /sem custos/);
  } finally { delete process.env.GOOGLE_PLACES_API_KEY; }
});

test('reimportação completa campos vazios e aplica decisão informada pela usuária', () => {
  const { store } = fresh();
  store.importRun({ run: { region: 'Salvador - BA' }, leads: [{ name: 'Dr. Campo Vazio', city: 'Salvador', evidence: [ev()] }] });
  const r = store.importRun({ run: { region: 'Salvador - BA' }, leads: [{ name: 'Dr. Campo Vazio', city: 'Salvador', instagram: '@dr.campo',
    user_decision: { decision: 'aprovar', notes: 'Aprovado pela Isis' } }] });
  const d = store.getLead(r.details[0].lead_id);
  assert.equal(d.lead.instagram, 'dr.campo');
  assert.equal(d.lead.status, 'aprovado');
  assert.equal(d.approvals[0].notes, 'Aprovado pela Isis');
});

test('resposta a story: curta, sem saudação formal, com alerta de story antigo', () => {
  const { store } = fresh();
  const { lead } = store.createLead({ name: 'Dra. Story', city: 'Salvador', address_as: 'doutora' });
  store.addEvidence(lead.id, ev());
  store.addEvidence(lead.id, hookEv({ source_name: 'Instagram (story)', hook_type: 'inauguracao', hook_text: 'mostrou a sala nova do consultório', fact_date: new Date().toISOString().slice(0, 10) }));
  store.decideLead(lead.id, 'aprovar');
  const m = store.generateMessage(lead.id, { channel: 'story' });
  assert.equal(m.channel, 'story');
  assert.doesNotMatch(m.text, /Tudo bem/);
  assert.match(m.text, /mostrou a sala nova do consultório/);
  assert.ok(m.text.length <= 160);
  assert.ok(!m.warnings.some((w) => w.code === 'story_expirado'));
  const { lead: l2 } = store.createLead({ name: 'Dr. Story Antigo', city: 'Salvador' });
  store.addEvidence(l2.id, hookEv({ fact_date: '2026-01-01' }));
  store.decideLead(l2.id, 'aprovar');
  assert.ok(store.generateMessage(l2.id, { channel: 'story' }).warnings.some((w) => w.code === 'story_expirado'));
});

test('ideia de conteúdo reproduz a estrutura da mensagem real da Isis', () => {
  const { store } = fresh();
  const { lead } = store.createLead({ name: 'Dra. Mirela Exemplo', city: 'Salvador' });
  store.addEvidence(lead.id, ev());
  store.decideLead(lead.id, 'aprovar');
  assert.throws(() => store.generateMessage(lead.id, { channel: 'ideia', idea: { nome: 'X' } }), /Preencha/);
  const m = store.generateMessage(lead.id, { channel: 'ideia', idea: {
    observacao: 'fala sobre longevidade a partir da prevenção', nome: 'Isso é da idade mesmo?',
    descricao: 'partir de situações que muitas pessoas normalizam com o passar dos anos', porque: 'perceber que envelhecer bem não é aceitar todo desconforto' } });
  assert.match(m.text, /^Oi, Dra\. Mirela! Conheci seu perfil e gostei muito da forma como você fala sobre longevidade/);
  assert.match(m.text, /quadro chamado “Isso é da idade mesmo\?”\. Em cada vídeo, você poderia partir/);
  assert.match(m.text, /Sou a Isis e trabalho com estratégia e gestão de redes sociais\..*Teria interesse em conversar sobre esse trabalho para o seu perfil\?$/s);
  assert.equal(m.channel, 'ideia');
  assert.deepEqual(m.warnings.filter((w) => w.code === 'longa'), []);
});

test('ideia com elogio na abertura e sem apresentação quando desmarcado', () => {
  const { store } = fresh();
  const { lead } = store.createLead({ name: 'Dra. Elogio Teste', city: 'Salvador' });
  store.addEvidence(lead.id, ev());
  store.decideLead(lead.id, 'aprovar');
  const m = store.generateMessage(lead.id, { channel: 'ideia', idea: { elogio: 'Fiquei impressionada com seus resultados', nome: 'Q', descricao: 'mostrar algo', apresentar: false } });
  assert.match(m.text, /^Oi, Dra\. Elogio! Tudo bem\? Fiquei impressionada com seus resultados\./);
  assert.match(m.text, /O que você acha dessa ideia\?$/);
});
