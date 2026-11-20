'use strict';
// Critérios do ICP — versão 1 (briefing da Isis Social Media).
// Cada critério tem um teto; cada sinal soma pontos quando há evidência.
// Sinais com pontos negativos são contra-indicadores (reduzem a nota e podem gerar alerta).
// Alterações só acontecem criando uma nova versão aprovada pela usuária (ver store.decideSuggestion).

const DEFAULT_CRITERIA = {
  criteria: [
    {
      code: 'estrutura', label: 'Estrutura e solidez profissional', max: 35,
      signals: [
        { code: 'consultorio_proprio', label: 'Consultório próprio ou posicionamento pessoal consolidado em clínica', points: 12 },
        { code: 'atendimento_particular', label: 'Atendimento particular', points: 8 },
        { code: 'equipe', label: 'Equipe de apoio / organização operacional', points: 8 },
        { code: 'expansao_estrutura', label: 'Expansão ou consolidação da estrutura', points: 7 },
      ],
    },
    {
      code: 'marketing', label: 'Oportunidade de marketing', max: 30,
      signals: [
        { code: 'baixa_presenca_profissional', label: 'Profissional aparece pouco nos próprios conteúdos', points: 8 },
        { code: 'conteudo_generico', label: 'Publicações frequentes, mas genéricas', points: 6 },
        { code: 'comunicacao_institucional', label: 'Comunicação excessivamente institucional', points: 5 },
        { code: 'autoridade_pouco_demonstrada', label: 'Conteúdo não demonstra a autoridade do especialista', points: 6 },
        { code: 'falta_diferenciacao', label: 'Falta de diferenciação frente a outros perfis da especialidade', points: 5 },
        { code: 'estrutura_maior_que_comunicacao', label: 'Estrutura profissional mais desenvolvida que a comunicação digital', points: 8 },
        { code: 'marketing_estruturado', label: 'Contra-indicador: marketing já muito desenvolvido', points: -12 },
      ],
    },
    {
      code: 'autoridade', label: 'Autoridade e posicionamento', max: 20,
      signals: [
        { code: 'trajetoria_verificavel', label: 'Trajetória profissional verificável (formação, título, registro)', points: 6 },
        { code: 'eventos_congressos', label: 'Participação em eventos e congressos', points: 5 },
        { code: 'producao_conhecimento', label: 'Produção de conhecimento (artigos, aulas, livros)', points: 5 },
        { code: 'reconhecimento', label: 'Reconhecimento profissional', points: 4 },
        { code: 'especializacao_diferencial', label: 'Especialização ou diferencial relevante', points: 4 },
      ],
    },
    {
      code: 'momento', label: 'Momento comercial', max: 15,
      signals: [
        { code: 'inauguracao_ampliacao', label: 'Inauguração ou ampliação de consultório', points: 6 },
        { code: 'novos_servicos', label: 'Lançamento de novos serviços', points: 4 },
        { code: 'expansao_equipe', label: 'Expansão da equipe', points: 3 },
        { code: 'mudanca_posicionamento', label: 'Mudança relevante de posicionamento', points: 3 },
        { code: 'interesse_comunicacao', label: 'Interesse explícito em comunicação/marketing', points: 5 },
      ],
    },
  ],
};

// Multiplicador por grau de confiabilidade da evidência.
// "verificado": fato com fonte direta; "observado": observação direta de conteúdo público;
// "indireto": fonte de terceiros; "hipotese": interpretação do agente, ainda não confirmada.
const RELIABILITY = {
  verificado: { label: 'Verificado (fonte direta)', factor: 1.0 },
  observado: { label: 'Observação direta de conteúdo público', factor: 0.9 },
  indireto: { label: 'Fonte indireta / terceiros', factor: 0.7 },
  hipotese: { label: 'Hipótese do agente (não confirmada)', factor: 0.4 },
};

const HOOK_TYPES = {
  inauguracao: 'Inauguração de consultório',
  congresso: 'Participação em congresso/evento',
  publicacao_educativa: 'Publicação educativa',
  conquista: 'Conquista profissional',
  expansao: 'Expansão de serviços',
  outro: 'Outro fato real',
};

function findSignal(definition, code) {
  for (const c of definition.criteria) {
    const s = c.signals.find((x) => x.code === code);
    if (s) return { criterion: c, signal: s };
  }
  return null;
}

module.exports = { DEFAULT_CRITERIA, RELIABILITY, HOOK_TYPES, findSignal };
