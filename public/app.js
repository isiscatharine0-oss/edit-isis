'use strict';
/* Painel de prospecção — Isis Social Media. JavaScript puro, sem dependências. */

const $view = document.getElementById('view');
const $modal = document.getElementById('modal');
const $toast = document.getElementById('toast');
let META = null;
const state = { leadTab: 'analise', filters: {} };

// ---------- utilidades ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('pt-BR') : '—');
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const today = () => new Date().toISOString().slice(0, 10);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
const link = (u, label) => (safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label || u)}</a>` : esc(label || u || ''));
const igUrl = (h) => (h ? `https://www.instagram.com/${encodeURIComponent(h)}/` : null);

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}
function toast(msg, error = false) {
  $toast.textContent = msg; $toast.className = 'toast' + (error ? ' error' : ''); $toast.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { $toast.hidden = true; }, error ? 6000 : 3000);
}
async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); throw e; }
}
function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.value !== '') o[el.name] = el.value;
  }
  return o;
}
function openModal(html) { $modal.innerHTML = `<div class="modal-box" role="dialog" aria-modal="true">${html}</div>`; $modal.hidden = false; const f = $modal.querySelector('input,textarea,select'); if (f) f.focus(); }
function closeModal() { $modal.hidden = true; $modal.innerHTML = ''; }
$modal.addEventListener('click', (e) => { if (e.target === $modal) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$modal.hidden) closeModal(); });

function ask(title, { label = 'Observação', required = false, placeholder = '', confirm = 'Confirmar', help = '' } = {}) {
  return new Promise((resolve) => {
    openModal(`<h2>${esc(title)}</h2>${help ? `<p class="muted">${esc(help)}</p>` : ''}
      <form id="ask-form"><label>${esc(label)}${required ? ' *' : ''}<textarea name="v" placeholder="${esc(placeholder)}" ${required ? 'required' : ''}></textarea></label>
      <div class="actions" style="margin-top:.8rem"><button class="btn primary" type="submit">${esc(confirm)}</button><button class="btn" type="button" data-action="close-modal">Cancelar</button></div></form>`);
    const form = document.getElementById('ask-form');
    form.addEventListener('submit', (e) => { e.preventDefault(); const v = form.v.value.trim(); closeModal(); resolve(v); });
    $modal.querySelector('[data-action="close-modal"]').addEventListener('click', () => { closeModal(); resolve(null); }, { once: true });
  });
}

const STATUS_LABEL = {
  novo: 'Novo', em_revisao: 'Em revisão', mais_pesquisa: 'Mais pesquisa', aprovado: 'Aprovado', rejeitado: 'Rejeitado',
  contatado: 'Contatado', respondeu: 'Respondeu', reuniao_solicitada: 'Reunião solicitada', reuniao_agendada: 'Reunião agendada', nao_contatar: 'Não contatar',
};
const STATUS_TONE = { aprovado: 'ok', contatado: 'info', respondeu: 'info', reuniao_solicitada: 'brand', reuniao_agendada: 'ok', rejeitado: 'bad', nao_contatar: 'bad', mais_pesquisa: 'warn', em_revisao: 'warn' };
const statusTag = (s) => `<span class="tag ${STATUS_TONE[s] || ''}">${esc(STATUS_LABEL[s] || s)}</span>`;
const CONF_LABEL = { alta: 'Confiança alta', media: 'Confiança média', baixa: 'Confiança baixa' };
const confTag = (c) => (c ? `<span class="tag ${c === 'alta' ? 'ok' : c === 'media' ? 'warn' : 'bad'}">${CONF_LABEL[c]}</span>` : '');
const scoreBadge = (s, big) => `<span class="score ${big ? 'big ' : ''}${s == null ? 's-lo' : s >= 90 ? 's-hi' : s >= 70 ? 's-mid' : 's-lo'}">${s ?? '—'}</span>`;
const relTag = (r) => { const tone = { verificado: 'ok', observado: 'info', indireto: 'warn', hipotese: 'bad' }[r]; return `<span class="tag ${tone}">${esc(META.reliability[r]?.label || r)}</span>`; };
const critLabel = (code) => (META.criteria.definition.criteria.find((c) => c.code === code) || { label: code === 'geral' ? 'Informação geral' : code }).label;
const signalLabel = (code) => { for (const c of META.criteria.definition.criteria) { const s = c.signals.find((x) => x.code === code); if (s) return s.label; } return code; };
const ikLabel = (k) => META.interaction_kinds[k]?.label || k;

