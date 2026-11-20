'use strict';
// Roteiro de acompanhamento das conversas (seção 10 do briefing).
// Gera apenas SUGESTÕES de resposta; toda resposta vira rascunho que precisa de aprovação e envio manual.
const { addressOf } = require('./messages');

const INTERACTION_KINDS = {
  mensagem_enviada: { label: 'Mensagem enviada (confirmada)', response: false },
  resposta_recebida: { label: 'Resposta recebida', response: true },
  interesse: { label: 'Demonstrou interesse', response: true },
  sem_tempo: { label: 'Sem tempo para gravar', response: true },
  pergunta_experiencia: { label: 'Perguntou sobre experiência', response: true },
  pedido_proposta: { label: 'Pediu proposta', response: true },
  pedido_valores: { label: 'Pediu valores', response: true },
  objecao: { label: 'Objeção', response: true },
  quer_falar_com_isis: { label: 'Quer falar diretamente com a Isis', response: true },
  pergunta_ia: { label: 'Perguntou se é IA', response: true },
  reuniao_solicitada: { label: 'Reunião solicitada', response: true },
  reuniao_agendada: { label: 'Reunião agendada (confirmada)', response: true },
  experiencia_negativa: { label: 'Experiência negativa anterior com marketing (ponto de atenção)', response: true },
  sem_resposta: { label: 'Sem resposta', response: false },
  pedido_nao_contato: { label: 'Pediu para não ser contatado', response: true },
  nota: { label: 'Anotação', response: false },
};

function suggest(kind, lead) {
  const t = addressOf(lead || {});
  switch (kind) {
    case 'interesse':
    case 'resposta_recebida':
      return {
        text: `Entendo demais, ${t}! Inclusive, é justamente com esse tipo de planejamento que trabalho: estratégia e gestão de redes pra profissionais da saúde. Acho que seria interessante conversarmos melhor sobre isso! E o que você mais gostaria de desenvolver nas suas redes hoje?`,
        notes: ['Use a transição só se houve abertura real. Resposta educada não é interesse em contratar.',
          'Máximo de duas perguntas de qualificação antes da reunião. Não pergunte orçamento.'],
        actions: [],
      };
    case 'sem_tempo':
      return {
        text: `Super entendo, a rotina de consultório é corrida. Uma coisa que funciona bem é organizar as gravações em blocos: a gente planeja tudo antes e você grava de uma vez, com participação periódica, sem precisar parar a agenda toda semana.`,
        notes: ['Não prometa que o profissional não precisará aparecer: a participação periódica é parte do serviço.'],
        actions: [],
      };
    case 'pergunta_experiencia':
      return {
        text: `Claro! Trabalho com estratégia, planejamento e gestão de redes, com foco em posicionamento e autoridade. [Cite aqui apenas trabalhos e experiências que você pode comprovar.]`,
        notes: ['Preencha somente com cases reais e comprováveis. O sistema não inventa experiências.'],
        actions: [{ type: 'preencher', message: 'Inserir experiências reais antes de aprovar.' }],
        requires_edit: true,
      };
    case 'pedido_proposta':
      return {
        text: `Com certeza! Pra montar algo que faça sentido de verdade pra você, eu gosto de entender antes seus objetivos e o momento do consultório. Podemos marcar uma conversa rápida?`,
        notes: ['Não envie proposta sem entender os objetivos.'],
        actions: [],
      };
    case 'pedido_valores':
      return {
        text: `O investimento depende do escopo, porque cada trabalho é montado de acordo com os objetivos e a participação de cada profissional. Numa conversa rápida eu entendo o que você precisa e te passo algo bem alinhado. Pode ser?`,
        notes: ['Não informe preços específicos nem condições sem decisão da Isis.'],
        actions: [],
      };
    case 'objecao':
    case 'experiencia_negativa':
      return {
        text: `Entendo totalmente, e obrigada por compartilhar. Fico à disposição se em algum momento fizer sentido conversar.`,
        notes: ['Acolha e registre. Sem insistência nem negociação não autorizada.',
          kind === 'experiencia_negativa' ? 'Experiência negativa é ponto de atenção, não exclusão automática.' : null].filter(Boolean),
        actions: [],
      };
    case 'quer_falar_com_isis':
      return {
        text: `Claro! Vou te responder pessoalmente por aqui.`,
        notes: ['Isis: assuma a conversa pessoalmente. O histórico está na ficha do lead.'],
        actions: [{ type: 'notificar_isis', message: 'O profissional pediu para falar diretamente com você.' }],
      };
    case 'pergunta_ia':
      return {
        text: `Boa pergunta! As mensagens são enviadas por mim, Isis, mas uso uma ferramenta de inteligência artificial para me ajudar a organizar e redigir. A conversa e as decisões são sempre comigo.`,
        notes: ['Responda com transparência. Nunca finja que não há uso de IA.'],
        actions: [],
      };
    case 'reuniao_solicitada':
      return {
        text: `Que ótimo! Vou ver minha agenda e já te passo algumas opções de horário.`,
        notes: ['Consulte sua disponibilidade real antes de sugerir horários. O sistema não sugere horários.'],
        actions: [{ type: 'notificar_isis', message: 'Reunião solicitada: consulte sua agenda real e responda com horários.' }],
      };
    case 'sem_resposta':
      return {
        text: null,
        notes: ['É permitida no máximo uma retomada contextual, após alguns dias, com aprovação. Gere em "Nova retomada".'],
        actions: [],
      };
    case 'pedido_nao_contato':
      return {
        text: `Tudo bem, obrigada pelo retorno! Não vou mais te enviar mensagens. Sucesso no consultório!`,
        notes: ['O contato foi bloqueado no sistema. Envie no máximo esta confirmação, se quiser.'],
        actions: [{ type: 'bloquear', message: 'Contato bloqueado.' }],
      };
    default:
      return { text: null, notes: [], actions: [] };
  }
}

module.exports = { INTERACTION_KINDS, suggest };
