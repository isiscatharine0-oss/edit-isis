'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Carrega .env simples (sem dependências), sem sobrescrever variáveis já definidas.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env) && m[2] !== '') process.env[m[1]] = m[2];
  }
}

const db = require('./db').open();
const { createApp } = require('./app');
const { handle } = createApp(db);

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
http.createServer(handle).listen(port, host, () => {
  console.log(`Isis Social Media · Prospecção — http://${host}:${port}`);
});
