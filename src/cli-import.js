'use strict';
// Importa uma rodada de pesquisa a partir de um arquivo JSON: node src/cli-import.js <arquivo.json>
const fs = require('node:fs');
const db = require('./db').open();
const { createStore } = require('./store');

const file = process.argv[2];
if (!file) { console.error('Uso: node src/cli-import.js <arquivo.json>'); process.exit(1); }
const store = createStore(db);
const res = store.importRun(JSON.parse(fs.readFileSync(file, 'utf8')));
console.log(`Rodada #${res.run.id} (${res.run.status}): ${res.run.leads_new} novos, ${res.run.leads_duplicate} duplicados, ${res.run.leads_skipped} ignorados.`);
for (const d of res.details) console.log(` - ${d.name}: ${d.result}${d.reason ? ` (${d.reason})` : ''}`);
