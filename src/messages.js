'use strict';
// Geração e validação de mensagens. Gerador local por modelos (custo zero), sempre a partir de um fato real
// registrado como evidência. O texto é sempre um rascunho: precisa de aprovação individual da usuária.

const SALUTATIONS = [
  (t) => `Oi, ${t}! Tudo bem?`,
  (t) => `Ei, ${t}! Tudo bem?`,
  (t) => `Oi, ${t}, tudo bom?`,
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
    { id: 'out-1', t: (h) => `Vi que você ${h}, achei muito bacana!` },
    { id: 'out-2', t: (h) => `Vi que você ${h}. Que legal ver isso!` },
  ],
};

// Resposta a story: curta, reativa, sem saudação formal — conversa, não apresentação.
// {h} completa "você ..." e deve descrever o que aparece no story (ex.: "mostrou a sala nova do consultório").
const STORY = {
  inauguracao: [
    { id: 'st-inaug-1', t: (h) => `Que lindo que você ${h}! Imagino a alegria 😍` },
    { id: 'st-inaug-2', t: (h) => `Que demais que você ${h}! Como está sendo essa fase?` },
  ],
  congresso: [
    { id: 'st-cong-1', t: (h) => `Que legal que você ${h}! Teve algo que te surpreendeu por lá?` },
    { id: 'st-cong-2', t: (h) => `Amei ver que você ${h} 👏 Como está sendo?` },
  ],
  publicacao_educativa: [
    { id: 'st-pub-1', t: (h) => `Adorei que você ${h}! Explicação super clara 👏` },
    { id: 'st-pub-2', t: (h) => `Que bom que você ${h}, muita gente precisa ouvir isso!` },
  ],
  conquista: [
    { id: 'st-conq-1', t: (h) => `Que demais que você ${h}! Parabéns 👏` },
    { id: 'st-conq-2', t: (h) => `Que orgulho ver que você ${h}! Merecido demais` },
  ],
  expansao: [
    { id: 'st-exp-1', t: (h) => `Que fase boa! Amei ver que você ${h} 👏` },
    { id: 'st-exp-2', t: (h) => `Que demais que você ${h}! Como está sendo essa nova etapa?` },
  ],
  outro: [
    { id: 'st-out-1', t: (h) => `Que legal que você ${h}!` },
    { id: 'st-out-2', t: (h) => `Amei ver que você ${h} 👏` },
  ],
};

const FOLLOWUPS = [
  { id: 'ret-1', t: (s) => `${s} Passando só pra retomar minha mensagem, sem pressa nenhuma. Se em algum momento fizer sentido trocar uma ideia, fico por aqui.` },
  { id: 'ret-2', t: (s) => `${s} Lembrei de você e quis retomar nossa conversa, bem tranquilo. Quando tiver um tempinho, vai ser um prazer conversar.` },
];

function addressOf(lead) {
  if (lead.address_as && lead.address_as.trim()) return lead.address_as.trim();
  const m = String(lead.name || '').match(/^(Dra?\.)\s+(\S+)/i);
  if (m) return `${m[1].charAt(0).toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`;
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
  if (p.channel === 'story') {
    const sl = STORY[ev.hook_type] || STORY.outro;
    const sv = pickVariant(sl, usage, version, avoidTest((x) => x.t(hook)));
    return { text: sv.t(hook), template_id: sv.id };
  }
  const list = OPENERS[ev.hook_type] || OPENERS.outro;
  const v = pickVariant(list, usage, version, avoidTest((x) => x.t(hook)));
  return { text: `${salut} ${v.t(hook)}`, template_id: v.id };
}

// Formato "ideia de conteúdo" — estrutura extraída de uma mensagem real da Isis (set/2026):
// observação específica sobre como a pessoa comunica → ideia concreta de quadro → por que combina → pergunta aberta.
// A ideia em si é criativa: vem da Isis (ou de um rascunho escrito com ela); o sistema só monta e valida.
// Ajuste da Isis (25/11/2026): abrir com um elogio específico e fechar com apresentação + convite para conversar.
const ISIS_INTRO = 'Sou a Isis, da Isis Social Media, e trabalho com estratégia e gestão de redes sociais para profissionais da saúde.';
const ISIS_CLOSE = 'O que achou da ideia? Teria interesse em conversar sobre esse trabalho para o seu perfil?';

function generateIdea(lead, idea) {
  idea = idea || {};
  const need = ['nome', 'descricao'];
  if (!String(idea.elogio || idea.observacao || '').trim() || need.some((k) => !String(idea[k] || '').trim())) {
    throw new Error('Preencha o elogio (ou a observação), o nome do quadro e a descrição da ideia.');
  }
  const clean = (s) => String(s).trim().replace(/[.!\s]+$/, '');
  const obs = clean(idea.observacao).replace(/^(a forma como )?(você )/i, '');
  const desc = clean(idea.descricao).replace(/^(em cada vídeo, )?(você )?(poderia )/i, '');
  const why = idea.porque ? clean(idea.porque).replace(/^(pode )?(ajudar )?(o público a )/i, '') : '';
  const t = addressOf(lead);
  const opening = idea.elogio ? `Oi, ${t}! Tudo bem? ${clean(idea.elogio)}.` : `Oi, ${t}! Conheci seu perfil e gostei muito da forma como você ${obs}.`;
  const reason = idea.porque_frase ? ` ${clean(idea.porque_frase)}.`
    : why ? ` Acredito que esse formato combina muito com a sua proposta e pode ajudar o público a ${why}.` : '';
  const closing = idea.apresentar === false ? 'O que você acha dessa ideia?' : `${ISIS_INTRO} ${ISIS_CLOSE}`;
  return `${opening}\n\n`
    + `Enquanto olhava seus conteúdos, tive a ideia de um quadro chamado “${clean(idea.nome).replace(/^["“]|["”]$/g, '')}”. Em cada vídeo, você poderia ${desc}.${reason}`
    + `\n\n${closing}`;
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
  { code: 'pitch_primeiro_contato', re: /\b(social media|gest[aã]o de redes|marketing|meus servi[cç]os|minha ag[eê]ncia|(minha|nossa|uma) proposta( comercial)?|proposta comercial)\b/i,
    message: 'Apresentação comercial no primeiro contato.', purposes: ['inicial'] },
  { code: 'mensagem_automatica', re: /\b(prezad[oa]|venho por meio|gostar[ií]amos de apresentar|nossa empresa)\b/i,
    message: 'Formalidade excessiva / soa como disparo automático.' },
];

function validate(text, opts = {}) {
  const { purpose = 'inicial', avoidPhrases = [] } = opts;
  const errors = [];
  const warnings = [];
  for (const r of HARD_RULES) if (r.re.test(text)) errors.push({ code: r.code, message: r.message });
  for (const r of SOFT_RULES) {
    if (r.purposes && !r.purposes.includes(purpose)) continue;
    if (r.code === 'pitch_primeiro_contato' && opts.channel === 'ideia') continue; // apresentação no fim é escolha da Isis
    if (r.re.test(text)) warnings.push({ code: r.code, message: r.message });
  }
  const limit = purpose === 'resposta' ? 600 : opts.channel === 'story' ? 160 : opts.channel === 'ideia' ? 900 : 350;
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

module.exports = { generate, generateIdea, validate, countQuestions, removedSentences, addressOf, OPENERS, STORY };
