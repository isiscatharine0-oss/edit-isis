'use strict';
// Regras de negócio sobre o banco: leads, evidências, aprovações, mensagens, interações, rodadas e aprendizado.
const { tx, nowIso } = require('./db');
const { RELIABILITY, HOOK_TYPES } = require('./criteria');
const { scoreLead } = require('./scoring');
const dedup = require('./dedup');
const messages = require('./messages');
const playbook = require('./playbook');
const learning = require('./learning');

class RuleError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

const CRITERIA_CODES = ['estrutura', 'marketing', 'autoridade', 'momento', 'geral'];
const LEAD_STATUSES = ['novo', 'em_revisao', 'mais_pesquisa', 'aprovado', 'rejeitado', 'contatado', 'respondeu',
  'reuniao_solicitada', 'reuniao_agendada', 'nao_contatar'];
const OUTREACH_OK = ['aprovado', 'contatado', 'respondeu', 'reuniao_solicitada', 'reuniao_agendada'];
const PIPELINE_RANK = { contatado: 1, respondeu: 2, reuniao_solicitada: 3, reuniao_agendada: 4 };
const LEAD_DECISIONS = { aprovar: 'aprovado', rejeitar: 'rejeitado', mais_pesquisa: 'mais_pesquisa', em_revisao: 'em_revisao' };
const REFERENCE_LABELS = { ideal: 'Cliente ideal', potencial: 'Cliente com potencial', fora: 'Fora do público' };

const J = (v) => JSON.stringify(v ?? null);
const P = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

