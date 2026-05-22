export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const NOCKEE_API_KEY = process.env.NOCKEE_API_KEY;
  if (!NOCKEE_API_KEY) {
    return res.status(500).json({ error: 'Clé API Nockee manquante' });
  }

  // ── VÉRIFICATION CLIENT AUTORISÉ ──
  const body = req.method === 'POST' ? req.body : {};
  const query = req.query || {};
  const action = body.action || query.action;

  if (action === 'check_client') {
    const clientsRaw = process.env.CLIENTS_AUTORISES || '';
    const clients = clientsRaw.split(',').map(c => c.trim().toUpperCase());
    const nom = (body.nom || query.nom || '').trim().toUpperCase();
    const found = clients.find(c => c === nom || nom.includes(c) || c.includes(nom));
    return res.status(200).json({ autorise: !!found, nom: found || null });
  }

  const BASE_URL = 'https://api.nockee.eu/v2';

  try {
    // Routing selon l'action demandée
    const { action, search_term, inspection_report_id, source_id } = req.method === 'POST'
      ? req.body
      : req.query;

    let url, method = 'GET', body = null;

    if (action === 'search') {
      // Recherche par nom signataire ET adresse
      const params = new URLSearchParams({
        limit: '20',
        search_fields: 'signatory_name',
        search_fields: 'address',
      });
      if (search_term) params.set('search_term', search_term);
      // On ajoute les deux search_fields manuellement (URLSearchParams écrase les doublons)
      const urlStr = `${BASE_URL}/inspection_reports?limit=20&search_fields=signatory_name&search_fields=address${search_term ? '&search_term=' + encodeURIComponent(search_term) : ''}`;
      url = urlStr;

    } else if (action === 'get_report') {
      // Récupérer un rapport complet avec pièces et éléments
      url = `${BASE_URL}/inspection_reports/${inspection_report_id}?expand=rooms&expand=rooms__elements&expand=signatories&expand=keys&expand=meters`;

    } else if (action === 'compare') {
      // Comparer deux rapports via l'API Nockee native
      url = `${BASE_URL}/inspection_reports/${inspection_report_id}/compare`;
      method = 'POST';
      body = JSON.stringify({ source: { inspection_report: source_id }, output_format: 'json' });

    } else if (action === 'get_signatories') {
      url = `${BASE_URL}/inspection_report_signatories?inspection_report=${inspection_report_id}`;

    } else if (action === 'create_report') {
      // Créer un rapport depuis le formulaire client
      const { type, scheduled_at, display_name, address, proprietaire, locataire, email_locataire, observations, client } = req.body;

      // Parser l'adresse (format "4 rue X, 92200 Ville")
      const addrParts = (address || '').split(',');
      const line1 = (addrParts[0] || '').trim();
      const cityPart = (addrParts[1] || '').trim();
      const postalMatch = cityPart.match(/(\d{5})\s*(.*)/);
      const postalCode = postalMatch ? postalMatch[1] : '';
      const city = postalMatch ? postalMatch[2].trim() : cityPart;

      url = `${BASE_URL}/inspection_reports`;
      method = 'POST';
      body = JSON.stringify({
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
    if (body) fetchOptions.body = body;

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
