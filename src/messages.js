'use strict';
// Geração e validação de mensagens. Gerador local por modelos (custo zero), sempre a partir de um fato real
// registrado como evidência. O texto é sempre um rascunho: precisa de aprovação individual da usuária.

const SALUTATIONS = [
  (t) => `Oi, ${t}! Tudo bem?`,
  (t) => `Ei, ${t}! Tudo bem?`,
  (t) => `Olá, ${t}, tudo bem?`,
];

// {h} = texto do fato, que completa "você ..." (ex.: "inaugurou o novo consultório no Itaigara").
const OPENERS = {
  inauguracao: [
    { id: 'inaug-1', t: (h) => `Vi que você ${h}. Imagino a alegria de ver esse projeto tomando forma!` },
    { id: 'inaug-2', t: (h) => `Vi que você ${h}. Que fase boa! Como está sendo essa nova etapa?` },
    { id: 'inaug-3', t: (h) => `Acompanhei que você ${h}. Deve ser muito especial ver esse espaço pronto.` },
  ],
  congresso: [
    { id: 'cong-1', t: (h) => `Vi que você ${h}. Como foi a experiência? Imagino que tenha sido uma troca rica.` },
    { id: 'cong-2', t: (h) => `Acompanhei que você ${h}. Fiquei curiosa: o que mais te marcou por lá?` },
  ],
  publicacao_educativa: [
    { id: 'pub-1', t: (h) => `Vi que você ${h}. Gostei da forma como você trouxe o tema, bem acessível pra quem está do outro lado.` },
    { id: 'pub-2', t: (h) => `Passei pelo seu conteúdo em que você ${h}. É o tipo de explicação que ajuda de verdade.` },
  ],
  conquista: [
    { id: 'conq-1', t: (h) => `Vi que você ${h}. Parabéns! Imagino quanta dedicação tem por trás disso.` },
    { id: 'conq-2', t: (h) => `Acompanhei que você ${h}. Como está sendo viver esse momento?` },
  ],
  expansao: [
    { id: 'exp-1', t: (h) => `Vi que você ${h}. Que momento bom! Como está sendo essa ampliação?` },
    { id: 'exp-2', t: (h) => `Acompanhei que você ${h}. Imagino que seja um passo importante na sua trajetória.` },
  ],
  outro: [
    { id: 'out-1', t: (h) => `Vi que você ${h} e quis passar aqui pra comentar.` },
    { id: 'out-2', t: (h) => `Acompanhei que você ${h}. Achei muito bacana.` },
  ],
};

const FOLLOWUPS = [
  { id: 'ret-1', t: (s) => `${s} Passando só pra retomar minha mensagem, sem pressa nenhuma. Se em algum momento fizer sentido trocar uma ideia, fico por aqui.` },
  { id: 'ret-2', t: (s) => `${s} Lembrei de você e quis retomar nossa conversa, bem tranquilo. Quando tiver um tempinho, vai ser um prazer conversar.` },
];

function addressOf(lead) {
  if (lead.address_as && lead.address_as.trim()) return lead.address_as.trim();
  const first = String(lead.name || '').replace(/^(dra?\.?|dr\.?)\s+/i, '').split(/\s+/)[0];
  return first || 'tudo bem';
}

function cleanHook(h) {
  return String(h || '').trim().replace(/^(vi que )?(você )/i, '').replace(/[.!\s]+$/, '');
}

/** Escolhe a variação menos usada (evita mensagens repetitivas), deslocada pela versão. */
function pickVariant(list, usage, version, avoid) {
  const allowed = list.filter((v) => !avoid(v));
  const pool = allowed.length ? allowed : list;
  const sorted = [...pool].sort((a, b) => (usage[a.id] || 0) - (usage[b.id] || 0));
  return sorted[(version - 1) % sorted.length];
}

/**
 * @param {Object} p { lead, evidence, purpose, version, usage, avoidPhrases }
 */
