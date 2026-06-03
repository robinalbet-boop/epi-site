export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const NOCKEE_API_KEY = process.env.NOCKEE_API_KEY;
  if (!NOCKEE_API_KEY) {
    return res.status(500).json({ error: 'Clé API Nockee manquante' });
  }

  const reqBody = req.method === 'POST' ? req.body : {};
  const query = req.query || {};
  const action = reqBody.action || query.action;

  // ── VÉRIFICATION CLIENT AUTORISÉ ──
  if (action === 'check_client') {
    const mdp = (reqBody.mdp || query.mdp || '').trim();

    // Nouvelle logique : mot de passe → organisation via CLIENTS_MAP
    // Format : "MDP1:ORG1,MDP2:ORG2"
    const clientsMap = process.env.CLIENTS_MAP || '';
    if (mdp && clientsMap) {
      const pairs = clientsMap.split(',').map(p => p.trim());
      const found = pairs.find(p => {
        const [key] = p.split(':');
        return key.trim().toUpperCase() === mdp.toUpperCase();
      });
      if (found) {
        const orgName = found.split(':').slice(1).join(':').trim();
        return res.status(200).json({ autorise: true, nom: orgName });
      }
      return res.status(200).json({ autorise: false, nom: null });
    }

    // Fallback : ancienne logique par nom (CLIENTS_AUTORISES)
    const clientsRaw = process.env.CLIENTS_AUTORISES || '';
    const clients = clientsRaw.split(',').map(c => c.trim().toUpperCase());
    const nom = (reqBody.nom || query.nom || '').trim().toUpperCase();
    const found2 = clients.find(c => c === nom || nom.includes(c) || c.includes(nom));
    return res.status(200).json({ autorise: !!found2, nom: found2 || null });
  }

  const BASE_URL = 'https://api.nockee.eu/v2';

  try {
    const search_term = reqBody.search_term || query.search_term;
    const inspection_report_id = reqBody.inspection_report_id || query.inspection_report_id;
    const source_id = reqBody.source_id || query.source_id;

    let url, method = 'GET', fetchBody = null;

    if (action === 'search') {
      url = `${BASE_URL}/inspection_reports?limit=20&search_fields=signatory_name&search_fields=address${search_term ? '&search_term=' + encodeURIComponent(search_term) : ''}`;

    } else if (action === 'get_report') {
      url = `${BASE_URL}/inspection_reports/${inspection_report_id}?expand=rooms&expand=rooms__elements&expand=signatories&expand=keys&expand=meters`;

    } else if (action === 'compare') {
      url = `${BASE_URL}/inspection_reports/${inspection_report_id}/compare`;
      method = 'POST';
      fetchBody = JSON.stringify({ source: { inspection_report: source_id }, output_format: 'json' });

    } else if (action === 'get_signatories') {
      url = `${BASE_URL}/inspection_report_signatories?inspection_report=${inspection_report_id}`;

    } else if (action === 'create_report') {
      const { type, scheduled_at, display_name, address, observations } = reqBody;
      const addrParts = (address || '').split(',');
      const line1 = (addrParts[0] || '').trim();
      const cityPart = (addrParts[1] || '').trim();
      const postalMatch = cityPart.match(/(\d{5})\s*(.*)/);
      const postalCode = postalMatch ? postalMatch[1] : '';
      const city = postalMatch ? postalMatch[2].trim() : cityPart;

      url = `${BASE_URL}/inspection_reports`;
      method = 'POST';
      fetchBody = JSON.stringify({
        type,
        scheduled_at,
        display_name,
        property: {
          address: { line_1: line1, postal_code: postalCode, city },
          type: 'flat',
        },
        observations: { owner: observations || null, tenant: null },
      });

    } else {
      return res.status(400).json({ error: 'Action inconnue' });
    }

    const fetchOptions = {
      method,
      headers: {
        'X-Api-Key': NOCKEE_API_KEY,
        'Content-Type': 'application/json',
      },
    };
    if (fetchBody) fetchOptions.body = fetchBody;

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('Nockee proxy error:', error);
    return res.status(500).json({ error: error.message });
  }
}
