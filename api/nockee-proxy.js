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