// ---------- roteamento ----------
const routes = [
  [/^#?\/?$/, viewHome],
  [/^#\/leads$/, viewLeads],
  [/^#\/lead\/(\d+)$/, viewLead],
  [/^#\/referencias$/, viewReferences],
  [/^#\/rodadas$/, viewRuns],
  [/^#\/rodada\/(\d+)$/, viewRun],
  [/^#\/aprendizado$/, viewLearning],
  [/^#\/indicadores$/, viewMetrics],
  [/^#\/config$/, viewConfig],
];
async function router() {
  const hash = location.hash || '#/';
  document.querySelectorAll('nav a').forEach((a) => {
    const h = a.getAttribute('href');
    a.classList.toggle('active', h === '#/' ? hash === '#/' : hash.startsWith(h) || (h === '#/leads' && hash.startsWith('#/lead/')));
  });
  document.getElementById('nav').classList.remove('open');
  META = await api('GET', '/api/meta');
  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (m) { try { await fn(...m.slice(1)); } catch (e) { $view.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; } return; }
  }
  $view.innerHTML = '<div class="empty">Página não encontrada.</div>';
}
window.addEventListener('hashchange', router);
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action="toggle-menu"]');
  if (t) document.getElementById('nav').classList.toggle('open');
  const row = e.target.closest('tr[data-href]');
  if (row && !e.target.closest('a,button')) location.hash = row.dataset.href;
});

// ---------- Painel ----------
async function viewHome() {
  const o = await api('GET', '/api/overview');
  const m = o.metrics;
  const kpi = (v, l) => `<div class="kpi"><b>${v}</b><span>${esc(l)}</span></div>`;
  $view.innerHTML = `
    <div class="page-head"><div><h1>Painel de prospecção</h1><p class="muted">Região ativa: ${esc(META.settings.active_region)} · Meta semanal: até ${META.settings.weekly_target} novos leads</p></div>
      <div class="actions"><a class="btn primary" href="#/leads">Ver leads</a><button class="btn" data-action="new-lead">+ Novo lead</button></div></div>
    <div class="kpis">
      ${kpi(m.leads_qualificados, `Leads qualificados (≥ ${META.settings.qualified_threshold})`)}
      ${kpi(m.leads_prioritarios, `Prioritários (≥ ${META.settings.priority_threshold})`)}
      ${kpi(m.perfis_aprovados, 'Perfis aprovados')}
      ${kpi(m.mensagens_aprovadas, 'Mensagens aprovadas')}
      ${kpi(m.mensagens_enviadas, 'Envios confirmados')}
      ${kpi(m.respostas_recebidas, 'Responderam')}
      ${kpi(m.reunioes_solicitadas, 'Reuniões solicitadas')}
      ${kpi(m.reunioes_agendadas, 'Reuniões agendadas')}
    </div>
    <p class="muted" style="margin-top:-.5rem">Indicadores contam apenas eventos registrados e ignoram dados de demonstração.</p>
    <div class="grid grid-2">
      <div class="card"><h2>Ações pendentes</h2>${o.pending.length ? `<ul class="list">${o.pending.map((p) => `
        <li><a href="#/lead/${p.lead_id}"><strong>${esc(p.lead_name)}</strong></a> · ${esc(ikLabel(p.kind))}<br>${esc(p.next_action)}
        <div class="ev-meta">${p.next_action_due ? `Prazo: ${fmtDate(p.next_action_due)} · ` : ''}registrado em ${fmtDateTime(p.occurred_at)}
        <button class="btn small" data-done="${p.id}">Concluir</button></div></li>`).join('')}</ul>` : '<p class="muted">Nenhuma ação pendente.</p>'}</div>
      <div class="card"><h2>Fontes de pesquisa</h2><ul class="list">${o.providers.map((p) => `<li><strong>${esc(p.label)}</strong>
        <span class="tag ${p.available ? (p.tested ? 'ok' : 'warn') : 'bad'}">${p.available ? (p.tested ? 'Disponível' : 'Configurado · não validado') : 'Indisponível'}</span><br><small>${esc(p.detail)}</small></li>`).join('')}</ul></div>
    </div>
    <div class="card"><h2>Rodadas recentes</h2>${runsTable(o.runs)}</div>`;
  $view.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => { await run(() => api('POST', `/api/interactions/${b.dataset.done}/done`), 'Ação concluída'); router(); }));
  $view.querySelector('[data-action="new-lead"]').addEventListener('click', () => leadForm());
}

// ---------- Leads ----------
async function viewLeads() {
  const f = state.filters;
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const leads = await api('GET', '/api/leads' + (qs ? '?' + qs : ''));
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  $view.innerHTML = `
    <div class="page-head"><div><h1>Leads</h1><p class="muted">Ordenados por pontuação. Compatibilidade e confiança são medidas separadas.</p></div>
      <div class="actions"><button class="btn primary" data-action="new-lead">+ Novo lead</button></div></div>
    <div class="card"><form id="filters" class="filters">
      <label>Pontuação mínima<input type="number" name="min_score" min="0" max="100" value="${esc(f.min_score || '')}"></label>
      <label>Especialidade<input name="specialty" list="dl-spec" value="${esc(f.specialty || '')}"></label>
      <label>Cidade<input name="city" value="${esc(f.city || '')}"></label>
      <label>Status<select name="status">${opt('', 'Todos', f.status || '')}${META.statuses.map((s) => opt(s, STATUS_LABEL[s], f.status)).join('')}</select></label>
      <label>Confiança<select name="confidence">${opt('', 'Todas', f.confidence || '')}${opt('alta', 'Alta', f.confidence)}${opt('media', 'Média', f.confidence)}${opt('baixa', 'Baixa', f.confidence)}</select></label>
      <label>Aprovação<select name="approval">${opt('', 'Todas', f.approval || '')}${opt('pendente', 'Pendente', f.approval)}${opt('aprovado', 'Aprovado', f.approval)}${opt('rejeitado', 'Rejeitado / bloqueado', f.approval)}</select></label>
      <label>Demonstração<select name="demo">${opt('', 'Mostrar', f.demo || '')}${opt('hide', 'Ocultar', f.demo)}</select></label>
      <div class="actions" style="align-self:end"><button class="btn" type="button" data-action="clear">Limpar</button></div>
    </form><datalist id="dl-spec">${META.settings.specialties.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>
    <div class="card">${leads.length ? `<div class="table-wrap"><table><thead><tr><th>Pontos</th><th>Profissional</th><th class="hide-sm">Cidade</th><th class="hide-sm">Links</th><th>Confiança</th><th class="hide-sm">Principais oportunidades</th><th>Status</th><th class="hide-sm">Atualizado</th></tr></thead><tbody>
      ${leads.map((l) => `<tr class="clickable" data-href="#/lead/${l.id}">
        <td>${scoreBadge(l.score)}${l.flags.some((x) => x.severity === 'revisar') ? ' <span class="tag bad" title="Inconsistência a revisar">!</span>' : ''}</td>
        <td><strong>${esc(l.name)}</strong>${l.is_demo ? ' <span class="tag warn">DEMO</span>' : ''}<br><small>${esc(l.specialty || 'Especialidade não informada')}</small></td>
        <td class="hide-sm">${esc(l.city || '—')}</td>
        <td class="hide-sm">${l.instagram ? link(igUrl(l.instagram), '@' + l.instagram) : '<small class="muted">sem Instagram</small>'}${l.website ? `<br>${link(l.website, 'site')}` : ''}</td>
        <td>${confTag(l.confidence_level)}</td>
        <td class="hide-sm"><small>${l.opportunities.length ? l.opportunities.map(esc).join('<br>') : '—'}</small></td>
        <td>${statusTag(l.status)}</td>
        <td class="hide-sm"><small>${fmtDate(l.updated_at)}</small></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Nenhum lead encontrado com esses filtros.</div>'}</div>`;
  const form = document.getElementById('filters');
  let deb;
  form.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { state.filters = formData(form); viewLeads(); }, 350); });
  form.querySelector('[data-action="clear"]').addEventListener('click', () => { state.filters = {}; viewLeads(); });
  $view.querySelector('[data-action="new-lead"]').addEventListener('click', () => leadForm());
}

function leadForm(existing, { reference = false } = {}) {
  const l = existing || {};
  const refSel = reference || l.is_reference;
  openModal(`<h2>${existing ? 'Editar' : reference ? 'Novo perfil de referência' : 'Novo lead'}</h2>
    ${!existing ? '<p class="muted">Cadastre apenas profissionais reais, com dados de fontes públicas. As evidências são adicionadas na ficha.</p>' : ''}
    <form id="lead-form" class="form-grid">
      <label class="full">Nome profissional *<input name="name" required value="${esc(l.name || '')}"></label>
      <label>Forma de tratamento na mensagem<input name="address_as" placeholder="doutora, doutor, Ana…" value="${esc(l.address_as || '')}"></label>
      <label>Especialidade<input name="specialty" list="dl-spec2" value="${esc(l.specialty || '')}"></label>
      <label>Cidade<input name="city" value="${esc(l.city || (META.settings.active_region || '').split(' - ')[0])}"></label>
      <label>Bairro<input name="neighborhood" value="${esc(l.neighborhood || '')}"></label>
      <label>Instagram<input name="instagram" placeholder="@perfil" value="${esc(l.instagram ? '@' + l.instagram : '')}"></label>
      <label>Site profissional<input name="website" type="url" placeholder="https://" value="${esc(l.website || '')}"></label>
      <label>Registro profissional público<input name="registry" placeholder="CRM-BA 00000" value="${esc(l.registry || '')}"></label>
      ${refSel ? `<label>Classificação *<select name="reference_label" required>${Object.entries(META.reference_labels).map(([k, v]) => `<option value="${k}" ${l.reference_label === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>` : ''}
      <label class="full">${refSel ? 'Por que você classificou assim? (o agente aprende com isso)' : 'Observações'}<textarea name="notes">${esc(l.notes || '')}</textarea></label>
      <div class="full actions"><button class="btn primary" type="submit">Salvar</button><button class="btn" type="button" data-action="close-modal">Cancelar</button></div>
    </form><datalist id="dl-spec2">${META.settings.specialties.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>`);
  $modal.querySelector('[data-action="close-modal"]').addEventListener('click', closeModal);
  document.getElementById('lead-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    if (refSel) { data.is_reference = true; data.reference_reason = data.notes; }
    if (existing) {
      for (const k of ['address_as', 'specialty', 'city', 'neighborhood', 'instagram', 'website', 'registry', 'notes']) if (!(k in data)) data[k] = '';
      await run(() => api('PATCH', `/api/leads/${existing.id}`, data), 'Salvo');
      closeModal(); router();
    } else {
      const r = await run(() => api('POST', '/api/leads', data));
      closeModal();
      if (r.duplicate) toast(`Já existe no sistema (${r.reason}). Abrindo o registro existente.`);
      location.hash = `#/lead/${r.lead.id}`;
    }
  });
}

// ---------- Ficha do lead ----------
async function viewLead(id) {
  const d = await api('GET', `/api/leads/${id}`);
  const l = d.lead;
  const s = d.score;
  const isRef = l.is_reference;
  const tabs = isRef ? [['analise', 'Análise'], ['evidencias', `Evidências (${d.evidence.length})`], ['historico', 'Histórico']]
    : [['analise', 'Análise'], ['evidencias', `Evidências (${d.evidence.length})`], ['abordagem', `Abordagem (${d.messages.filter((m) => !['substituida'].includes(m.approval_status)).length})`], ['historico', 'Histórico']];
  if (!tabs.some(([k]) => k === state.leadTab)) state.leadTab = 'analise';
  const links = [l.instagram && link(igUrl(l.instagram), '@' + l.instagram), l.website && link(l.website, 'Site'), ...(l.other_links || []).map((u) => link(u, new URL(u).hostname))].filter(Boolean);
  $view.innerHTML = `
    ${l.is_demo ? '<div class="banner warn"><strong>Registro de demonstração.</strong> Não é um profissional real e não entra nos indicadores.</div>' : ''}
    ${l.do_not_contact ? '<div class="banner bad"><strong>Não contatar.</strong> Este profissional pediu para não receber mensagens.</div>' : ''}
    <div class="page-head">
      <div><a href="${isRef ? '#/referencias' : '#/leads'}" class="muted">← ${isRef ? 'Referências' : 'Leads'}</a>
        <h1>${esc(l.name)}</h1>
        <p class="muted">${esc(l.specialty || 'Especialidade não informada')} · ${esc([l.neighborhood, l.city, l.state].filter(Boolean).join(', ') || 'Localização não informada')}${l.registry ? ` · ${esc(l.registry)}` : ''}</p>
        <div class="actions">${links.join(' · ') || '<small class="muted">Sem links públicos registrados</small>'}</div>
      </div>
      <div style="text-align:right">${scoreBadge(s ? s.total : null, true)}<div style="margin-top:.35rem">${s ? confTag(s.confidence_level) : ''} ${isRef ? `<span class="tag brand">Referência: ${esc(META.reference_labels[l.reference_label] || '—')}</span>` : statusTag(l.status)}</div>
        <small class="muted">Critérios v${s ? s.criteria_version : '—'} · confiança ${s ? s.confidence : '—'}/100</small></div>
    </div>
    <div class="card actions">
      ${isRef ? '<span class="muted">Perfil de referência: usado para calibrar o ICP, não para prospecção.</span>'
        : ['contatado', 'respondeu', 'reuniao_solicitada', 'reuniao_agendada', 'nao_contatar'].includes(l.status) ? `<span class="muted">Contato em andamento (${esc(STATUS_LABEL[l.status])}). Registre a evolução na aba Histórico.</span>`
        : `<strong>1ª aprovação (profissional):</strong>
        <button class="btn ok" data-decide="aprovar">Aprovar</button>
        <button class="btn bad" data-decide="rejeitar">Rejeitar</button>
        <button class="btn" data-decide="mais_pesquisa">Solicitar mais pesquisa</button>
        <button class="btn" data-decide="em_revisao">Manter em revisão</button>`}
      <span style="flex:1"></span><button class="btn small" data-action="edit-lead">Editar dados</button>
    </div>
    <div class="tabs" role="tablist">${tabs.map(([k, label]) => `<button role="tab" data-tab="${k}" class="${state.leadTab === k ? 'active' : ''}">${label}</button>`).join('')}</div>
    <div id="tab"></div>`;
  $view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.leadTab = b.dataset.tab; viewLead(id); }));
  $view.querySelector('[data-action="edit-lead"]').addEventListener('click', () => leadForm(l));
  $view.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', async () => {
    const dec = b.dataset.decide;
    const notes = await ask({ aprovar: 'Aprovar profissional', rejeitar: 'Rejeitar profissional', mais_pesquisa: 'Solicitar mais pesquisa', em_revisao: 'Manter em revisão' }[dec], {
      label: dec === 'rejeitar' ? 'Motivo da rejeição' : 'Observação (opcional, ajuda o agente a aprender)', required: dec === 'rejeitar',
      placeholder: dec === 'rejeitar' ? 'Ex.: consultório bonito, mas sem evidência de estrutura operacional' : '' });
    if (notes === null) return;
    await run(() => api('POST', `/api/leads/${id}/decision`, { decision: dec, notes }), 'Decisão registrada');
    viewLead(id);
  }));
  const tab = document.getElementById('tab');
  if (state.leadTab === 'analise') tab.innerHTML = analysisTab(d);
  if (state.leadTab === 'evidencias') renderEvidenceTab(tab, d);
  if (state.leadTab === 'abordagem') renderOutreachTab(tab, d);
  if (state.leadTab === 'historico') renderHistoryTab(tab, d);
}

