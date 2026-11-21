'use strict';
// Provedor Google Places API (New) — Text Search. API oficial e paga (há cota gratuita mensal; ver README).
// Só funciona com GOOGLE_PLACES_API_KEY configurada E com o host places.googleapis.com liberado na rede.
// STATUS: implementado, mas NÃO TESTADO contra a API real neste ambiente (sem chave). Trate como não verificado.
// Retorna apenas candidatos: nome, endereço, site e link do Maps. Não atribui sinais do ICP automaticamente,
// porque uma ficha no Maps não comprova consultório próprio, equipe ou atendimento particular.

const ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const FIELDS = 'places.displayName,places.formattedAddress,places.websiteUri,places.googleMapsUri,places.types,places.businessStatus';

function status() {
  const key = !!process.env.GOOGLE_PLACES_API_KEY;
  return {
    available: key, tested: false,
    detail: key ? 'Chave configurada. Integração ainda não validada contra a API real: revise os primeiros resultados com atenção.'
      : 'Sem GOOGLE_PLACES_API_KEY. Configure apenas após autorizar o custo (ver README).',
  };
}

async function search({ query, region, maxResults = 10 }, fetchImpl = fetch) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY não configurada.');
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS },
    body: JSON.stringify({ textQuery: `${query} em ${region}`, languageCode: 'pt-BR', regionCode: 'BR', pageSize: Math.min(maxResults, 20) }),
  });
  if (!res.ok) throw new Error(`Google Places respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const today = new Date().toISOString().slice(0, 10);
  return (data.places || []).filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY').map((p) => {
    const address = p.formattedAddress || '';
    return {
      name: (p.displayName && p.displayName.text) || 'Sem nome',
      city: region.split(' - ')[0],
      website: p.websiteUri || null,
      notes: `Candidato do Google Maps para "${query}". Verificar se é profissional individual ou clínica.`,
      evidence: !p.googleMapsUri ? [] : [{
        criterion: 'geral', signal: null, reliability: 'indireto',
        description: `Ficha pública no Google Maps. Endereço: ${address}.`,
        source_name: 'Google Maps (Places API)', url: p.googleMapsUri || null, consulted_at: today, origin: 'provedor:google_places',
      }],
    };
  });
}

module.exports = { id: 'google_places', label: 'Google Maps — Places API (New)', paid: true, status, search };