function generate(p) {
  const { lead, purpose = 'inicial', version = 1, usage = {}, avoidPhrases = [] } = p;
  const avoidTest = (render) => (v) => {
    const text = render(v).toLowerCase();
    return avoidPhrases.some((ph) => ph && text.includes(ph.toLowerCase()));
  };
  const salut = SALUTATIONS[(version - 1 + (lead.id || 0)) % SALUTATIONS.length](addressOf(lead));

  if (purpose === 'retomada') {
    const v = pickVariant(FOLLOWUPS, usage, version, avoidTest((x) => x.t(salut)));
    return { text: v.t(salut), template_id: v.id };
  }
  const ev = p.evidence;
  if (!ev || !ev.hook_text) throw new Error('A abordagem precisa partir de um fato real registrado como evidência (com texto de referência).');
  const hook = cleanHook(ev.hook_text);
  const list = OPENERS[ev.hook_type] || OPENERS.outro;
  const v = pickVariant(list, usage, version, avoidTest((x) => x.t(hook)));
  return { text: `${salut} ${v.t(hook)}`, template_id: v.id };
}

// ---- Validação: regras do estilo da Isis ----
const HARD_RULES = [
  { code: 'promessa', re: /\b(garant\w*|resultado[s]? (certo|garantido)|vou (te )?trazer|mais pacientes|\d+\s*pacientes|lotar (a |sua )?agenda)\b/i,
    message: 'Promessa de resultado ou de quantidade de pacientes.' },
  { code: 'preco', re: /(r\$\s*\d|\bdesconto\b|\bor[cç]amento\b|\bpre[cç]o\b|\bvalores?\b)/i, message: 'Menciona preço, valores, orçamento ou desconto.' },
  { code: 'critica', re: /\b(fraco|ruim|amador\w*|errad\w*|mal feito|abandonad\w*|parad[oa]|melhorar (o |seu )?(instagram|perfil))\b/i,
    message: 'Critica a comunicação/Instagram do profissional.' },
];
const SOFT_RULES = [
  { code: 'elogio_generico', re: /\b(perfil (incr[ií]vel|maravilhoso|lindo)|maravilhos\w*|incr[ií]vel|perfeit\w*|sensacional)\b/i,
    message: 'Elogio genérico ou exagerado.' },
  { code: 'pitch_primeiro_contato', re: /\b(social media|gest[aã]o de redes|marketing|meus servi[cç]os|minha ag[eê]ncia|proposta)\b/i,
    message: 'Apresentação comercial no primeiro contato.', purposes: ['inicial'] },
  { code: 'mensagem_automatica', re: /\b(prezad[oa]|venho por meio|gostar[ií]amos de apresentar|nossa empresa)\b/i,
    message: 'Formalidade excessiva / soa como disparo automático.' },
];

function validate(text, { purpose = 'inicial', avoidPhrases = [] } = {}) {
  const errors = [];
  const warnings = [];
  for (const r of HARD_RULES) if (r.re.test(text)) errors.push({ code: r.code, message: r.message });
  for (const r of SOFT_RULES) {
    if (r.purposes && !r.purposes.includes(purpose)) continue;
    if (r.re.test(text)) warnings.push({ code: r.code, message: r.message });
  }
  const limit = purpose === 'resposta' ? 600 : 350;
  if (text.length > limit) warnings.push({ code: 'longa', message: `Mensagem longa (${text.length} caracteres; ideal até ${limit}).` });
  if ((text.match(/!/g) || []).length > 3) warnings.push({ code: 'exclamacoes', message: 'Muitas exclamações.' });
  for (const ph of avoidPhrases) {
    if (ph && text.toLowerCase().includes(ph.toLowerCase())) warnings.push({ code: 'frase_evitar', message: `Contém frase que você pediu para evitar: "${ph}".` });
  }
  return { errors, warnings };
}

function countQuestions(text) {
  return (text.match(/\?/g) || []).length;
}

/** Frases removidas pela usuária numa edição (para aprender o que evitar). */
function removedSentences(before, after) {
  const split = (t) => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const afterNorm = after.toLowerCase();
  return split(before).filter((s) => !afterNorm.includes(s.toLowerCase()));
}

module.exports = { generate, validate, countQuestions, removedSentences, addressOf, OPENERS };
