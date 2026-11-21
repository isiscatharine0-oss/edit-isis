'use strict';
// Rotas HTTP (API JSON) + arquivos estáticos do painel. Sem frameworks.
const fs = require('node:fs');
const path = require('node:path');
const { createStore, RuleError, LEAD_STATUSES, REFERENCE_LABELS } = require('./store');
const { RELIABILITY, HOOK_TYPES } = require('./criteria');
const { INTERACTION_KINDS, suggest } = require('./playbook');
const providers = require('./providers');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function createApp(db) {
  const store = createStore(db);
  const routes = [];
  const on = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };

  on('GET', '/api/meta', () => ({
    statuses: LEAD_STATUSES, reliability: RELIABILITY, hook_types: HOOK_TYPES, interaction_kinds: INTERACTION_KINDS,
    reference_labels: REFERENCE_LABELS, criteria: store.activeCriteria(), providers: providers.list(store.getSettings()), settings: store.getSettings(),
  }));
  on('GET', '/api/overview', () => ({ metrics: store.metrics({}).totals, pending: store.pendingActions(), providers: providers.list(store.getSettings()), runs: store.listRuns().slice(0, 5) }));

  on('GET', '/api/leads', ({ query }) => store.listLeads(query));
  on('POST', '/api/leads', ({ body }) => {
    const r = store.createLead(body, { origin: 'usuaria' });
    for (const e of body.evidence || []) store.addEvidence(r.lead.id, e);
    return r;
  });
  on('GET', '/api/leads/:id', ({ p }) => store.getLead(p.id));
  on('PATCH', '/api/leads/:id', ({ p, body }) => store.updateLead(p.id, body));
  on('POST', '/api/leads/:id/evidence', ({ p, body }) => store.addEvidence(p.id, body));
  on('DELETE', '/api/evidence/:id', ({ p }) => store.deleteEvidence(p.id));
  on('POST', '/api/leads/:id/rescore', ({ p }) => store.rescore(p.id));
  on('POST', '/api/leads/:id/decision', ({ p, body }) => store.decideLead(p.id, body.decision, body.notes));
  on('POST', '/api/leads/:id/messages', ({ p, body }) => store.generateMessage(p.id, body));
  on('POST', '/api/leads/:id/interactions', ({ p, body }) => store.addInteraction(p.id, body));
  on('GET', '/api/leads/:id/suggest-reply', ({ p, query }) => suggest(query.kind, store.getLead(p.id).lead));

  on('PATCH', '/api/messages/:id', ({ p, body }) => store.editMessage(p.id, body.text));
  on('POST', '/api/messages/:id/decision', ({ p, body }) => store.decideMessage(p.id, body.decision, body.notes));
  on('POST', '/api/messages/:id/sent', ({ p, body }) => store.confirmSent(p.id, body.note));
  on('POST', '/api/interactions/:id/done', ({ p }) => store.completeAction(p.id));

  on('GET', '/api/runs', () => store.listRuns());
  on('GET', '/api/runs/:id', ({ p }) => ({ run: store.getRun(p.id), leads: store.listLeads({ run: p.id, reference: 'all' }) }));
  on('POST', '/api/runs/import', ({ body }) => store.importRun(body));
  on('POST', '/api/runs/provider', async ({ body }) => {
    const prov = providers.get(body.provider);
    if (!prov || !prov.search) throw new RuleError('Provedor indisponível para busca automática.');
    const st = providers.statusOf(prov, store.getSettings());
    if (!st.available) throw new RuleError(`Provedor indisponível: ${st.detail}`);
    const runId = store.startRun({ label: body.label, region: body.region, specialties: [body.query], sources: [prov.label],
      limitations: st.tested ? [] : ['Integração ainda não validada: revise os resultados.'] });
    try {
      const cands = await prov.search({ query: body.query, region: body.region, maxResults: body.max_results || 10 });
      const { counts, details } = store.ingestCandidates(runId, cands, `provedor:${prov.id}`, false);
      return { run: store.finishRun(runId, counts), details };
    } catch (e) {
      return { run: store.finishRun(runId, { found: 0, created: 0, duplicate: 0, skipped: 0 }, [e.message]), details: [] };
    }
  });

  on('GET', '/api/criteria', () => ({ active: store.activeCriteria(), history: store.criteriaHistory() }));
  on('GET', '/api/learning', () => ({ suggestions: store.listSuggestions(), feedback: store.feedbackList(), settings: store.getSettings() }));
  on('POST', '/api/learning/analyze', () => store.analyzeLearning());
  on('POST', '/api/suggestions/:id/decision', ({ p, body }) => store.decideSuggestion(p.id, body.decision, body.note));
  on('POST', '/api/settings/avoid-phrases/remove', ({ body }) => store.removeAvoidPhrase(body.phrase));

  on('GET', '/api/metrics', ({ query }) => store.metrics({ from: query.from, to: query.to, run: query.run, include_demo: query.include_demo === '1' }));
  on('GET', '/api/settings', () => store.getSettings());
  on('PUT', '/api/settings', ({ body }) => store.updateSettings(body));
  on('GET', '/api/audit', () => store.auditLog(200));

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const route = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
        if (!route) return send(res, 404, { error: 'Rota não encontrada.' });
        const m = url.pathname.match(route.re);
        const p = Object.fromEntries(route.keys.map((k, i) => [k, Number(m[i + 1])]));
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};
        const result = await route.handler({ p, body, query: Object.fromEntries(url.searchParams) });
        return send(res, 200, result);
      }
      return serveStatic(url.pathname, res);
    } catch (e) {
      const status = e instanceof RuleError ? e.status : e.status || 500;
      if (status >= 500) console.error(e);
      return send(res, status, { error: e.message });
    }
  }

  return { handle, store };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 5e6) { reject(Object.assign(new Error('Corpo muito grande.'), { status: 413 })); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); } });
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'" });
    res.end(buf);
  });
}

module.exports = { createApp };
