'use strict';
// Camada de persistência. Usa o SQLite nativo do Node (node:sqlite), sem dependências.
// Toda a aplicação acessa o banco por aqui, então trocar de motor no futuro fica restrito a este arquivo.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DEFAULT_CRITERIA } = require('./criteria');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lead (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address_as TEXT,                 -- forma de tratamento na mensagem (ex.: "doutora", "Ana")
  specialty TEXT,
  city TEXT,
  state TEXT,
  neighborhood TEXT,
  instagram TEXT,
  website TEXT,
  other_links TEXT NOT NULL DEFAULT '[]',
  registry TEXT,                   -- registro profissional informado publicamente (CRM/CRO/CRP)
  is_reference INTEGER NOT NULL DEFAULT 0,
  reference_label TEXT,            -- ideal | potencial | fora
  is_demo INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'novo',
  do_not_contact INTEGER NOT NULL DEFAULT 0,
  dedup_name TEXT,
  research_run_id INTEGER REFERENCES research_run(id),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lead_dedup ON lead(dedup_name, city);
CREATE INDEX IF NOT EXISTS idx_lead_ig ON lead(instagram);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  criterion TEXT NOT NULL,         -- estrutura | marketing | autoridade | momento | geral
  signal TEXT,                     -- código do sinal do ICP (ver criteria.js)
  description TEXT NOT NULL,
  source_name TEXT NOT NULL,
  url TEXT,
  consulted_at TEXT NOT NULL,      -- data em que a fonte foi consultada
  fact_date TEXT,                  -- data do fato, quando conhecida
  reliability TEXT NOT NULL,       -- verificado | observado | indireto | hipotese
  origin TEXT NOT NULL,            -- pesquisa_agente | usuaria | provedor:<nome>
  hook_type TEXT,                  -- se pode ser usada como referência de abordagem
  hook_text TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS criteria_version (
  id INTEGER PRIMARY KEY,
  version INTEGER NOT NULL,
  definition TEXT NOT NULL,        -- JSON com critérios, sinais e pontos
  status TEXT NOT NULL,            -- ativa | substituida
  rationale TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lead_score (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  criteria_version_id INTEGER NOT NULL REFERENCES criteria_version(id),
  total INTEGER NOT NULL,
  breakdown TEXT NOT NULL,         -- JSON pontuação por critério
  justification TEXT NOT NULL,     -- JSON lista de itens que contribuíram
  missing TEXT NOT NULL,           -- JSON informações ausentes
  flags TEXT NOT NULL,             -- JSON inconsistências
  confidence INTEGER NOT NULL,
  confidence_level TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approval (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,              -- lead | mensagem
  message_id INTEGER REFERENCES outreach_message(id),
  decision TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outreach_message (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,           -- inicial | retomada | resposta
  reply_kind TEXT,
  text TEXT NOT NULL,
  original_text TEXT NOT NULL,
  reference_evidence_id INTEGER REFERENCES evidence(id),
  reference_text TEXT,
  template_id TEXT,
  generator TEXT NOT NULL,
  version INTEGER NOT NULL,
  approval_status TEXT NOT NULL,   -- rascunho | aprovada | rejeitada | substituida
  send_status TEXT NOT NULL,       -- nao_enviada | enviada
  sent_at TEXT,
  sent_note TEXT,
  warnings TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS message_edit (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES outreach_message(id) ON DELETE CASCADE,
  before_text TEXT NOT NULL,
  after_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS interaction (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES lead(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  summary TEXT,
  source TEXT NOT NULL,            -- registro_manual | sistema
  occurred_at TEXT NOT NULL,
  next_action TEXT,
  next_action_due TEXT,
  next_action_done INTEGER NOT NULL DEFAULT 0,
  message_id INTEGER REFERENCES outreach_message(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER REFERENCES lead(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES outreach_message(id),
  kind TEXT NOT NULL,              -- decisao_lead | correcao_mensagem | decisao_mensagem | geral
  decision TEXT,
  reason TEXT,
  pattern TEXT,
  suggestion_id INTEGER REFERENCES suggestion(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suggestion (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,              -- peso | frase_evitar
  target TEXT NOT NULL,            -- código do sinal ou frase
  payload TEXT NOT NULL,           -- JSON
  rationale TEXT NOT NULL,
  status TEXT NOT NULL,            -- pendente | aprovada | rejeitada
  decided_note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS research_run (
  id INTEGER PRIMARY KEY,
  label TEXT,
  region TEXT NOT NULL,
  specialties TEXT NOT NULL DEFAULT '[]',
  period_start TEXT,
  period_end TEXT,
  sources TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,            -- em_execucao | concluida | concluida_com_limitacoes | falhou
  leads_found INTEGER NOT NULL DEFAULT 0,
  leads_new INTEGER NOT NULL DEFAULT 0,
  leads_duplicate INTEGER NOT NULL DEFAULT 0,
  leads_skipped INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]',
  limitations TEXT NOT NULL DEFAULT '[]',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL
);
`;

const DEFAULT_SETTINGS = {
  regions: ['Salvador - BA', 'Região Metropolitana de Salvador - BA'],
  active_region: 'Salvador - BA',
  specialties: ['Neurologia', 'Psiquiatria', 'Pediatria', 'Dermatologia', 'Ginecologia', 'Cardiologia',
    'Ortopedia', 'Endocrinologia', 'Odontopediatria', 'Neuropsicologia'],
  research_frequency: 'manual',       // manual | semanal | quinzenal
  automation_enabled: false,          // automações recorrentes só após aprovação (fase 7)
  weekly_target: 20,
  priority_threshold: 90,
  qualified_threshold: 70,
  followup_min_days: 4,
  max_qualification_questions: 2,
  avoid_phrases: [],
  allow_paid_integrations: false,     // decisão da Isis: operar sem custos até nova autorização
};

function nowIso() { return new Date().toISOString(); }

function open(dbPath) {
  const file = dbPath || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'isis.db');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

function seed(db) {
  const has = db.prepare('SELECT COUNT(*) AS n FROM criteria_version').get().n;
  if (!has) {
    db.prepare('INSERT INTO criteria_version (version, definition, status, rationale, created_at) VALUES (1, ?, ?, ?, ?)')
      .run(JSON.stringify(DEFAULT_CRITERIA), 'ativa', 'Versão inicial definida no briefing da Isis Social Media.', nowIso());
  }
  const ins = db.prepare('INSERT OR IGNORE INTO setting (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, JSON.stringify(v));
}

// Transação reentrante: chamadas aninhadas usam SAVEPOINT.
const depth = new WeakMap();
function tx(db, fn) {
  const d = depth.get(db) || 0;
  const name = `sp${d}`;
  db.exec(d === 0 ? 'BEGIN' : `SAVEPOINT ${name}`);
  depth.set(db, d + 1);
  try {
    const r = fn();
    depth.set(db, d);
    db.exec(d === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return r;
  } catch (e) {
    depth.set(db, d);
    db.exec(d === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw e;
  }
}

module.exports = { open, tx, nowIso, DEFAULT_SETTINGS };