function createStore(db) {
  const q = (sql) => db.prepare(sql);

  function audit(action, entity, id, details) {
    q('INSERT INTO audit_log (action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(action, entity, id ?? null, J(details), nowIso());
  }

  // ---------- Configurações ----------
  function getSettings() {
    const out = {};
    for (const r of q('SELECT key, value FROM setting').all()) out[r.key] = P(r.value);
    return out;
  }
  function updateSettings(patch) {
    const cur = getSettings();
    const allowed = Object.keys(cur);
    const up = q('UPDATE setting SET value = ? WHERE key = ?');
    for (const [k, v] of Object.entries(patch || {})) {
      if (!allowed.includes(k)) throw new RuleError(`Configuração desconhecida: ${k}`);
      if (k === 'avoid_phrases') throw new RuleError('Frases a evitar mudam por sugestão aprovada ou na tela de Aprendizado.');
      up.run(J(v), k);
    }
    audit('configuracao_alterada', 'setting', null, patch);
    return getSettings();
  }

  // ---------- Critérios ----------
  function activeCriteria() {
    const r = q("SELECT * FROM criteria_version WHERE status = 'ativa' ORDER BY version DESC LIMIT 1").get();
    return { ...r, definition: P(r.definition) };
  }
  function criteriaHistory() {
    return q('SELECT * FROM criteria_version ORDER BY version DESC').all().map((r) => ({ ...r, definition: P(r.definition) }));
  }

  // ---------- Leads ----------
  function rowToLead(r) {
    if (!r) return null;
    return { ...r, other_links: P(r.other_links, []), is_reference: !!r.is_reference, is_demo: !!r.is_demo, do_not_contact: !!r.do_not_contact };
  }
  function getLeadRow(id) {
    const r = q('SELECT * FROM lead WHERE id = ?').get(id);
    if (!r) throw new RuleError('Lead não encontrado.', 404);
    return r;
  }

  function createLead(data, opts = {}) {
    if (!data || !String(data.name || '').trim()) throw new RuleError('Nome é obrigatório.');
    const dup = dedup.findDuplicate(db, data);
    if (dup) return { lead: rowToLead(dup.lead), duplicate: true, reason: dup.reason };
    const t = nowIso();
    const label = data.reference_label || null;
    if (label && !REFERENCE_LABELS[label]) throw new RuleError('Classificação de referência inválida (ideal, potencial ou fora).');
    const info = q(`INSERT INTO lead (name, address_as, specialty, city, state, neighborhood, instagram, website, other_links, registry,
      is_reference, reference_label, is_demo, status, dedup_name, research_run_id, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'novo', ?, ?, ?, ?, ?)`).run(
      data.name.trim(), data.address_as || null, data.specialty || null, data.city || null, data.state || null, data.neighborhood || null,
      dedup.normalizeInstagram(data.instagram), data.website || null, J(data.other_links || []), dedup.normalizeRegistry(data.registry),
      data.is_reference || label ? 1 : 0, label, data.is_demo ? 1 : 0, dedup.normalizeName(data.name),
      opts.runId || null, data.notes || null, t, t);
    const id = Number(info.lastInsertRowid);
    audit('lead_criado', 'lead', id, { origin: opts.origin || 'usuaria', run: opts.runId || null });
    rescore(id);
    return { lead: rowToLead(getLeadRow(id)), duplicate: false };
  }

  function updateLead(id, patch) {
    const cur = getLeadRow(id);
    const fields = ['name', 'address_as', 'specialty', 'city', 'state', 'neighborhood', 'instagram', 'website', 'registry', 'notes', 'reference_label'];
    const next = { ...cur };
    for (const f of fields) if (f in patch) next[f] = patch[f] === '' ? null : patch[f];
    if (next.reference_label && !REFERENCE_LABELS[next.reference_label]) throw new RuleError('Classificação de referência inválida.');
    if ('other_links' in patch) next.other_links = J(patch.other_links || []);
    if ('is_reference' in patch) next.is_reference = patch.is_reference ? 1 : 0;
    if (next.reference_label) next.is_reference = 1;
    next.instagram = dedup.normalizeInstagram(next.instagram);
    next.registry = dedup.normalizeRegistry(next.registry);
    if (next.instagram && next.instagram !== cur.instagram) {
      const other = q('SELECT id FROM lead WHERE instagram = ? AND id <> ?').get(next.instagram, id);
      if (other) throw new RuleError(`Esse Instagram já pertence ao lead #${other.id}.`);
    }
    q(`UPDATE lead SET name=?, address_as=?, specialty=?, city=?, state=?, neighborhood=?, instagram=?, website=?, registry=?, notes=?,
      reference_label=?, is_reference=?, other_links=?, dedup_name=?, updated_at=? WHERE id=?`).run(
      next.name, next.address_as, next.specialty, next.city, next.state, next.neighborhood, next.instagram, next.website, next.registry,
      next.notes, next.reference_label, next.is_reference, next.other_links, dedup.normalizeName(next.name), nowIso(), id);
    if ('reference_label' in patch && patch.reference_label !== cur.reference_label) {
      q('INSERT INTO feedback (lead_id, kind, decision, reason, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, 'classificacao_referencia', patch.reference_label, patch.reference_reason || null, nowIso());
    }
    audit('lead_editado', 'lead', id, patch);
    return getLead(id);
  }

  function latestScore(leadId) {
    const r = q('SELECT s.*, c.version AS criteria_version FROM lead_score s JOIN criteria_version c ON c.id = s.criteria_version_id WHERE lead_id = ? ORDER BY s.id DESC LIMIT 1').get(leadId);
    if (!r) return null;
    return { ...r, breakdown: P(r.breakdown), justification: P(r.justification), missing: P(r.missing), flags: P(r.flags) };
  }

  function listLeads(f = {}) {
    let rows = q('SELECT * FROM lead ORDER BY id').all().map(rowToLead);
    rows = rows.map((l) => {
      const s = latestScore(l.id);
      const opp = s ? s.justification.filter((j) => (j.criterion === 'marketing' || j.criterion === 'momento') && j.points > 0).slice(0, 3).map((j) => j.label) : [];
      return { ...l, score: s ? s.total : null, confidence: s ? s.confidence : null, confidence_level: s ? s.confidence_level : null,
        flags: s ? s.flags : [], opportunities: opp, breakdown: s ? s.breakdown : null };
    });
    if (f.reference === 'only') rows = rows.filter((l) => l.is_reference);
    else if (f.reference !== 'all') rows = rows.filter((l) => !l.is_reference);
    if (f.min_score) rows = rows.filter((l) => (l.score ?? 0) >= Number(f.min_score));
    if (f.specialty) rows = rows.filter((l) => (l.specialty || '').toLowerCase().includes(String(f.specialty).toLowerCase()));
    if (f.city) rows = rows.filter((l) => (l.city || '').toLowerCase().includes(String(f.city).toLowerCase()));
    if (f.status) rows = rows.filter((l) => l.status === f.status);
    if (f.confidence) rows = rows.filter((l) => l.confidence_level === f.confidence);
    if (f.demo === 'hide') rows = rows.filter((l) => !l.is_demo);
    if (f.approval) {
      const map = { pendente: ['novo', 'em_revisao', 'mais_pesquisa'], aprovado: OUTREACH_OK, rejeitado: ['rejeitado', 'nao_contatar'] };
      const allowed = map[f.approval] || [];
      rows = rows.filter((l) => allowed.includes(l.status));
    }
    if (f.run) rows = rows.filter((l) => l.research_run_id === Number(f.run));
    rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.id - a.id);
    return rows;
  }

  function getLead(id) {
    const lead = rowToLead(getLeadRow(id));
    const evidence = q('SELECT * FROM evidence WHERE lead_id = ? ORDER BY criterion, id').all(id);
    const score = latestScore(id);
    const scoreHistory = q('SELECT s.id, s.total, s.confidence, s.created_at, c.version FROM lead_score s JOIN criteria_version c ON c.id = s.criteria_version_id WHERE lead_id = ? ORDER BY s.id DESC').all(id);
    const approvals = q('SELECT * FROM approval WHERE lead_id = ? ORDER BY id DESC').all(id);
    const msgs = q('SELECT * FROM outreach_message WHERE lead_id = ? ORDER BY id DESC').all(id).map((m) => ({
      ...m, warnings: P(m.warnings, []),
      edits: q('SELECT * FROM message_edit WHERE message_id = ? ORDER BY id').all(m.id),
    }));
    const interactions = q('SELECT * FROM interaction WHERE lead_id = ? ORDER BY occurred_at DESC, id DESC').all(id);
    const feedback = q('SELECT * FROM feedback WHERE lead_id = ? ORDER BY id DESC').all(id);
    const run = lead.research_run_id ? q('SELECT id, label, region, created_at FROM research_run WHERE id = ?').get(lead.research_run_id) : null;
    return { lead, evidence, score, scoreHistory, approvals, messages: msgs, interactions, feedback, run };
  }

  // ---------- Evidências e pontuação ----------
  function addEvidence(leadId, e) {
    getLeadRow(leadId);
    if (!CRITERIA_CODES.includes(e.criterion)) throw new RuleError('Critério inválido.');
    if (!RELIABILITY[e.reliability]) throw new RuleError('Grau de confiabilidade inválido.');
    if (!String(e.description || '').trim()) throw new RuleError('Descreva a evidência.');
    if (!String(e.source_name || '').trim()) throw new RuleError('Toda evidência precisa de fonte.');
    const origin = e.origin || 'usuaria';
    if (!e.url && origin !== 'usuaria' && e.reliability !== 'hipotese') throw new RuleError('Evidência de pesquisa precisa de URL da fonte.');
    if (e.url && !/^https?:\/\//i.test(e.url)) throw new RuleError('URL inválida.');
    if (e.signal) {
      const def = activeCriteria().definition;
      const crit = def.criteria.find((c) => c.code === e.criterion);
      if (!crit || !crit.signals.some((s) => s.code === e.signal)) throw new RuleError('Sinal não pertence ao critério escolhido.');
    }
    if (e.hook_type && !HOOK_TYPES[e.hook_type]) throw new RuleError('Tipo de referência de abordagem inválido.');
    if (e.hook_type && e.reliability === 'hipotese') throw new RuleError('Hipóteses não podem ser usadas como fato de abordagem.');
    if (e.hook_type && !String(e.hook_text || '').trim()) throw new RuleError('Informe o texto do fato que será citado na abordagem.');
    const consulted = e.consulted_at || nowIso().slice(0, 10);
    const info = q(`INSERT INTO evidence (lead_id, criterion, signal, description, source_name, url, consulted_at, fact_date, reliability,
      origin, hook_type, hook_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      leadId, e.criterion, e.signal || null, e.description.trim(), e.source_name.trim(), e.url || null, consulted, e.fact_date || null,
      e.reliability, origin, e.hook_type || null, e.hook_type ? e.hook_text.trim() : null, nowIso());
    q('UPDATE lead SET updated_at = ? WHERE id = ?').run(nowIso(), leadId);
    audit('evidencia_adicionada', 'evidence', Number(info.lastInsertRowid), { lead: leadId });
    rescore(leadId);
    return q('SELECT * FROM evidence WHERE id = ?').get(info.lastInsertRowid);
  }

  function deleteEvidence(id) {
    const e = q('SELECT * FROM evidence WHERE id = ?').get(id);
    if (!e) throw new RuleError('Evidência não encontrada.', 404);
    const used = q('SELECT COUNT(*) n FROM outreach_message WHERE reference_evidence_id = ?').get(id).n;
    if (used) throw new RuleError('Evidência já usada em uma abordagem; não pode ser removida (preserva o histórico).');
    q('DELETE FROM evidence WHERE id = ?').run(id);
    audit('evidencia_removida', 'evidence', id, e);
    rescore(e.lead_id);
    return { ok: true };
  }

  function rescore(leadId) {
    const crit = activeCriteria();
    const evs = q('SELECT * FROM evidence WHERE lead_id = ?').all(leadId);
    const s = scoreLead(evs, crit.definition);
    const prev = latestScore(leadId);
    if (prev && prev.criteria_version_id === crit.id && prev.total === s.total && prev.confidence === s.confidence
      && J(prev.justification) === J(s.justification) && J(prev.flags) === J(s.flags)) return prev;
    q(`INSERT INTO lead_score (lead_id, criteria_version_id, total, breakdown, justification, missing, flags, confidence, confidence_level, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(leadId, crit.id, s.total, J(s.breakdown), J(s.justification), J(s.missing), J(s.flags),
      s.confidence, s.confidence_level, nowIso());
    return latestScore(leadId);
  }

  // ---------- Aprovação 1: profissional ----------
  function decideLead(leadId, decision, notes) {
    const lead = getLeadRow(leadId);
    if (!LEAD_DECISIONS[decision]) throw new RuleError('Decisão inválida (aprovar, rejeitar, mais_pesquisa, em_revisao).');
    if (lead.is_reference) throw new RuleError('Perfis de referência são classificados (ideal/potencial/fora), não aprovados para prospecção.');
    if (lead.do_not_contact && decision === 'aprovar') throw new RuleError('Este profissional pediu para não ser contatado.');
    if (decision === 'rejeitar' && !String(notes || '').trim()) throw new RuleError('Explique o motivo da rejeição: é assim que o agente aprende.');
    if (PIPELINE_RANK[lead.status] && decision !== 'rejeitar') throw new RuleError('O contato já está em andamento; registre interações em vez de reavaliar.');
    return tx(db, () => {
      q('INSERT INTO approval (lead_id, kind, decision, notes, created_at) VALUES (?, ?, ?, ?, ?)').run(leadId, 'lead', decision, notes || null, nowIso());
      q('INSERT INTO feedback (lead_id, kind, decision, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(leadId, 'decisao_lead', decision, notes || null, nowIso());
      q('UPDATE lead SET status = ?, updated_at = ? WHERE id = ?').run(LEAD_DECISIONS[decision], nowIso(), leadId);
      if (decision === 'rejeitar') {
        q("UPDATE outreach_message SET approval_status = 'rejeitada', updated_at = ? WHERE lead_id = ? AND send_status = 'nao_enviada' AND approval_status IN ('rascunho','aprovada')").run(nowIso(), leadId);
      }
      audit('lead_decidido', 'lead', leadId, { decision, notes });
      return getLead(leadId);
    });
  }

  // ---------- Mensagens ----------
  function templateUsage() {
    const out = {};
    for (const r of q('SELECT template_id, COUNT(*) n FROM outreach_message WHERE template_id IS NOT NULL GROUP BY template_id').all()) out[r.template_id] = r.n;
    return out;
  }

  function generateMessage(leadId, opts = {}) {
    const lead = rowToLead(getLeadRow(leadId));
    const purpose = opts.purpose || 'inicial';
    const settings = getSettings();
    const all = q('SELECT * FROM outreach_message WHERE lead_id = ? ORDER BY id').all(leadId);
    const sentInitial = all.find((m) => m.purpose === 'inicial' && m.send_status === 'enviada');

    if (lead.is_reference) throw new RuleError('Perfis de referência não recebem abordagem.');
    if (lead.do_not_contact && !(purpose === 'resposta' && opts.reply_kind === 'pedido_nao_contato')) throw new RuleError('Contato bloqueado: o profissional pediu para não ser contatado.');
    if (!OUTREACH_OK.includes(lead.status) && lead.status !== 'nao_contatar') throw new RuleError('Aprove o profissional antes de gerar uma abordagem (primeira aprovação).');

    let text; let templateId = null; let evidence = null; let referenceText = null; let generator = 'modelo-local';
    if (purpose === 'inicial') {
      if (sentInitial) throw new RuleError('A mensagem inicial já foi enviada. Use retomada ou resposta.');
      const evs = q("SELECT * FROM evidence WHERE lead_id = ? AND hook_type IS NOT NULL AND reliability <> 'hipotese' ORDER BY id DESC").all(leadId);
      evidence = opts.evidence_id ? evs.find((e) => e.id === Number(opts.evidence_id)) : evs[0];
      if (!evidence) throw new RuleError('Não há fato real verificável marcado como referência de abordagem. Registre uma evidência com "usar na abordagem".');
      const version = all.filter((m) => m.purpose === 'inicial').length + 1;
      const g = messages.generate({ lead, evidence, purpose, version, usage: templateUsage(), avoidPhrases: settings.avoid_phrases });
      text = g.text; templateId = g.template_id; referenceText = `${HOOK_TYPES[evidence.hook_type]}: ${evidence.description}`;
    } else if (purpose === 'retomada') {
      if (!sentInitial) throw new RuleError('Só é possível retomar depois de a mensagem inicial ser enviada.');
      if (all.some((m) => m.purpose === 'retomada' && m.approval_status !== 'rejeitada' && m.approval_status !== 'substituida')) {
        throw new RuleError('Já existe uma retomada para este contato. O limite é uma retomada.');
      }
      const replied = q("SELECT COUNT(*) n FROM interaction WHERE lead_id = ? AND occurred_at >= ? AND kind NOT IN ('mensagem_enviada','sem_resposta','nota')").get(leadId, sentInitial.sent_at).n;
      if (replied) throw new RuleError('O profissional já respondeu; use uma resposta em vez de retomada.');
      const days = (Date.now() - new Date(sentInitial.sent_at)) / 86400000;
      if (days < settings.followup_min_days) throw new RuleError(`Aguarde pelo menos ${settings.followup_min_days} dias após o envio para retomar (passaram ${Math.floor(days)}).`);
      const g = messages.generate({ lead, purpose, version: 1, usage: templateUsage(), avoidPhrases: settings.avoid_phrases });
      text = g.text; templateId = g.template_id; referenceText = 'Retomada contextual única após ausência de resposta.';
    } else if (purpose === 'resposta') {
      const sug = playbook.suggest(opts.reply_kind, lead);
      if (!sug.text) throw new RuleError('Não há sugestão de resposta para essa situação.');
      text = sug.text; generator = 'roteiro'; referenceText = `Resposta: ${(playbook.INTERACTION_KINDS[opts.reply_kind] || {}).label || opts.reply_kind}`;
    } else {
      throw new RuleError('Finalidade inválida.');
    }

    return tx(db, () => {
      q("UPDATE outreach_message SET approval_status = 'substituida', updated_at = ? WHERE lead_id = ? AND purpose = ? AND approval_status = 'rascunho' AND send_status = 'nao_enviada'")
        .run(nowIso(), leadId, purpose);
      const version = q('SELECT COUNT(*) n FROM outreach_message WHERE lead_id = ? AND purpose = ?').get(leadId, purpose).n + 1;
      const v = messages.validate(text, { purpose, avoidPhrases: settings.avoid_phrases });
      if (purpose === 'resposta') {
        const asked = all.filter((m) => m.purpose === 'resposta' && m.send_status === 'enviada').reduce((n, m) => n + messages.countQuestions(m.text), 0);
        if (asked + messages.countQuestions(text) > settings.max_qualification_questions) {
          v.warnings.push({ code: 'perguntas', message: `Já foram feitas ${asked} pergunta(s) nas respostas enviadas; o limite antes da reunião é ${settings.max_qualification_questions}. Evite interrogatório.` });
        }
      }
      const info = q(`INSERT INTO outreach_message (lead_id, purpose, reply_kind, text, original_text, reference_evidence_id, reference_text, template_id,
        generator, version, approval_status, send_status, warnings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'rascunho', 'nao_enviada', ?, ?, ?)`)
        .run(leadId, purpose, opts.reply_kind || null, text, text, evidence ? evidence.id : null, referenceText, templateId, generator, version,
          J([...v.errors, ...v.warnings]), nowIso(), nowIso());
      audit('mensagem_gerada', 'outreach_message', Number(info.lastInsertRowid), { lead: leadId, purpose });
      return getMessage(Number(info.lastInsertRowid));
    });
  }

  function getMessage(id) {
    const m = q('SELECT * FROM outreach_message WHERE id = ?').get(id);
    if (!m) throw new RuleError('Mensagem não encontrada.', 404);
    return { ...m, warnings: P(m.warnings, []) };
  }

  function editMessage(id, text) {
    const m = getMessage(id);
    if (m.send_status === 'enviada') throw new RuleError('Mensagem já enviada não pode ser editada.');
    if (['rejeitada', 'substituida'].includes(m.approval_status)) throw new RuleError('Mensagem rejeitada/substituída; gere uma nova versão.');
    const t = String(text || '').trim();
    if (!t) throw new RuleError('Texto vazio.');
    if (t === m.text) return m;
    const settings = getSettings();
    const v = messages.validate(t, { purpose: m.purpose, avoidPhrases: settings.avoid_phrases });
    return tx(db, () => {
      q('INSERT INTO message_edit (message_id, before_text, after_text, created_at) VALUES (?, ?, ?, ?)').run(id, m.text, t, nowIso());
      q("UPDATE outreach_message SET text = ?, approval_status = 'rascunho', warnings = ?, updated_at = ? WHERE id = ?").run(t, J([...v.errors, ...v.warnings]), nowIso(), id);
      const removed = messages.removedSentences(m.text, t);
      q('INSERT INTO feedback (lead_id, message_id, kind, decision, reason, pattern, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(m.lead_id, id, 'correcao_mensagem', 'editada', null, removed.length ? `Removido: ${removed.join(' | ')}` : null, nowIso());
      audit('mensagem_editada', 'outreach_message', id, null);
      return getMessage(id);
    });
  }

  function decideMessage(id, decision, notes) {
    const m = getMessage(id);
    const lead = getLeadRow(m.lead_id);
    if (m.send_status === 'enviada') throw new RuleError('Mensagem já enviada.');
    if (m.approval_status !== 'rascunho' && m.approval_status !== 'aprovada') throw new RuleError('Esta versão não está mais ativa.');
    if (!['aprovar', 'rejeitar', 'nova_versao'].includes(decision)) throw new RuleError('Decisão inválida (aprovar, rejeitar, nova_versao).');
    if (decision === 'aprovar') {
      if (!OUTREACH_OK.includes(lead.status) && !(m.reply_kind === 'pedido_nao_contato')) throw new RuleError('O profissional não está aprovado.');
      const v = messages.validate(m.text, { purpose: m.purpose, avoidPhrases: getSettings().avoid_phrases });
      if (v.errors.length) throw new RuleError(`Corrija antes de aprovar: ${v.errors.map((e) => e.message).join(' ')}`);
      const sug = playbook.suggest(m.reply_kind, {});
      if (sug.requires_edit && m.text === m.original_text) throw new RuleError('Esta resposta tem trechos para completar com informações reais antes da aprovação.');
    }
    return tx(db, () => {
      q('INSERT INTO approval (lead_id, kind, message_id, decision, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(m.lead_id, 'mensagem', id, decision, notes || null, nowIso());
      q('INSERT INTO feedback (lead_id, message_id, kind, decision, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(m.lead_id, id, 'decisao_mensagem', decision, notes || null, nowIso());
      const status = decision === 'aprovar' ? 'aprovada' : 'rejeitada';
      q('UPDATE outreach_message SET approval_status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
      audit('mensagem_decidida', 'outreach_message', id, { decision, notes });
      if (decision === 'nova_versao') {
        return generateMessage(m.lead_id, { purpose: m.purpose, evidence_id: m.reference_evidence_id, reply_kind: m.reply_kind });
      }
      return getMessage(id);
    });
  }

  function confirmSent(id, note) {
    const m = getMessage(id);
    const lead = getLeadRow(m.lead_id);
    if (m.approval_status !== 'aprovada') throw new RuleError('Somente mensagens aprovadas podem ser registradas como enviadas.');
    if (m.send_status === 'enviada') throw new RuleError('Envio já registrado.');
    if (lead.do_not_contact && m.reply_kind !== 'pedido_nao_contato') throw new RuleError('Contato bloqueado.');
    return tx(db, () => {
      const t = nowIso();
      q("UPDATE outreach_message SET send_status = 'enviada', sent_at = ?, sent_note = ?, updated_at = ? WHERE id = ?").run(t, note || null, t, id);
      q('INSERT INTO interaction (lead_id, kind, summary, source, occurred_at, message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(m.lead_id, 'mensagem_enviada', `${m.purpose}: ${m.text.slice(0, 140)}`, 'registro_manual', t, id, t);
      if (!PIPELINE_RANK[lead.status] && lead.status === 'aprovado') q("UPDATE lead SET status = 'contatado', updated_at = ? WHERE id = ?").run(t, m.lead_id);
      audit('envio_confirmado', 'outreach_message', id, { note });
      return getMessage(id);
    });
  }

  // ---------- Interações ----------
  function addInteraction(leadId, data) {
    const lead = getLeadRow(leadId);
    const kind = data.kind;
    const def = playbook.INTERACTION_KINDS[kind];
    if (!def || kind === 'mensagem_enviada') throw new RuleError('Tipo de interação inválido (envios são registrados pela mensagem aprovada).');
    const sug = playbook.suggest(kind, lead);
    const notify = sug.actions.find((a) => a.type === 'notificar_isis');
    const t = nowIso();
    return tx(db, () => {
      const info = q(`INSERT INTO interaction (lead_id, kind, summary, source, occurred_at, next_action, next_action_due, created_at)
        VALUES (?, ?, ?, 'registro_manual', ?, ?, ?, ?)`).run(leadId, kind, data.summary || null, data.occurred_at || t,
        data.next_action || (notify ? notify.message : null), data.next_action_due || null, t);
      let status = lead.status;
      if (kind === 'pedido_nao_contato') {
        status = 'nao_contatar';
        q('UPDATE lead SET do_not_contact = 1 WHERE id = ?').run(leadId);
        q("UPDATE outreach_message SET approval_status = 'rejeitada', updated_at = ? WHERE lead_id = ? AND send_status = 'nao_enviada' AND approval_status IN ('rascunho','aprovada')").run(t, leadId);
      } else if (def.response && lead.status !== 'nao_contatar') {
        const target = kind === 'reuniao_solicitada' ? 'reuniao_solicitada' : kind === 'reuniao_agendada' ? 'reuniao_agendada' : 'respondeu';
        if ((PIPELINE_RANK[target] || 0) > (PIPELINE_RANK[lead.status] || 0)) status = target;
      }
      q('UPDATE lead SET status = ?, updated_at = ? WHERE id = ?').run(status, t, leadId);
      audit('interacao_registrada', 'interaction', Number(info.lastInsertRowid), { lead: leadId, kind });
      return { interaction: q('SELECT * FROM interaction WHERE id = ?').get(info.lastInsertRowid), suggestion: sug };
    });
  }

  function completeAction(interactionId) {
    const r = q('SELECT * FROM interaction WHERE id = ?').get(interactionId);
    if (!r) throw new RuleError('Interação não encontrada.', 404);
    q('UPDATE interaction SET next_action_done = 1 WHERE id = ?').run(interactionId);
    audit('acao_concluida', 'interaction', interactionId, null);
    return { ok: true };
  }

  function pendingActions() {
    return q(`SELECT i.*, l.name AS lead_name FROM interaction i JOIN lead l ON l.id = i.lead_id
      WHERE i.next_action IS NOT NULL AND i.next_action_done = 0 ORDER BY COALESCE(i.next_action_due, i.occurred_at)`).all();
  }

  // ---------- Rodadas de pesquisa ----------
  function startRun(r) {
    if (!String(r.region || '').trim()) throw new RuleError('Informe a região da rodada.');
    const info = q(`INSERT INTO research_run (label, region, specialties, period_start, period_end, sources, status, limitations, is_demo, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'em_execucao', ?, ?, ?)`).run(r.label || null, r.region, J(r.specialties || []), r.period_start || null,
      r.period_end || null, J(r.sources || []), J(r.limitations || []), r.is_demo ? 1 : 0, nowIso());
    return Number(info.lastInsertRowid);
  }
  function finishRun(id, counts, errors = [], limitations = []) {
    const cur = q('SELECT * FROM research_run WHERE id = ?').get(id);
    const lim = [...P(cur.limitations, []), ...limitations];
    const status = errors.length && !counts.found ? 'falhou' : (errors.length || lim.length) ? 'concluida_com_limitacoes' : 'concluida';
    q(`UPDATE research_run SET status=?, leads_found=?, leads_new=?, leads_duplicate=?, leads_skipped=?, errors=?, limitations=?, finished_at=? WHERE id=?`)
      .run(status, counts.found, counts.created, counts.duplicate, counts.skipped, J(errors), J(lim), nowIso(), id);
    audit('rodada_concluida', 'research_run', id, counts);
    return getRun(id);
  }
  function getRun(id) {
    const r = q('SELECT * FROM research_run WHERE id = ?').get(id);
    if (!r) throw new RuleError('Rodada não encontrada.', 404);
    return { ...r, specialties: P(r.specialties, []), sources: P(r.sources, []), errors: P(r.errors, []), limitations: P(r.limitations, []), is_demo: !!r.is_demo };
  }
  function listRuns() { return q('SELECT id FROM research_run ORDER BY id DESC').all().map((r) => getRun(r.id)); }

  /** Importa candidatos (de um provedor ou de arquivo), com deduplicação e bloqueio de rejeitados. */
  function ingestCandidates(runId, candidates, origin, isDemo) {
    const counts = { found: candidates.length, created: 0, duplicate: 0, skipped: 0 };
    const details = [];
    for (const c of candidates) {
      const { evidence = [], relevant_change, ...data } = c;
      if (isDemo) data.is_demo = true;
      const dup = dedup.findDuplicate(db, data);
      if (dup) {
        const ex = dup.lead;
        if (ex.do_not_contact || (ex.status === 'rejeitado' && !relevant_change)) {
          counts.skipped++; details.push({ name: data.name, result: 'ignorado', reason: ex.do_not_contact ? 'pediu para não ser contatado' : 'rejeitado anteriormente' });
          continue;
        }
        counts.duplicate++;
        if (relevant_change && ex.status === 'rejeitado' && !ex.do_not_contact) {
          q("UPDATE lead SET status = 'em_revisao', updated_at = ? WHERE id = ?").run(nowIso(), ex.id);
          q('INSERT INTO interaction (lead_id, kind, summary, source, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(ex.id, 'nota', `Reaberto para revisão por mudança relevante: ${relevant_change}`, 'sistema', nowIso(), nowIso());
        }
        for (const e of evidence) {
          const same = q('SELECT id FROM evidence WHERE lead_id = ? AND description = ? AND COALESCE(url, \'\') = ?').get(ex.id, e.description, e.url || '');
          if (!same) addEvidence(ex.id, { ...e, origin: e.origin || origin });
        }
        details.push({ name: data.name, result: 'duplicado', reason: dup.reason, lead_id: ex.id });
        continue;
      }
      const { lead } = createLead(data, { origin, runId });
      for (const e of evidence) addEvidence(lead.id, { ...e, origin: e.origin || origin });
      counts.created++; details.push({ name: data.name, result: 'criado', lead_id: lead.id });
    }
    return { counts, details };
  }

  function importRun(payload) {
    if (!payload || !payload.run || !Array.isArray(payload.leads)) throw new RuleError('Formato esperado: { run: {...}, leads: [...] }');
    const runId = startRun(payload.run);
    try {
      const { counts, details } = ingestCandidates(runId, payload.leads, payload.origin || 'pesquisa_agente', !!payload.run.is_demo);
      return { run: finishRun(runId, counts), details };
    } catch (e) {
      finishRun(runId, { found: payload.leads.length, created: 0, duplicate: 0, skipped: 0 }, [e.message]);
      throw e;
    }
  }

  // ---------- Aprendizado ----------
  function analyzeLearning() {
    const def = activeCriteria().definition;
    const signalsOf = (id) => q('SELECT DISTINCT signal FROM evidence WHERE lead_id = ? AND signal IS NOT NULL').all(id).map((r) => r.signal);
    const decided = [];
    for (const l of q("SELECT id, status FROM lead WHERE is_reference = 0 AND status IN ('aprovado','rejeitado','contatado','respondeu','reuniao_solicitada','reuniao_agendada')").all()) {
      const last = q("SELECT notes FROM approval WHERE lead_id = ? AND kind = 'lead' ORDER BY id DESC LIMIT 1").get(l.id);
      decided.push({ lead_id: l.id, decision: l.status === 'rejeitado' ? 'rejeitar' : 'aprovar', signals: signalsOf(l.id), reason: last && last.notes });
    }
    for (const l of q("SELECT id, reference_label, notes FROM lead WHERE is_reference = 1 AND reference_label IN ('ideal','fora')").all()) {
      decided.push({ lead_id: l.id, decision: l.reference_label === 'ideal' ? 'aprovar' : 'rejeitar', signals: signalsOf(l.id), reason: l.notes });
    }
    const edits = q('SELECT message_id, before_text, after_text FROM message_edit').all();
    const found = [...learning.weightSuggestions(decided, def), ...learning.phraseSuggestions(edits, getSettings().avoid_phrases)];
    const created = [];
    for (const s of found) {
      const exists = q("SELECT id FROM suggestion WHERE kind = ? AND target = ? AND status = 'pendente'").get(s.kind, s.target);
      const rejectedSame = q("SELECT id FROM suggestion WHERE kind = ? AND target = ? AND status = 'rejeitada' AND payload = ?").get(s.kind, s.target, J(s.payload));
      if (exists || rejectedSame) continue;
      const info = q("INSERT INTO suggestion (kind, target, payload, rationale, status, created_at) VALUES (?, ?, ?, ?, 'pendente', ?)")
        .run(s.kind, s.target, J(s.payload), s.rationale, nowIso());
      created.push(Number(info.lastInsertRowid));
    }
    // Resumo de motivos de rejeição para a usuária identificar padrões manualmente.
    const reasons = q("SELECT a.notes, l.name, l.specialty FROM approval a JOIN lead l ON l.id = a.lead_id WHERE a.kind = 'lead' AND a.decision = 'rejeitar' ORDER BY a.id DESC LIMIT 30").all();
    return { created: created.length, decided_cases: decided.length, edits: edits.length, suggestions: listSuggestions(), rejection_reasons: reasons };
  }

  function listSuggestions() {
    return q('SELECT * FROM suggestion ORDER BY status = \'pendente\' DESC, id DESC').all().map((s) => ({ ...s, payload: P(s.payload) }));
  }

  function decideSuggestion(id, decision, note) {
    const s = q('SELECT * FROM suggestion WHERE id = ?').get(id);
    if (!s) throw new RuleError('Sugestão não encontrada.', 404);
    if (s.status !== 'pendente') throw new RuleError('Sugestão já decidida.');
    if (!['aprovar', 'rejeitar'].includes(decision)) throw new RuleError('Decisão inválida.');
    const payload = P(s.payload);
    return tx(db, () => {
      if (decision === 'aprovar') {
        if (s.kind === 'peso') {
          const cur = activeCriteria();
          const next = learning.applyWeightChange(cur.definition, payload);
          q("UPDATE criteria_version SET status = 'substituida' WHERE id = ?").run(cur.id);
          q("INSERT INTO criteria_version (version, definition, status, rationale, created_at) VALUES (?, ?, 'ativa', ?, ?)")
            .run(cur.version + 1, J(next), s.rationale, nowIso());
        } else if (s.kind === 'frase_evitar') {
          const st = getSettings();
          q("UPDATE setting SET value = ? WHERE key = 'avoid_phrases'").run(J([...st.avoid_phrases, payload.phrase]));
        }
      }
      q('UPDATE suggestion SET status = ?, decided_note = ?, decided_at = ? WHERE id = ?').run(decision === 'aprovar' ? 'aprovada' : 'rejeitada', note || null, nowIso(), id);
      audit('sugestao_decidida', 'suggestion', id, { decision, note });
      if (decision === 'aprovar' && s.kind === 'peso') for (const l of q('SELECT id FROM lead').all()) rescore(l.id);
      return { suggestion: { ...q('SELECT * FROM suggestion WHERE id = ?').get(id) }, criteria: activeCriteria() };
    });
  }

  function removeAvoidPhrase(phrase) {
    const st = getSettings();
    q("UPDATE setting SET value = ? WHERE key = 'avoid_phrases'").run(J(st.avoid_phrases.filter((p) => p !== phrase)));
    audit('frase_evitar_removida', 'setting', null, { phrase });
    return getSettings();
  }

  // ---------- Indicadores ----------
  function metrics(f = {}) {
    const from = f.from || '0000';
    const to = f.to ? `${f.to}T23:59:59.999Z` : '9999';
    const runFilter = f.run ? 'AND l.research_run_id = ' + Number(f.run) : '';
    const demoFilter = f.include_demo ? '' : 'AND l.is_demo = 0';
    const base = `l.is_reference = 0 ${demoFilter} ${runFilter}`;
    const st = getSettings();
    const leads = q(`SELECT l.id, l.created_at FROM lead l WHERE ${base} AND l.created_at BETWEEN ? AND ?`).all(from, to);
    const qualified = leads.filter((l) => { const s = latestScore(l.id); return s && s.total >= st.qualified_threshold; }).length;
    const priority = leads.filter((l) => { const s = latestScore(l.id); return s && s.total >= st.priority_threshold; }).length;
    const count = (sql, ...args) => q(sql).get(...args).n;
    const responseKinds = Object.entries(playbook.INTERACTION_KINDS).filter(([, v]) => v.response).map(([k]) => `'${k}'`).join(',');
    const out = {
      leads_descobertos: leads.length,
      leads_qualificados: qualified,
      leads_prioritarios: priority,
      perfis_aprovados: count(`SELECT COUNT(DISTINCT a.lead_id) n FROM approval a JOIN lead l ON l.id = a.lead_id WHERE ${base} AND a.kind='lead' AND a.decision='aprovar' AND a.created_at BETWEEN ? AND ?`, from, to),
      perfis_rejeitados: count(`SELECT COUNT(DISTINCT a.lead_id) n FROM approval a JOIN lead l ON l.id = a.lead_id WHERE ${base} AND a.kind='lead' AND a.decision='rejeitar' AND a.created_at BETWEEN ? AND ?`, from, to),
      mensagens_aprovadas: count(`SELECT COUNT(DISTINCT a.message_id) n FROM approval a JOIN lead l ON l.id = a.lead_id WHERE ${base} AND a.kind='mensagem' AND a.decision='aprovar' AND a.created_at BETWEEN ? AND ?`, from, to),
      mensagens_enviadas: count(`SELECT COUNT(*) n FROM outreach_message m JOIN lead l ON l.id = m.lead_id WHERE ${base} AND m.send_status='enviada' AND m.sent_at BETWEEN ? AND ?`, from, to),
      respostas_recebidas: count(`SELECT COUNT(DISTINCT i.lead_id) n FROM interaction i JOIN lead l ON l.id = i.lead_id WHERE ${base} AND i.kind IN (${responseKinds}) AND i.occurred_at BETWEEN ? AND ?`, from, to),
      reunioes_solicitadas: count(`SELECT COUNT(DISTINCT i.lead_id) n FROM interaction i JOIN lead l ON l.id = i.lead_id WHERE ${base} AND i.kind IN ('reuniao_solicitada','reuniao_agendada') AND i.occurred_at BETWEEN ? AND ?`, from, to),
      reunioes_agendadas: count(`SELECT COUNT(DISTINCT i.lead_id) n FROM interaction i JOIN lead l ON l.id = i.lead_id WHERE ${base} AND i.kind = 'reuniao_agendada' AND i.occurred_at BETWEEN ? AND ?`, from, to),
    };
    // Série semanal (segunda-feira como início).
    const weekOf = (iso) => { const d = new Date(iso); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); };
    const series = {};
    const bump = (iso, k) => { const w = weekOf(iso); series[w] = series[w] || { semana: w, leads: 0, aprovados: 0, enviadas: 0, respostas: 0, reunioes: 0 }; series[w][k]++; };
    for (const l of leads) bump(l.created_at, 'leads');
    for (const r of q(`SELECT a.created_at FROM approval a JOIN lead l ON l.id=a.lead_id WHERE ${base} AND a.kind='lead' AND a.decision='aprovar' AND a.created_at BETWEEN ? AND ?`).all(from, to)) bump(r.created_at, 'aprovados');
    for (const r of q(`SELECT m.sent_at FROM outreach_message m JOIN lead l ON l.id=m.lead_id WHERE ${base} AND m.send_status='enviada' AND m.sent_at BETWEEN ? AND ?`).all(from, to)) bump(r.sent_at, 'enviadas');
    for (const r of q(`SELECT i.occurred_at, i.kind FROM interaction i JOIN lead l ON l.id=i.lead_id WHERE ${base} AND i.kind IN (${responseKinds}) AND i.occurred_at BETWEEN ? AND ?`).all(from, to)) {
      bump(r.occurred_at, r.kind.startsWith('reuniao') ? 'reunioes' : 'respostas');
    }
    const byRun = q(`SELECT r.id, r.label, r.region, r.created_at, r.is_demo, COUNT(l.id) leads FROM research_run r LEFT JOIN lead l ON l.research_run_id = r.id GROUP BY r.id ORDER BY r.id DESC`).all();
    return { totals: out, weekly: Object.values(series).sort((a, b) => a.semana.localeCompare(b.semana)), by_run: byRun,
      notes: ['Contamos apenas eventos registrados: mensagem aprovada não conta como enviada; reunião só conta como agendada quando registrada assim.'] };
  }

  function auditLog(limit = 100) { return q('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit).map((r) => ({ ...r, details: P(r.details) })); }

  function feedbackList() {
    return q('SELECT f.*, l.name AS lead_name FROM feedback f LEFT JOIN lead l ON l.id = f.lead_id ORDER BY f.id DESC LIMIT 200').all();
  }

  return {
    getSettings, updateSettings, activeCriteria, criteriaHistory,
    createLead, updateLead, listLeads, getLead, addEvidence, deleteEvidence, rescore,
    decideLead, generateMessage, editMessage, decideMessage, confirmSent, getMessage,
    addInteraction, completeAction, pendingActions,
    startRun, finishRun, getRun, listRuns, ingestCandidates, importRun,
    analyzeLearning, listSuggestions, decideSuggestion, removeAvoidPhrase,
    metrics, auditLog, feedbackList,
  };
}

module.exports = { createStore, RuleError, LEAD_STATUSES, REFERENCE_LABELS };
