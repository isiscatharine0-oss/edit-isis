'use strict';
// Motor de pontuação: função pura (sem banco), fácil de testar.
// Compatibilidade (nota 0-100) e confiança (0-100) são calculadas separadamente.
const { RELIABILITY } = require('./criteria');

const DAY = 24 * 3600 * 1000;

function daysBetween(a, b) { return Math.floor((new Date(b) - new Date(a)) / DAY); }

function domainOf(e) {
  if (e.url) { try { return new URL(e.url).hostname.replace(/^www\./, ''); } catch { /* ignora */ } }
  return (e.source_name || '').toLowerCase().trim();
}

/**
 * @param {Array} evidences evidências do lead
 * @param {Object} definition definição de critérios (versão ativa)
 * @param {Object} [opts] { today }
 */
function scoreLead(evidences, definition, opts = {}) {
  const today = opts.today || new Date().toISOString();
  const breakdown = {};
  const justification = [];
  const missing = [];
  const flags = [];

  for (const crit of definition.criteria) {
    const evs = evidences.filter((e) => e.criterion === crit.code);
    let raw = 0;
    let fromHypothesisOnly = true;
    let contributed = false;
    for (const sig of crit.signals) {
      const withSignal = evs.filter((e) => e.signal === sig.code);
      if (!withSignal.length) continue;
      // Usa a evidência mais confiável disponível para o sinal.
      const best = withSignal.reduce((a, b) => (RELIABILITY[b.reliability].factor > RELIABILITY[a.reliability].factor ? b : a));
      const factor = RELIABILITY[best.reliability].factor;
      const pts = Math.round(sig.points * factor * 10) / 10;
      raw += pts;
      contributed = true;
      if (best.reliability !== 'hipotese') fromHypothesisOnly = false;
      justification.push({
        criterion: crit.code, signal: sig.code, label: sig.label, points: pts,
        evidence_id: best.id, reliability: best.reliability, description: best.description,
        source_name: best.source_name, url: best.url || null,
      });
    }
    const points = Math.max(0, Math.min(crit.max, Math.round(raw)));
    breakdown[crit.code] = { label: crit.label, points, max: crit.max };

    if (!evs.length) {
      missing.push(`${crit.label}: nenhuma evidência registrada.`);
    } else if (!contributed) {
      missing.push(`${crit.label}: há registros, mas nenhum ligado a um sinal do ICP.`);
    }
    if (contributed && fromHypothesisOnly && points > 0) {
      flags.push({ code: 'criterio_so_hipoteses', severity: 'atencao',
        message: `${crit.label}: os ${points} pontos vêm apenas de hipóteses ainda não confirmadas.` });
    }
    // Sinais sem evidência neste critério (para mostrar o que falta confirmar).
    const absent = crit.signals.filter((s) => s.points > 0 && !evs.some((e) => e.signal === s.code));
    if (evs.length && absent.length && crit.code !== 'momento') {
      missing.push(`${crit.label} — não confirmado: ${absent.map((s) => s.label.toLowerCase()).join('; ')}.`);
    }
  }

  const total = Object.values(breakdown).reduce((a, b) => a + b.points, 0);

  // ---- Confiança ----
  const solid = evidences.filter((e) => e.reliability !== 'hipotese' && e.criterion !== 'geral');
  const covered = new Set(solid.map((e) => e.criterion));
  // Cobertura por critério: cada evidência sólida vale 7,5 × fator de confiabilidade, até 15 por critério
  // (são necessárias ao menos duas evidências verificadas para cobrir totalmente um critério).
  const coverage = Math.round(definition.criteria.reduce((acc, c) => acc + Math.min(15,
    solid.filter((e) => e.criterion === c.code).reduce((a, e) => a + 7.5 * RELIABILITY[e.reliability].factor, 0)), 0)); // até 60
  const sources = new Set(solid.map(domainOf)).size;
  const sourceScore = Math.min(sources, 4) * 5; // até 20
  const recent = solid.filter((e) => daysBetween(e.consulted_at, today) <= 90).length;
  // Recência pesa proporcionalmente à cobertura: poucas evidências recentes não geram confiança alta.
  const coveredShare = covered.size / definition.criteria.length;
  const recencyScore = solid.length ? Math.round((recent / solid.length) * 20 * coveredShare) : 0; // até 20
  const confidence = Math.min(100, coverage + sourceScore + recencyScore);
  const confidence_level = confidence >= 70 ? 'alta' : confidence >= 40 ? 'media' : 'baixa';

  // ---- Inconsistências ----
  const hasSignal = (code) => evidences.some((e) => e.signal === code);
  if (hasSignal('marketing_estruturado') && total >= 85) {
    flags.push({ code: 'marketing_estruturado_nota_alta', severity: 'revisar',
      message: `Nota ${total} apesar de evidência de marketing já muito desenvolvido. Revise se a oportunidade de marketing é real.` });
  }
  if (total >= 80 && confidence < 40) {
    flags.push({ code: 'nota_alta_confianca_baixa', severity: 'revisar',
      message: `Nota alta (${total}) com confiança baixa (${confidence}). A compatibilidade aparente depende de poucas evidências.` });
  }
  const momentoOld = evidences.filter((e) => e.criterion === 'momento' && e.fact_date && daysBetween(e.fact_date, today) > 365);
  if (momentoOld.length) {
    flags.push({ code: 'momento_desatualizado', severity: 'atencao',
      message: 'Há sinais de momento comercial com mais de 12 meses; podem não refletir o momento atual.' });
  }
  if (!evidences.some((e) => e.criterion === 'marketing')) {
    flags.push({ code: 'sem_analise_conteudo', severity: 'atencao',
      message: 'Nenhuma análise de conteúdo/Instagram registrada. Oportunidade de marketing ainda não avaliada.' });
  }

  // Regra de prioridade (aprovada pela Isis em 21/11/2026): nota alta só é prioritária com estrutura sólida.
  const priorityThreshold = opts.priorityThreshold ?? 90;
  const minStructure = opts.minStructure ?? 0;
  const structure = breakdown.estrutura ? breakdown.estrutura.points : 0;
  const priority = total >= priorityThreshold && structure >= minStructure;
  if (total >= priorityThreshold && structure < minStructure) {
    flags.push({ code: 'estrutura_insuficiente', severity: 'revisar',
      message: `Nota ${total}, mas estrutura ${structure}/35 (mínimo ${minStructure} para prioridade). Estrutura insuficiente para o ticket.` });
  }

  return { total, breakdown, justification, missing, flags, confidence, confidence_level, priority };
}

module.exports = { scoreLead };
