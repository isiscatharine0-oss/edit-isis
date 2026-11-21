# Prospecção · Isis Social Media — MVP

Aplicação web para encontrar, qualificar e abordar profissionais da saúde com potencial de contratar a **Isis Social Media**.
Ela organiza evidências públicas, calcula uma pontuação explicável (0–100), separa compatibilidade de confiança,
exige duas aprovações (profissional e mensagem), registra envios manuais e conversas, e aprende com suas decisões
— sempre propondo, nunca mudando critérios sozinha.

## Como iniciar

Requisitos: **Node.js 22.5+** (nada mais; não há dependências para instalar).

```bash
npm start                    # abre em http://127.0.0.1:3000
npm test                     # testes das regras críticas
npm run seed:referencias     # cadastra os 3 perfis de referência do briefing
npm run seed:piloto          # rodada piloto: 5 profissionais reais de Salvador (fonte: Doctoralia, 21/11/2026)
npm run seed:demo            # (opcional) 3 leads FICTÍCIOS para conhecer o fluxo
npm run import -- arquivo.json  # importa uma rodada de pesquisa
```

Configuração opcional em `.env` (copie de `.env.example`): `PORT`, `DB_PATH`, `GOOGLE_PLACES_API_KEY`.
Os dados ficam em `data/isis.db` (SQLite) e persistem entre reinicializações. O arquivo não é versionado.

## Arquitetura

```
public/              Painel (HTML + CSS + JS puro, responsivo, tema claro/escuro)
src/server.js        Servidor HTTP (Node, sem framework)
src/app.js           Rotas da API JSON
src/store.js         Regras de negócio: leads, evidências, aprovações, mensagens, interações, rodadas, aprendizado, indicadores
src/scoring.js       Motor de pontuação (função pura): nota, confiança, ausências e inconsistências
src/criteria.js      Critérios do ICP v1 (pesos), graus de confiabilidade, tipos de fato para abordagem
src/messages.js      Gerador local de mensagens + validador do estilo da Isis
src/playbook.js      Roteiro de respostas (interesse, valores, "é IA?", não contatar…)
src/learning.js      Detecção de padrões → sugestões de ajuste (pesos e frases a evitar)
src/dedup.js         Normalização e detecção de duplicados (Instagram, registro, site, nome+cidade)
src/providers/       Fontes de pesquisa plugáveis (manual/JSON, Google Places, Instagram — status)
src/db.js            Esquema SQLite (node:sqlite) e transações
test/                Testes (node:test)
data/seeds/          Referências do briefing e demonstração fictícia
```

**Por que esta stack:** zero dependências e zero custo de hospedagem para começar; um único processo e um único arquivo de banco
facilitam backup e manutenção. Pesquisa, pontuação, mensagens e interface ficam em módulos separados; um novo provedor de
pesquisa é um arquivo em `src/providers/` com `status()` e `search()`. Para uso por várias pessoas ou na nuvem, o banco pode
migrar para Postgres/Supabase trocando apenas `src/db.js`.

> `node:sqlite` ainda é marcado como experimental no Node 22; o aviso é suprimido nos scripts. Está isolado em `src/db.js`.

## Decisões registradas

- **21/11/2026 — Operação sem custos.** Integrações pagas ficam bloqueadas (`allow_paid_integrations: false`) até nova autorização da Isis.
- **21/11/2026 — Por que as referências atraem:** perfis consolidados, com estrutura que aparenta comportar investimento alto. O sistema traduz isso em evidências de estrutura (consultório próprio, atendimento particular, equipe, expansão), nunca em orçamento presumido.

## Integrações — o que está disponível de verdade

| Integração | Situação | Observação |
|---|---|---|
| Cadastro manual e importação JSON | ✅ Funcional e testada | Toda evidência exige fonte; pesquisa exige URL e data de consulta. |
| Google Places API (New) | ⛔ **Bloqueada** (decisão: operar sem custos) · implementada, não testada | Requer `GOOGLE_PLACES_API_KEY` e liberação de `places.googleapis.com` na rede. É paga (há franquia mensal gratuita; confira a tabela atual do Google antes de ativar). Retorna só candidatos, sem sinais de ICP. |
| Instagram Graph API (Business Discovery) | ❌ Não implementada | Exige conta Profissional da Isis conectada via OAuth da Meta e app aprovado; só lê contas profissionais; **não busca perfis por nicho/região** e **não permite mensagem fria**. |
| Envio de mensagens | Manual | "Copiar e abrir perfil" + "Confirmar que enviei". Aprovação ≠ envio. |
| IA generativa (ex.: Claude API) para redigir | ❌ Não ativada | O MVP usa modelos locais sem custo. Ativar um provedor de IA tem custo por uso e depende da sua autorização. |
| Automação recorrente | ❌ Desativada | Frequência configurável fica registrada; o agendador vem depois da validação do piloto (fase 7). |

## Como usar

1. **Configurações** — regiões (começa em Salvador), especialidades, nota prioritária (90), nota de lead qualificado (70), prazo da retomada.
2. **Referências** — cadastre perfis que exemplificam o cliente ideal, classifique (ideal / com potencial / fora) e diga por quê.
   Registre o que observou em cada um na aba *Evidências*.