function analysisTab(d) {
  const s = d.score;
  if (!s) return '<div class="empty">Sem pontuação.</div>';
  const crits = META.criteria.definition.criteria;
  const hyps = d.evidence.filter((e) => e.reliability === 'hipotese');
  return `
    ${s.flags.length ? `<div class="card"><h2>Inconsistências e alertas</h2><ul class="list">${s.flags.map((f) => `<li><span class="tag ${f.severity === 'revisar' ? 'bad' : 'warn'}">${f.severity === 'revisar' ? 'Revisar' : 'Atenção'}</span> ${esc(f.message)}</li>`).join('')}</ul></div>` : ''}
    <div class="grid grid-2">
      <div class="card"><h2>Pontuação por critério</h2>
        ${crits.map((c) => { const b = s.breakdown[c.code]; const items = s.justification.filter((j) => j.criterion === c.code); return `
          <div class="crit"><div class="crit-head"><span>${esc(b.label)}</span><span>${b.points}/${b.max}</span></div>
          <div class="bar"><i style="width:${(b.points / b.max) * 100}%"></i></div>
          ${items.length ? `<ul class="list">${items.map((j) => `<li><strong>${j.points > 0 ? '+' : ''}${j.points}</strong> · ${esc(j.label)}<br><small>${esc(j.description)}</small>
            <div class="ev-meta">${relTag(j.reliability)} ${j.url ? link(j.url, j.source_name) : esc(j.source_name)}</div></li>`).join('')}</ul>` : '<small class="muted">Nenhum sinal com evidência.</small>'}</div>`; }).join('')}
        <p class="muted"><small>Evidências: verificado ×1,0 · observado ×0,9 · indireto ×0,7 · hipótese ×0,4. Total ${s.total}/100.</small></p>
      </div>
      <div>
        <div class="card"><h2>Informações ausentes ou não confirmadas</h2>${s.missing.length ? `<ul class="list">${s.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : '<p class="muted">Nada pendente.</p>'}</div>
        <div class="card"><h2>Hipóteses do agente</h2>${hyps.length ? `<ul class="list">${hyps.map((e) => `<li>${esc(e.description)}<div class="ev-meta">${esc(critLabel(e.criterion))}</div></li>`).join('')}</ul>` : '<p class="muted">Nenhuma hipótese registrada. Tudo o que pontua tem fonte.</p>'}</div>
        <div class="card"><h2>Pontos de atenção</h2>${d.interactions.filter((i) => ['objecao', 'experiencia_negativa'].includes(i.kind)).map((i) => `<p>• ${esc(ikLabel(i.kind))}: ${esc(i.summary || '')}</p>`).join('') || '<p class="muted">Compatibilidade comportamental (delegar, gravar, participar) só é avaliada na conversa — nunca deduzida de fotos ou posts.</p>'}</div>
      </div>
    </div>`;
}

function renderEvidenceTab(tab, d) {
  const crits = [...META.criteria.definition.criteria, { code: 'geral', label: 'Informação geral', signals: [] }];
  tab.innerHTML = `
    <div class="card"><div class="page-head" style="margin:0"><h2>Evidências registradas</h2><button class="btn primary" data-action="add-ev">+ Adicionar evidência</button></div>
    ${crits.map((c) => { const evs = d.evidence.filter((e) => e.criterion === c.code); if (!evs.length) return ''; return `<h3>${esc(c.label)}</h3><ul class="list">${evs.map((e) => `
      <li>${esc(e.description)}${e.signal ? `<br><small>Sinal: ${esc(signalLabel(e.signal))}</small>` : ''}
      ${e.hook_type ? `<br><span class="tag brand">Referência de abordagem: ${esc(META.hook_types[e.hook_type])}</span> <small>“…você ${esc(e.hook_text)}”</small>` : ''}
      <div class="ev-meta">${relTag(e.reliability)} Fonte: ${e.url ? link(e.url, e.source_name) : esc(e.source_name)} · consultado em ${fmtDate(e.consulted_at)}${e.fact_date ? ` · fato de ${fmtDate(e.fact_date)}` : ''} · origem: ${esc(e.origin)}
      <button class="btn small bad" data-del-ev="${e.id}">Remover</button></div></li>`).join('')}</ul>`; }).join('') || '<div class="empty">Nenhuma evidência. Sem evidência não há pontuação.</div>'}</div>`;
  tab.querySelector('[data-action="add-ev"]').addEventListener('click', () => evidenceForm(d.lead.id));
  tab.querySelectorAll('[data-del-ev]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remover esta evidência? A pontuação será recalculada.')) return;
    await run(() => api('DELETE', `/api/evidence/${b.dataset.delEv}`), 'Evidência removida'); viewLead(d.lead.id);
  }));
}

function evidenceForm(leadId) {
  const crits = [...META.criteria.definition.criteria, { code: 'geral', label: 'Informação geral (sem pontuação)', signals: [] }];
  openModal(`<h2>Adicionar evidência</h2><p class="muted">Registre só o que a fonte mostra. Interpretações entram como “hipótese”.</p>
    <form id="ev-form" class="form-grid">
      <label>Critério *<select name="criterion" required>${crits.map((c) => `<option value="${c.code}">${esc(c.label)}</option>`).join('')}</select></label>
      <label>Sinal do ICP<select name="signal"></select></label>
      <label class="full">Descrição do que foi observado *<textarea name="description" required placeholder="Ex.: Site informa atendimento exclusivamente particular, sem convênios."></textarea></label>
      <label>Fonte *<input name="source_name" required placeholder="Site oficial, Instagram, Doctoralia…"></label>
      <label>URL da fonte<input name="url" type="url" placeholder="https://"></label>
      <label>Confiabilidade *<select name="reliability">${Object.entries(META.reliability).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></label>
      <label>Origem<select name="origin"><option value="usuaria">Observação da Isis</option><option value="pesquisa_agente">Pesquisa do agente</option></select></label>
      <label>Data de consulta *<input name="consulted_at" type="date" value="${today()}" required></label>
      <label>Data do fato (se souber)<input name="fact_date" type="date"></label>
      <label class="full check"><input type="checkbox" name="use_hook"> Usar este fato real como referência da abordagem</label>
      <div class="full form-grid" id="hook-fields" hidden>
        <label>Tipo de fato<select name="hook_type">${Object.entries(META.hook_types).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <label>Complete: “Vi que você …”<input name="hook_text" placeholder="inaugurou seu novo consultório no Itaigara"></label>
      </div>
      <div class="full actions"><button class="btn primary" type="submit">Salvar</button><button class="btn" type="button" data-action="close-modal">Cancelar</button></div>
    </form>`);
  const form = document.getElementById('ev-form');
  const fillSignals = () => {
    const c = crits.find((x) => x.code === form.criterion.value);
    form.signal.innerHTML = '<option value="">— nenhum (apenas contexto) —</option>' + c.signals.map((s) => `<option value="${s.code}">${esc(s.label)} (${s.points > 0 ? '+' : ''}${s.points})</option>`).join('');
  };
  fillSignals();
  form.criterion.addEventListener('change', fillSignals);
  form.use_hook.addEventListener('change', () => { document.getElementById('hook-fields').hidden = !form.use_hook.checked; });
  $modal.querySelector('[data-action="close-modal"]').addEventListener('click', closeModal);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = formData(form);
    if (!data.use_hook) { delete data.hook_type; delete data.hook_text; }
    delete data.use_hook;
    await run(() => api('POST', `/api/leads/${leadId}/evidence`, data), 'Evidência registrada; pontuação recalculada');
    closeModal(); viewLead(leadId);
  });
}

function renderOutreachTab(tab, d) {
  const l = d.lead;
  const hooks = d.evidence.filter((e) => e.hook_type && e.reliability !== 'hipotese');
  const approved = ['aprovado', 'contatado', 'respondeu', 'reuniao_solicitada', 'reuniao_agendada'].includes(l.status);
  const sentInitial = d.messages.find((m) => m.purpose === 'inicial' && m.send_status === 'enviada');
  const visible = d.messages.filter((m) => m.approval_status !== 'substituida');
  const old = d.messages.filter((m) => m.approval_status === 'substituida');
  const apStatus = { rascunho: ['Rascunho · aguardando sua aprovação', 'warn'], aprovada: ['Aprovada', 'ok'], rejeitada: ['Rejeitada', 'bad'], substituida: ['Substituída', ''] };
  tab.innerHTML = `
    ${!approved ? '<div class="banner info">Aprove o profissional (1ª aprovação) para gerar a abordagem.</div>' : ''}
    <div class="card"><h2>Gerar abordagem</h2>
      ${hooks.length ? `<form id="gen-form" class="actions"><label style="flex:1;min-width:240px">Fato real usado como referência<select name="evidence_id">${hooks.map((e) => `<option value="${e.id}">${esc(META.hook_types[e.hook_type])}: ${esc(e.hook_text)}</option>`).join('')}</select></label>
        <button class="btn primary" type="submit" ${!approved || sentInitial || l.do_not_contact ? 'disabled' : ''}>Gerar mensagem inicial</button></form>`
        : '<p class="muted">Nenhum fato verificável marcado como referência de abordagem. Na aba Evidências, marque “usar como referência”.</p>'}
      <div class="actions" style="margin-top:.6rem"><button class="btn" data-action="followup" ${!sentInitial || l.do_not_contact ? 'disabled' : ''}>Gerar retomada (máx. 1)</button>
        <small class="muted">Retomada: só após ${META.settings.followup_min_days} dias sem resposta, com aprovação.</small></div>
      <p class="muted"><small>No MVP o envio é manual pelo Instagram. A API do Instagram não permite mensagem fria automatizada.</small></p>
    </div>
    ${visible.map((m) => { const [lab, tone] = apStatus[m.approval_status]; const active = ['rascunho', 'aprovada'].includes(m.approval_status) && m.send_status !== 'enviada'; return `
      <div class="msg ${m.approval_status === 'rejeitada' ? 'inactive' : ''}" data-msg="${m.id}">
        <div class="actions"><strong>${esc({ inicial: 'Mensagem inicial', retomada: 'Retomada', resposta: 'Resposta' }[m.purpose])} · v${m.version}</strong>
          <span class="tag ${tone}">${lab}</span>
          <span class="tag ${m.send_status === 'enviada' ? 'ok' : ''}">${m.send_status === 'enviada' ? `Enviada em ${fmtDateTime(m.sent_at)}` : 'Não enviada'}</span></div>
        <small class="muted">Referência: ${esc(m.reference_text || '—')} · gerador: ${esc(m.generator)}${m.edits.length ? ` · ${m.edits.length} edição(ões)` : ''}</small>
        ${active ? `<textarea class="msg-edit">${esc(m.text)}</textarea>` : `<div class="msg-text">${esc(m.text)}</div>`}
        ${m.warnings.length ? `<ul class="list">${m.warnings.map((w) => `<li><span class="tag ${['promessa', 'preco', 'critica'].includes(w.code) ? 'bad' : 'warn'}">${['promessa', 'preco', 'critica'].includes(w.code) ? 'Bloqueia aprovação' : 'Atenção'}</span> ${esc(w.message)}</li>`).join('')}</ul>` : ''}
        <div class="actions" style="margin-top:.5rem">
          ${active ? `<button class="btn small" data-m="save">Salvar edição</button>` : ''}
          ${m.approval_status === 'rascunho' && m.send_status !== 'enviada' ? `<button class="btn small ok" data-m="aprovar">Aprovar mensagem</button>
            <button class="btn small" data-m="nova_versao">Outra versão</button><button class="btn small bad" data-m="rejeitar">Rejeitar</button>` : ''}
          ${m.approval_status === 'aprovada' && m.send_status !== 'enviada' ? `<button class="btn small primary" data-m="copy">Copiar e abrir perfil</button>
            <button class="btn small ok" data-m="sent">Confirmar que enviei</button><button class="btn small bad" data-m="rejeitar">Rejeitar</button>` : ''}
        </div>
        ${m.edits.length ? `<details><summary><small>Histórico de correções</small></summary><ul class="list">${m.edits.map((e) => `<li><small>${fmtDateTime(e.created_at)}</small><br><s>${esc(e.before_text)}</s><br>${esc(e.after_text)}</li>`).join('')}</ul></details>` : ''}
      </div>`; }).join('')}
    ${old.length ? `<details class="card"><summary>Versões substituídas (${old.length})</summary><ul class="list">${old.map((m) => `<li><small>v${m.version} · ${fmtDateTime(m.created_at)}</small><br>${esc(m.text)}</li>`).join('')}</ul></details>` : ''}`;

  const gen = tab.querySelector('#gen-form');
  if (gen) gen.addEventListener('submit', async (e) => { e.preventDefault(); await run(() => api('POST', `/api/leads/${l.id}/messages`, { purpose: 'inicial', evidence_id: gen.evidence_id.value }), 'Rascunho gerado'); viewLead(l.id); });
  tab.querySelector('[data-action="followup"]').addEventListener('click', async () => { await run(() => api('POST', `/api/leads/${l.id}/messages`, { purpose: 'retomada' }), 'Retomada gerada'); viewLead(l.id); });
  tab.querySelectorAll('[data-msg]').forEach((box) => {
    const id = box.dataset.msg;
    const m = d.messages.find((x) => String(x.id) === id);
    box.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', async () => {
      const act = b.dataset.m;
      const ta = box.querySelector('.msg-edit');
      if (ta && ta.value.trim() !== m.text && act !== 'save' && act !== 'rejeitar') {
        await run(() => api('PATCH', `/api/messages/${id}`, { text: ta.value }));
      }
      if (act === 'save') { await run(() => api('PATCH', `/api/messages/${id}`, { text: ta.value }), 'Edição salva (volta para rascunho)'); }
      else if (act === 'aprovar' || act === 'nova_versao') { await run(() => api('POST', `/api/messages/${id}/decision`, { decision: act }), act === 'aprovar' ? 'Mensagem aprovada (ainda NÃO enviada)' : 'Nova versão gerada'); }
      else if (act === 'rejeitar') { const n = await ask('Rejeitar abordagem', { label: 'O que não funcionou? (ajuda o agente)' }); if (n === null) return; await run(() => api('POST', `/api/messages/${id}/decision`, { decision: 'rejeitar', notes: n }), 'Abordagem rejeitada'); }
      else if (act === 'copy') {
        try { await navigator.clipboard.writeText(m.text); toast('Mensagem copiada. Cole no Direct do Instagram.'); } catch { toast('Não consegui copiar automaticamente; selecione o texto e copie.', true); }
        if (l.instagram) window.open(igUrl(l.instagram), '_blank', 'noopener');
        return;
      } else if (act === 'sent') {
        const note = await ask('Confirmar envio realizado', { label: 'Onde/como enviou (opcional)', placeholder: 'Direct do Instagram', confirm: 'Sim, enviei', help: 'Só confirme se a mensagem foi realmente enviada. Aprovação não é envio.' });
        if (note === null) return;
        await run(() => api('POST', `/api/messages/${id}/sent`, { note }), 'Envio registrado');
      }
      viewLead(l.id);
    }));
  });
}

function renderHistoryTab(tab, d) {
  const l = d.lead;
  const events = [
    { at: l.created_at, html: `Descoberto / cadastrado${d.run ? ` na rodada <a href="#/rodada/${d.run.id}">#${d.run.id} ${esc(d.run.label || d.run.region)}</a>` : ''}` },
    ...d.approvals.map((a) => ({ at: a.created_at, html: `<strong>${a.kind === 'lead' ? 'Decisão sobre o profissional' : 'Decisão sobre mensagem'}:</strong> ${esc(a.decision)}${a.notes ? ` — “${esc(a.notes)}”` : ''}` })),
    ...d.interactions.map((i) => ({ at: i.occurred_at, html: `<strong>${esc(ikLabel(i.kind))}</strong>${i.summary ? `: ${esc(i.summary)}` : ''}${i.next_action ? `<br><small>Próxima ação: ${esc(i.next_action)}${i.next_action_done ? ' (concluída)' : ''}</small>` : ''}<br><small class="muted">${esc(i.source)}</small>` })),
    ...d.feedback.filter((f) => f.kind === 'correcao_mensagem' || f.kind === 'classificacao_referencia').map((f) => ({ at: f.created_at, html: `<small>${f.kind === 'correcao_mensagem' ? 'Correção de mensagem' : 'Classificação de referência: ' + esc(f.decision)}${f.pattern ? ` — ${esc(f.pattern)}` : ''}${f.reason ? ` — ${esc(f.reason)}` : ''}</small>` })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const kinds = Object.entries(META.interaction_kinds).filter(([k]) => k !== 'mensagem_enviada');
  tab.innerHTML = `
    <div class="grid grid-2">
      ${l.is_reference ? '' : `<div class="card"><h2>Registrar interação</h2><p class="muted"><small>Registro manual: o sistema não lê o Instagram. Registre aqui o que aconteceu na conversa.</small></p>
        <form id="int-form" class="form-grid">
          <label class="full">O que aconteceu *<select name="kind">${kinds.map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select></label>
          <label class="full">Resumo<textarea name="summary" placeholder="Resumo da resposta ou da conversa"></textarea></label>
          <label>Data<input type="datetime-local" name="occurred_at"></label>
          <label>Próxima ação<input name="next_action"></label>
          <label>Prazo<input type="date" name="next_action_due"></label>
          <div class="full actions"><button class="btn primary" type="submit">Registrar</button></div>
        </form><div id="suggestion"></div></div>`}
      <div class="card"><h2>Linha do tempo</h2><ul class="timeline">${events.map((e) => `<li><small class="muted">${fmtDateTime(e.at)}</small><br>${e.html}</li>`).join('')}</ul>
        <h3>Pontuações anteriores</h3><ul class="list">${d.scoreHistory.map((s) => `<li>${s.total} pts · confiança ${s.confidence} · critérios v${s.version} · <small>${fmtDateTime(s.created_at)}</small></li>`).join('')}</ul></div>
    </div>`;
  const form = tab.querySelector('#int-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = formData(form);
    if (data.occurred_at) data.occurred_at = new Date(data.occurred_at).toISOString();
    if (data.kind === 'pedido_nao_contato' && !confirm('Isto bloqueia novos contatos com este profissional. Confirmar?')) return;
    const r = await run(() => api('POST', `/api/leads/${l.id}/interactions`, data), 'Interação registrada');
    await viewLead(l.id);
    const sug = r.suggestion;
    const box = document.getElementById('suggestion');
    if (box && (sug.text || sug.notes.length)) {
      box.innerHTML = `<h3>Sugestão do roteiro</h3>${sug.text ? `<div class="msg-text">${esc(sug.text)}</div>` : ''}${sug.notes.map((n) => `<p class="muted"><small>• ${esc(n)}</small></p>`).join('')}
        ${sug.text ? `<button class="btn small primary" data-action="draft-reply">Criar rascunho de resposta para aprovação</button>` : ''}`;
      const b = box.querySelector('[data-action="draft-reply"]');
      if (b) b.addEventListener('click', async () => { await run(() => api('POST', `/api/leads/${l.id}/messages`, { purpose: 'resposta', reply_kind: data.kind }), 'Rascunho criado na aba Abordagem'); state.leadTab = 'abordagem'; viewLead(l.id); });
    }
  });
}

// ---------- Referências ----------
async function viewReferences() {
  const refs = await api('GET', '/api/leads?reference=only');
  $view.innerHTML = `
    <div class="page-head"><div><h1>Perfis de referência</h1><p class="muted">Exemplos que calibram o perfil de cliente ideal. São referências subjetivas, não evidência de interesse em contratar.</p></div>
      <button class="btn primary" data-action="new-ref">+ Adicionar referência</button></div>
    <div class="banner info">Classifique cada referência (ideal, com potencial, fora do público) e explique o porquê. Os sinais registrados nas evidências das referências entram na análise de padrões da tela Aprendizado.</div>
    <div class="card">${refs.length ? `<div class="table-wrap"><table><thead><tr><th>Perfil</th><th>Classificação</th><th>Pontos</th><th>Evidências analisadas</th><th class="hide-sm">Por quê</th></tr></thead><tbody>
      ${refs.map((r) => `<tr class="clickable" data-href="#/lead/${r.id}"><td><strong>${esc(r.name)}</strong><br>${r.instagram ? link(igUrl(r.instagram), '@' + r.instagram) : ''}</td>
        <td><span class="tag ${r.reference_label === 'ideal' ? 'ok' : r.reference_label === 'fora' ? 'bad' : 'warn'}">${esc(META.reference_labels[r.reference_label] || '—')}</span></td>
        <td>${scoreBadge(r.score)}</td><td>${confTag(r.confidence_level)}</td><td class="hide-sm"><small>${esc(r.notes || '—')}</small></td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">Nenhuma referência cadastrada.</div>'}</div>`;
  $view.querySelector('[data-action="new-ref"]').addEventListener('click', () => leadForm(null, { reference: true }));
}

// ---------- Rodadas ----------
function runsTable(runs) {
  if (!runs.length) return '<p class="muted">Nenhuma rodada registrada.</p>';
  const tone = { concluida: 'ok', concluida_com_limitacoes: 'warn', falhou: 'bad', em_execucao: 'info' };
  return `<div class="table-wrap"><table><thead><tr><th>#</th><th>Rodada</th><th>Região</th><th class="num">Encontrados</th><th class="num">Novos</th><th class="num hide-sm">Duplicados</th><th class="num hide-sm">Ignorados</th><th>Status</th><th class="hide-sm">Data</th></tr></thead><tbody>
    ${runs.map((r) => `<tr class="clickable" data-href="#/rodada/${r.id}"><td>${r.id}</td><td>${esc(r.label || '—')}${r.is_demo ? ' <span class="tag warn">DEMO</span>' : ''}</td><td>${esc(r.region)}</td>
      <td class="num">${r.leads_found}</td><td class="num">${r.leads_new}</td><td class="num hide-sm">${r.leads_duplicate}</td><td class="num hide-sm">${r.leads_skipped}</td>
      <td><span class="tag ${tone[r.status] || ''}">${esc(r.status.replace(/_/g, ' '))}</span></td><td class="hide-sm"><small>${fmtDate(r.created_at)}</small></td></tr>`).join('')}</tbody></table></div>`;
}

async function viewRuns() {
  const runs = await api('GET', '/api/runs');
  const places = META.providers.find((p) => p.id === 'google_places');
  $view.innerHTML = `
    <div class="page-head"><div><h1>Rodadas de pesquisa</h1><p class="muted">Cada rodada registra região, fontes, quantidades, erros e limitações.</p></div></div>
    <div class="card">${runsTable(runs)}</div>
    <div class="grid grid-2">
      <div class="card"><h2>Importar pesquisa (JSON)</h2><p class="muted"><small>Formato: <code>{"run": {"label","region","sources":[],"limitations":[]}, "leads": [{"name", "specialty", "city", "instagram", "website", "evidence": [...]}]}</code>. Duplicados e rejeitados são tratados automaticamente.</small></p>
        <form id="imp-form"><input type="file" accept="application/json" name="file"><label>ou cole o JSON<textarea name="json"></textarea></label>
        <div class="actions" style="margin-top:.6rem"><button class="btn primary" type="submit">Importar</button></div></form><div id="imp-result"></div></div>
      <div class="card"><h2>Buscar no Google Maps</h2>
        <p class="muted"><small>${esc(places.detail)}</small></p>
        <form id="prov-form" class="form-grid"><label>Busca<input name="query" placeholder="neuropediatra" required></label>
          <label>Região<select name="region">${META.settings.regions.map((r) => `<option ${r === META.settings.active_region ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
          <label>Nome da rodada<input name="label"></label>
          <div class="full actions"><button class="btn primary" type="submit" ${places.available ? '' : 'disabled'}>Pesquisar</button></div></form>
        <p class="muted"><small>Os resultados entram como candidatos, sem sinais de ICP: uma ficha no Maps não comprova estrutura nem atendimento particular.</small></p></div>
    </div>`;
  const imp = document.getElementById('imp-form');
  imp.addEventListener('submit', async (e) => {
    e.preventDefault();
    let text = imp.json.value.trim();
    if (imp.file.files[0]) text = await imp.file.files[0].text();
    let payload; try { payload = JSON.parse(text); } catch { return toast('JSON inválido.', true); }
    const r = await run(() => api('POST', '/api/runs/import', payload), 'Rodada importada');
    location.hash = `#/rodada/${r.run.id}`;
  });
  document.getElementById('prov-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await run(() => api('POST', '/api/runs/provider', { provider: 'google_places', ...formData(e.target) }));
    location.hash = `#/rodada/${r.run.id}`;
  });
}

async function viewRun(id) {
  const { run: r, leads } = await api('GET', `/api/runs/${id}`);
  $view.innerHTML = `<a href="#/rodadas" class="muted">← Rodadas</a>
    ${r.is_demo ? '<div class="banner warn">Rodada de demonstração com dados fictícios.</div>' : ''}
    <div class="page-head"><div><h1>Rodada #${r.id} ${esc(r.label || '')}</h1><p class="muted">${esc(r.region)} · ${fmtDateTime(r.created_at)} · ${esc(r.status.replace(/_/g, ' '))}</p></div></div>
    <div class="kpis"><div class="kpi"><b>${r.leads_found}</b><span>Encontrados</span></div><div class="kpi"><b>${r.leads_new}</b><span>Novos</span></div>
      <div class="kpi"><b>${r.leads_duplicate}</b><span>Duplicados</span></div><div class="kpi"><b>${r.leads_skipped}</b><span>Ignorados (rejeitados/bloqueados)</span></div></div>
    <div class="grid grid-2"><div class="card"><h2>Fontes utilizadas</h2>${r.sources.length ? `<ul class="list">${r.sources.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '<p class="muted">—</p>'}
      ${r.specialties.length ? `<h3>Especialidades</h3><p>${r.specialties.map(esc).join(', ')}</p>` : ''}</div>
      <div class="card"><h2>Erros e limitações</h2>${[...r.errors.map((x) => `<li><span class="tag bad">Erro</span> ${esc(x)}</li>`), ...r.limitations.map((x) => `<li><span class="tag warn">Limitação</span> ${esc(x)}</li>`)].join('') ? `<ul class="list">${[...r.errors.map((x) => `<li><span class="tag bad">Erro</span> ${esc(x)}</li>`), ...r.limitations.map((x) => `<li><span class="tag warn">Limitação</span> ${esc(x)}</li>`)].join('')}</ul>` : '<p class="muted">Nenhuma registrada.</p>'}</div></div>
    <div class="card"><h2>Leads desta rodada</h2>${leads.length ? `<ul class="list">${leads.map((l) => `<li>${scoreBadge(l.score)} <a href="#/lead/${l.id}"><strong>${esc(l.name)}</strong></a> · ${esc(l.specialty || '')} ${confTag(l.confidence_level)} ${statusTag(l.status)}</li>`).join('')}</ul>` : '<p class="muted">Nenhum lead novo.</p>'}</div>`;
}

// ---------- Aprendizado ----------
async function viewLearning() {
  const [lr, cr] = await Promise.all([api('GET', '/api/learning'), api('GET', '/api/criteria')]);
  const pending = lr.suggestions.filter((s) => s.status === 'pendente');
  const decided = lr.suggestions.filter((s) => s.status !== 'pendente');
  $view.innerHTML = `
    <div class="page-head"><div><h1>Aprendizado</h1><p class="muted">O agente identifica padrões nas suas decisões e correções e <strong>propõe</strong> ajustes. Nada muda sem sua aprovação.</p></div>
      <button class="btn primary" data-action="analyze">Analisar minhas decisões</button></div>
    <div id="analysis"></div>
    <div class="card"><h2>Sugestões pendentes (${pending.length})</h2>${pending.length ? `<ul class="list">${pending.map((s) => `<li><span class="tag brand">${s.kind === 'peso' ? 'Ajuste de peso' : 'Frase a evitar'}</span> ${esc(s.rationale)}
      <div class="actions" style="margin-top:.4rem"><button class="btn small ok" data-sug="${s.id}" data-d="aprovar">Aprovar</button><button class="btn small bad" data-sug="${s.id}" data-d="rejeitar">Rejeitar</button></div></li>`).join('')}</ul>` : '<p class="muted">Nenhuma sugestão pendente. São necessárias pelo menos 3 decisões com o mesmo sinal para propor ajuste de peso.</p>'}</div>
    <div class="grid grid-2">
      <div class="card"><h2>Critérios ativos — versão ${cr.active.version}</h2><p class="muted"><small>${esc(cr.active.rationale || '')}</small></p>
        ${cr.active.definition.criteria.map((c) => `<h3>${esc(c.label)} · até ${c.max}</h3><table><tbody>${c.signals.map((s) => `<tr><td>${esc(s.label)}</td><td class="num">${s.points > 0 ? '+' : ''}${s.points}</td></tr>`).join('')}</tbody></table>`).join('')}</div>
      <div>
        <div class="card"><h2>Histórico de versões</h2><ul class="list">${cr.history.map((h) => `<li><strong>v${h.version}</strong> <span class="tag ${h.status === 'ativa' ? 'ok' : ''}">${esc(h.status)}</span> · <small>${fmtDateTime(h.created_at)}</small><br><small>${esc(h.rationale || '')}</small></li>`).join('')}</ul></div>
        <div class="card"><h2>Frases a evitar</h2>${lr.settings.avoid_phrases.length ? `<ul class="list">${lr.settings.avoid_phrases.map((p) => `<li>“${esc(p)}” <button class="btn small" data-rm-phrase="${esc(p)}">Remover</button></li>`).join('')}</ul>` : '<p class="muted">Nenhuma ainda.</p>'}</div>
        <div class="card"><h2>Sugestões decididas</h2>${decided.length ? `<ul class="list">${decided.map((s) => `<li><span class="tag ${s.status === 'aprovada' ? 'ok' : 'bad'}">${esc(s.status)}</span> <small>${esc(s.rationale)}</small></li>`).join('')}</ul>` : '<p class="muted">—</p>'}</div>
      </div>
    </div>
    <div class="card"><h2>Registro de feedback</h2>${lr.feedback.length ? `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Lead</th><th>Tipo</th><th>Decisão</th><th>Motivo / padrão</th></tr></thead><tbody>${lr.feedback.map((f) => `<tr><td><small>${fmtDateTime(f.created_at)}</small></td><td>${f.lead_id ? `<a href="#/lead/${f.lead_id}">${esc(f.lead_name)}</a>` : '—'}</td><td>${esc(f.kind.replace(/_/g, ' '))}</td><td>${esc(f.decision || '')}</td><td><small>${esc(f.reason || f.pattern || '')}</small></td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nenhum feedback registrado.</p>'}</div>`;
  $view.querySelector('[data-action="analyze"]').addEventListener('click', async () => {
    const r = await run(() => api('POST', '/api/learning/analyze'));
    toast(`${r.created} nova(s) sugestão(ões) a partir de ${r.decided_cases} decisões e ${r.edits} correções.`);
    await viewLearning();
    if (r.rejection_reasons.length) document.getElementById('analysis').innerHTML = `<div class="card"><h2>Motivos de rejeição recentes</h2><ul class="list">${r.rejection_reasons.map((x) => `<li><strong>${esc(x.name)}</strong> (${esc(x.specialty || '—')}): ${esc(x.notes)}</li>`).join('')}</ul></div>`;
  });
  $view.querySelectorAll('[data-sug]').forEach((b) => b.addEventListener('click', async () => {
    const note = b.dataset.d === 'rejeitar' ? await ask('Rejeitar sugestão', { label: 'Por quê? (opcional)' }) : '';
    if (note === null) return;
    await run(() => api('POST', `/api/suggestions/${b.dataset.sug}/decision`, { decision: b.dataset.d, note }), b.dataset.d === 'aprovar' ? 'Aprovada. Nova versão aplicada e leads repontuados.' : 'Sugestão rejeitada');
    viewLearning();
  }));
  $view.querySelectorAll('[data-rm-phrase]').forEach((b) => b.addEventListener('click', async () => { await run(() => api('POST', '/api/settings/avoid-phrases/remove', { phrase: b.dataset.rmPhrase }), 'Removida'); viewLearning(); }));
}

// ---------- Indicadores ----------
async function viewMetrics() {
  const f = state.metricFilters || {};
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const [m, runs] = await Promise.all([api('GET', '/api/metrics' + (qs ? '?' + qs : '')), api('GET', '/api/runs')]);
  const t = m.totals;
  const kpi = (v, l) => `<div class="kpi"><b>${v}</b><span>${esc(l)}</span></div>`;
  const max = Math.max(1, ...m.weekly.flatMap((w) => [w.leads, w.aprovados, w.enviadas, w.respostas, w.reunioes]));
  const series = [['leads', 'Leads', 'c1'], ['aprovados', 'Aprovados', 'c2'], ['enviadas', 'Envios', 'c3'], ['respostas', 'Respostas', 'c4'], ['reunioes', 'Reuniões', 'c5']];
  $view.innerHTML = `
    <div class="page-head"><div><h1>Indicadores</h1><p class="muted">${esc(m.notes[0])}</p></div></div>
    <div class="card"><form id="mf" class="filters">
      <label>De<input type="date" name="from" value="${esc(f.from || '')}"></label><label>Até<input type="date" name="to" value="${esc(f.to || '')}"></label>
      <label>Rodada<select name="run"><option value="">Todas</option>${runs.map((r) => `<option value="${r.id}" ${String(f.run) === String(r.id) ? 'selected' : ''}>#${r.id} ${esc(r.label || r.region)}</option>`).join('')}</select></label>
      <label class="check" style="align-self:end"><input type="checkbox" name="include_demo" value="1" ${f.include_demo ? 'checked' : ''}> Incluir demonstração</label></form></div>
    <div class="kpis">${kpi(t.leads_descobertos, 'Leads descobertos')}${kpi(t.leads_qualificados, 'Leads qualificados')}${kpi(t.perfis_aprovados, 'Perfis aprovados')}${kpi(t.perfis_rejeitados, 'Perfis rejeitados')}
      ${kpi(t.mensagens_aprovadas, 'Mensagens aprovadas')}${kpi(t.mensagens_enviadas, 'Envios confirmados')}${kpi(t.respostas_recebidas, 'Responderam')}${kpi(t.reunioes_solicitadas, 'Reuniões solicitadas')}${kpi(t.reunioes_agendadas, 'Reuniões agendadas')}</div>
    <div class="card"><h2>Evolução semanal</h2><div class="legend">${series.map(([, l, c]) => `<span><i class="${c}"></i>${l}</span>`).join('')}</div>
      ${m.weekly.length ? `<div class="chart">${m.weekly.map((w) => `<div class="col"><div class="stack">${series.map(([k, l, c]) => `<i class="${c}" style="height:${(w[k] / max) * 100}%" title="${l}: ${w[k]}"></i>`).join('')}</div><small>${fmtDate(w.semana).slice(0, 5)}</small></div>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>Semana</th>${series.map(([, l]) => `<th class="num">${l}</th>`).join('')}</tr></thead><tbody>${m.weekly.map((w) => `<tr><td>${fmtDate(w.semana)}</td>${series.map(([k]) => `<td class="num">${w[k]}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">Sem eventos no período.</p>'}</div>
    <div class="card"><h2>Por rodada</h2><div class="table-wrap"><table><thead><tr><th>Rodada</th><th>Região</th><th class="num">Leads</th><th>Data</th></tr></thead><tbody>${m.by_run.map((r) => `<tr><td>#${r.id} ${esc(r.label || '')}${r.is_demo ? ' <span class="tag warn">DEMO</span>' : ''}</td><td>${esc(r.region)}</td><td class="num">${r.leads}</td><td>${fmtDate(r.created_at)}</td></tr>`).join('')}</tbody></table></div></div>`;
  document.getElementById('mf').addEventListener('change', (e) => { state.metricFilters = formData(e.currentTarget); if (!state.metricFilters.include_demo) delete state.metricFilters.include_demo; else state.metricFilters.include_demo = '1'; viewMetrics(); });
}

// ---------- Configurações ----------
async function viewConfig() {
  const s = META.settings;
  $view.innerHTML = `
    <div class="page-head"><div><h1>Configurações</h1><p class="muted">Regiões, especialidades e parâmetros de operação.</p></div></div>
    <form id="cfg" class="card form-grid">
      <label class="full">Regiões de pesquisa (uma por linha)<textarea name="regions">${esc(s.regions.join('\n'))}</textarea></label>
      <label>Região ativa<select name="active_region">${s.regions.map((r) => `<option ${r === s.active_region ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
      <label>Frequência de pesquisa<select name="research_frequency">${[['manual', 'Manual'], ['semanal', 'Semanal'], ['quinzenal', 'Quinzenal']].map(([v, l]) => `<option value="${v}" ${s.research_frequency === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Meta semanal de novos leads<input type="number" name="weekly_target" min="1" max="200" value="${s.weekly_target}"></label>
      <label>Nota prioritária<input type="number" name="priority_threshold" min="0" max="100" value="${s.priority_threshold}"></label>
      <label>Nota de lead qualificado<input type="number" name="qualified_threshold" min="0" max="100" value="${s.qualified_threshold}"></label>
      <label>Dias mínimos antes da retomada<input type="number" name="followup_min_days" min="1" max="60" value="${s.followup_min_days}"></label>
      <label class="full">Especialidades de interesse (uma por linha)<textarea name="specialties">${esc(s.specialties.join('\n'))}</textarea></label>
      <div class="full banner info">Automação recorrente: <strong>desativada</strong>. Pela ordem combinada, só será desenvolvida depois da validação do piloto e com sua aprovação. A frequência acima fica registrada para essa etapa.</div>
      <div class="full actions"><button class="btn primary" type="submit">Salvar</button></div>
    </form>
    <div class="card"><h2>Integrações</h2><ul class="list">${META.providers.map((p) => `<li><strong>${esc(p.label)}</strong> <span class="tag ${p.available ? (p.tested ? 'ok' : 'warn') : 'bad'}">${p.available ? (p.tested ? 'Disponível' : 'Não validado') : 'Indisponível'}</span><br><small>${esc(p.detail)}</small></li>`).join('')}</ul></div>`;
  document.getElementById('cfg').addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(e.target);
    const lines = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);
    const body = { regions: lines(d.regions), active_region: d.active_region, research_frequency: d.research_frequency, specialties: lines(d.specialties),
      weekly_target: Number(d.weekly_target), priority_threshold: Number(d.priority_threshold), qualified_threshold: Number(d.qualified_threshold), followup_min_days: Number(d.followup_min_days) };
    if (!body.regions.includes(body.active_region)) body.active_region = body.regions[0];
    await run(() => api('PUT', '/api/settings', body), 'Configurações salvas');
    router();
  });
}

router();
