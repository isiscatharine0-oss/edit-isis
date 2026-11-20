'use strict';
const { open } = require('../src/db');
const { createStore } = require('../src/store');

function fresh() {
  const db = open(':memory:');
  return { db, store: createStore(db) };
}

const today = () => new Date().toISOString().slice(0, 10);

function ev(over = {}) {
  return { criterion: 'estrutura', signal: 'consultorio_proprio', description: 'Site informa consultório próprio no Itaigara.',
    source_name: 'Site oficial', url: 'https://exemplo.test/sobre', reliability: 'verificado', origin: 'pesquisa_agente', consulted_at: today(), ...over };
}

function hookEv(over = {}) {
  return ev({ criterion: 'momento', signal: 'inauguracao_ampliacao', description: 'Post anunciando inauguração do novo consultório.',
    source_name: 'Instagram (post público)', url: 'https://exemplo.test/post', hook_type: 'inauguracao',
    hook_text: 'inaugurou seu novo consultório no Itaigara', ...over });
}

/** Lead aprovado com um fato de abordagem. */
function approvedLead(store, name = 'Dra. Teste Exemplo') {
  const { lead } = store.createLead({ name, specialty: 'Pediatria', city: 'Salvador', address_as: 'doutora', is_demo: true });
  store.addEvidence(lead.id, ev());
  store.addEvidence(lead.id, hookEv());
  store.decideLead(lead.id, 'aprovar', 'Boa estrutura');
  return lead;
}

module.exports = { fresh, ev, hookEv, approvedLead, today };
