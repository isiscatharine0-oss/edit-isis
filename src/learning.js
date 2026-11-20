'use strict';
// Identificação de padrões nas decisões da usuária. Gera SUGESTÕES; nada é aplicado sem aprovação.
const { findSignal } = require('./criteria');
const { removedSentences } = require('./messages');

const MIN_CASES = 3;

/**
 * @param {Array} decided [{ lead_id, decision: 'aprovar'|'rejeitar', signals: [codes], reason }]
 * @param {Object} definition critérios ativos
 */
function weightSuggestions(decided, definition) {
  const stats = {};
  for (const d of decided) {
    for (const s of new Set(d.signals)) {
      stats[s] = stats[s] || { approved: 0, rejected: 0, reasons: [] };
      if (d.decision === 'aprovar') stats[s].approved++;
      if (d.decision === 'rejeitar') { stats[s].rejected++; if (d.reason) stats[s].reasons.push(d.reason); }
    }
  }
  const out = [];
  for (const [code, st] of Object.entries(stats)) {
    const found = findSignal(definition, code);
    if (!found || found.signal.points <= 0) continue;
    const n = st.approved + st.rejected;
    if (n < MIN_CASES) continue;
    const cur = found.signal.points;
    if (st.rejected >= MIN_CASES && st.rejected / n >= 0.7) {
      const next = Math.max(1, Math.round(cur * 0.7));
      if (next < cur) out.push({
        kind: 'peso', target: code,
        payload: { signal: code, criterion: found.criterion.code, from: cur, to: next },
        rationale: `Você rejeitou ${st.rejected} de ${n} leads com o sinal "${found.signal.label}". Sugestão: reduzir de ${cur} para ${next} pontos.`
          + (st.reasons.length ? ` Motivos registrados: ${st.reasons.slice(0, 3).map((r) => `"${r}"`).join('; ')}.` : ''),
      });
    } else if (st.approved >= MIN_CASES && st.approved / n >= 0.8) {
      const next = Math.min(found.criterion.max, Math.round(cur * 1.25));
      if (next > cur) out.push({
        kind: 'peso', target: code,
        payload: { signal: code, criterion: found.criterion.code, from: cur, to: next },
        rationale: `Você aprovou ${st.approved} de ${n} leads com o sinal "${found.signal.label}". Sugestão: aumentar de ${cur} para ${next} pontos.`,
      });
    }
  }
  return out;
}

/** @param {Array} edits [{ message_id, before_text, after_text }] */
function phraseSuggestions(edits, alreadyAvoided = []) {
  const count = {};
  for (const e of edits) {
    for (const s of new Set(removedSentences(e.before_text, e.after_text))) {
      const key = s.toLowerCase().replace(/^(oi|ei|olá),?\s+[^!?,]+[!?,]\s*/i, '').trim();
      if (key.length < 12) continue;
      count[key] = count[key] || new Set();
      count[key].add(e.message_id);
    }
  }
  return Object.entries(count)
    .filter(([k, ids]) => ids.size >= 2 && !alreadyAvoided.some((a) => a.toLowerCase() === k))
    .map(([k, ids]) => ({
      kind: 'frase_evitar', target: k, payload: { phrase: k },
      rationale: `Você removeu a frase "${k}" em ${ids.size} mensagens diferentes. Sugestão: evitar essa frase nas próximas gerações.`,
    }));
}

function applyWeightChange(definition, payload) {
  const def = JSON.parse(JSON.stringify(definition));
  const c = def.criteria.find((x) => x.code === payload.criterion);
  const s = c && c.signals.find((x) => x.code === payload.signal);
  if (!s) throw new Error('Sinal não encontrado na versão ativa dos critérios.');
  s.points = payload.to;
  return def;
}

module.exports = { weightSuggestions, phraseSuggestions, applyWeightChange };