3. **Leads** — cadastre ou importe profissionais. Na ficha, adicione evidências: critério, sinal do ICP, descrição, fonte, URL,
   data de consulta e confiabilidade (*verificado*, *observado*, *indireto* ou *hipótese*). A nota é recalculada na hora.
4. **1ª aprovação** — aprovar, rejeitar (motivo obrigatório), pedir mais pesquisa ou manter em revisão.
5. **Abordagem** — escolha um fato real marcado como "referência de abordagem" e gere a mensagem. Edite, peça outra versão,
   rejeite ou **aprove (2ª aprovação)**. Mensagens com promessa, preço ou crítica ao Instagram não podem ser aprovadas.
6. **Envio** — "Copiar e abrir perfil", envie pelo Instagram e só então clique em "Confirmar que enviei".
7. **Histórico** — registre respostas, objeções, pedidos de reunião etc. O roteiro sugere a resposta, que vira rascunho
   para aprovação. "Reunião solicitada" e "quer falar com a Isis" criam ações pendentes no Painel. "Pediu para não ser contatado"
   bloqueia o contato e impede que o profissional reapareça em novas rodadas.
8. **Aprendizado** — "Analisar minhas decisões" propõe ajustes de peso (a partir de ≥ 3 decisões com o mesmo sinal) e frases a
   evitar (removidas em ≥ 2 mensagens). Ao aprovar, nasce uma nova versão dos critérios e todos os leads são repontuados;
   o histórico de versões fica guardado.
9. **Indicadores** — leads qualificados, aprovações, envios confirmados, respostas e reuniões, por período e rodada.
   Dados de demonstração ficam fora por padrão.

## Modelo de pontuação (critérios v1)

| Critério | Máx. | Sinais |
|---|---|---|
| Estrutura e solidez profissional | 35 | consultório próprio 12 · atendimento particular 8 · equipe 8 · expansão/consolidação 7 |
| Oportunidade de marketing | 30 | aparece pouco 8 · estrutura > comunicação 8 · genérico 6 · autoridade pouco demonstrada 6 · institucional 5 · sem diferenciação 5 · **marketing já estruturado −12** |
| Autoridade e posicionamento | 20 | trajetória verificável 6 · eventos 5 · produção de conhecimento 5 · reconhecimento 4 · especialização 4 |
| Momento comercial | 15 | inauguração/ampliação 6 · interesse explícito 5 · novos serviços 4 · expansão de equipe 3 · mudança de posicionamento 3 |

Cada sinal vale pontos × confiabilidade da melhor evidência (verificado 1,0 · observado 0,9 · indireto 0,7 · hipótese 0,4),
limitado ao teto do critério. A **confiança** (0–100) é calculada à parte: cobertura dos critérios por evidências sólidas,
diversidade de fontes e recência. Alertas: nota alta com marketing já estruturado, nota alta com confiança baixa,
critério sustentado só por hipóteses, momento comercial com mais de 12 meses e ausência de análise de conteúdo.

## Formato de importação

```json
{
  "run": { "label": "Rodada 1", "region": "Salvador - BA", "sources": ["Sites oficiais"], "limitations": [] },
  "leads": [{
    "name": "Dra. Nome Sobrenome", "address_as": "doutora", "specialty": "Neurologia", "city": "Salvador",
    "instagram": "@perfil", "website": "https://…", "registry": "CRM-BA 00000",
    "relevant_change": "(opcional) reabre um lead rejeitado quando houver mudança relevante documentada",
    "evidence": [{
      "criterion": "estrutura", "signal": "consultorio_proprio", "reliability": "verificado",
      "description": "O que a fonte mostra", "source_name": "Site oficial", "url": "https://…",
      "consulted_at": "2026-11-20", "fact_date": "2026-10-02",
      "hook_type": "inauguracao", "hook_text": "inaugurou o novo consultório no Itaigara"
    }]
  }]
}
```

## Segurança, LGPD e limites

- Somente dados profissionais públicos; nenhum dado de pacientes. Toda evidência guarda fonte, URL e data de consulta.
- Sem scraping, sem contornar bloqueios, sem disparos automáticos. Envio sempre manual e confirmado.
- Pedidos de não contato são respeitados e bloqueiam novas rodadas.
- Credenciais só por variável de ambiente (`.env`, fora do Git). O servidor escuta apenas em `127.0.0.1` por padrão.
- Ações importantes ficam no `audit_log`.
- Dados fictícios são marcados (`is_demo`), sinalizados na interface e excluídos dos indicadores.

## Piloto (21/11/2026)

`data/piloto/piloto-salvador-2026-11-21.json`: 5 profissionais reais de Salvador, todos com evidências de perfis públicos do
Doctoralia (robots.txt consultado; leitura manual de poucas páginas, com intervalo). Limitações registradas na rodada:
Instagram não analisado (o critério de marketing depende da observação da Isis), @ e sites próprios não coletados,
telefones não registrados, seleção enviesada para perfis com destaque comercial na plataforma.

## Próximas etapas

1. Validar o piloto com 5 profissionais reais (pesquisa por fontes autorizadas e conferência da Isis).
2. Calibrar pesos com as primeiras decisões (tela Aprendizado).
3. Decidir sobre Google Places (custo) e sobre conectar a conta Profissional do Instagram (OAuth Meta).
4. Opcional: redação com IA generativa, mediante aprovação de custo.
5. Só então: agendador de rodadas recorrentes e meta de até 20 leads/semana.
