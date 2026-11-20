'use strict';
// Registro de provedores de pesquisa. Cada provedor expõe: id, label, status(), e opcionalmente search().
// Para acrescentar um provedor, crie um módulo com essa interface e registre aqui.
const googlePlaces = require('./googlePlaces');

const manual = {
  id: 'manual',
  label: 'Cadastro manual / importação de arquivo (JSON)',
  status: () => ({ available: true, tested: true, detail: 'Cadastro pelo painel ou importação de pesquisa com fontes e URLs.' }),
};

const instagram = {
  id: 'instagram_business_discovery',
  label: 'Instagram Graph API — Business Discovery',
  status: () => ({
    available: false, tested: false,
    detail: 'Não implementado no MVP. Requer conta Profissional da Isis conectada via OAuth da Meta (app aprovado) e só lê contas profissionais. '
      + 'A API não permite buscar perfis por nicho/região nem enviar mensagem fria.',
  }),
};

const PROVIDERS = [manual, googlePlaces, instagram];

function list() { return PROVIDERS.map((p) => ({ id: p.id, label: p.label, ...p.status() })); }
function get(id) { return PROVIDERS.find((p) => p.id === id); }

module.exports = { list, get };
