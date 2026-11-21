'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scoreLead } = require('../src/scoring');
const { DEFAULT_CRITERIA } = require('../src/criteria');
const { ev, today } = require('./helpers');

let n = 0;
const e = (o) => ({ id: ++n, ...ev(o) });

test('sem evidências: nota 0, confiança baixa e informações ausentes', () => {
  const s = scoreLead([], DEFAULT_CRITERIA);
  assert.equal(s.total, 0);
  assert.equal(s.confidence_level, 'baixa');
  assert.equal(s.missing.filter((m) => m.includes('nenhuma evidência')).length, 4);
});

test('pesos máximos somam 100 e cada critério respeita seu teto', () => {
  const all = [];
  for (const c of DEFAULT_CRITERIA.criteria) for (const sg of c.signals) if (sg.points > 0) all.push(e({ criterion: c.code, signal: sg.code, url: `https://s${n}.test/` }));
  const s = scoreLead(all, DEFAULT_CRITERIA);
  assert.equal(s.total, 100);
  assert.deepEqual(Object.values(s.breakdown).map((b) => b.points), [35, 30, 20, 15]);
});

test('hipótese vale menos que fato verificado e é sinalizada', () => {
  const ver = scoreLead([e({})], DEFAULT_CRITERIA);
  const hip = scoreLead([e({ reliability: 'hipotese', url: null })], DEFAULT_CRITERIA);
  assert.equal(ver.breakdown.estrutura.points, 12);
  assert.equal(hip.breakdown.estrutura.points, 5);
  assert.ok(hip.flags.some((f) => f.code === 'criterio_so_hipoteses'));
});

test('justificativa aponta evidência e fonte de cada ponto', () => {
  const s = scoreLead([e({})], DEFAULT_CRITERIA);
  assert.equal(s.justification[0].signal, 'consultorio_proprio');
  assert.equal(s.justification[0].url, 'https://exemplo.test/sobre');
});

test('marketing já desenvolvido com nota alta gera alerta de revisão', () => {
  const evs = [];
  for (const c of DEFAULT_CRITERIA.criteria) for (const sg of c.signals) if (sg.points > 0) evs.push(e({ criterion: c.code, signal: sg.code, url: `https://x${n}.test/` }));
  evs.push(e({ criterion: 'marketing', signal: 'marketing_estruturado', url: 'https://y.test/' }));
  const s = scoreLead(evs, DEFAULT_CRITERIA);
  assert.ok(s.total >= 85);
  assert.ok(s.flags.some((f) => f.code === 'marketing_estruturado_nota_alta'));
});

test('compatibilidade e confiança são independentes', () => {
  // Só observações de conteúdo (uma fonte): marketing alto, confiança baixa.
  const evs = ['baixa_presenca_profissional', 'conteudo_generico', 'autoridade_pouco_demonstrada', 'estrutura_maior_que_comunicacao']
    .map((sg) => e({ criterion: 'marketing', signal: sg, reliability: 'observado', url: 'https://instagram.test/p' }));
  const s = scoreLead(evs, DEFAULT_CRITERIA);
  assert.ok(s.breakdown.marketing.points >= 25);
  assert.equal(s.confidence_level, 'baixa');
});

test('momento com mais de 12 meses é sinalizado', () => {
  const s = scoreLead([e({ criterion: 'momento', signal: 'inauguracao_ampliacao', fact_date: '2020-01-01' })], DEFAULT_CRITERIA, { today: today() });
  assert.ok(s.flags.some((f) => f.code === 'momento_desatualizado'));
});

test('prioridade exige estrutura mínima (regra aprovada: 20/35)', () => {
  const evs = [];
  for (const c of DEFAULT_CRITERIA.criteria) for (const sg of c.signals) if (sg.points > 0 && sg.code !== 'consultorio_proprio' && sg.code !== 'equipe') evs.push(e({ criterion: c.code, signal: sg.code, url: `https://p${n}.test/` }));
  const s = scoreLead(evs, DEFAULT_CRITERIA, { priorityThreshold: 80, minStructure: 20 });
  assert.equal(s.breakdown.estrutura.points, 15);
  assert.ok(s.total >= 80);
  assert.equal(s.priority, false);
  assert.ok(s.flags.some((f) => f.code === 'estrutura_insuficiente'));
  const ok = scoreLead([...evs, e({ signal: 'consultorio_proprio', url: 'https://q.test/' })], DEFAULT_CRITERIA, { priorityThreshold: 80, minStructure: 20 });
  assert.equal(ok.priority, true);
});
