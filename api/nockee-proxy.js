export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const NOCKEE_API_KEY = process.env['CLÉ_API_NOCKEE'] || process.env.NOCKEE_API_KEY || process.env.CLE_API_NOCKEE;
  if (!NOCKEE_API_KEY) return res.status(500).json({ error: 'Clé API Nockee manquante' });

  const reqBody = req.method === 'POST' ? req.body : {};
  const query = req.query || {};
  const action = reqBody.action || query.action;

  // ── VÉRIFICATION CLIENT AUTORISÉ ──
  if (action === 'check_client') {
    const mdp = (reqBody.mdp || query.mdp || '').trim();
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

    } else if (action === 'get_signatories') {
      url = `${BASE_URL}/inspection_report_signatories?inspection_report=${inspection_report_id}`;

    } else if (action === 'compare') {
      url = `${BASE_URL}/inspection_reports/${inspection_report_id}/compare`;
      method = 'POST';
      fetchBody = JSON.stringify({ source: { inspection_report: source_id }, output_format: 'json' });

    } else if (action === 'create_report') {
      const {
        type,
        scheduled_at,
        display_name,
        address,
        floor_number,
        surface_area,
        furnished,
        rooms_count,
        property_type,
        check_in_date,        // Date d'entrée dans les lieux (pour EDLS)
        // Locataire
        locataire_prenom,
        locataire_nom,
        locataire_email,
        locataire_tel,
        // Bailleur (personne morale = cabinet)
        bailleur_legal_name,  // Nom du cabinet ex: "ADUXIM"
        bailleur_email,
        bailleur_contact,     // Prénom Nom du gestionnaire ex: "Océane HERNEQUET"
        // Clone
        from_report_id,
      } = reqBody;

      // Parser l'adresse
      const addrMatch = (address || '').match(/^(.+?),?\s*(\d{5})\s*(.+)?$/);
      const line1 = addrMatch ? addrMatch[1].trim() : (address || '');
      const postalCode = addrMatch ? addrMatch[2] : '';
      const city = addrMatch ? (addrMatch[3] || '').trim() : '';

      // Corps du rapport
      const reportBody = {
        type: type || 'residential_lease_check_in',
        scheduled_at: scheduled_at || null,
        display_name: display_name || null,
        property: {
          address: {
            line_1: line1,
            postal_code: postalCode,
            city: city,
            floor_number: floor_number ? parseInt(floor_number) : null,
          },
          type: property_type || 'flat',
          surface_area: surface_area ? parseFloat(surface_area) : null,
          furnished: furnished === true || furnished === 'true',
          rooms_count: rooms_count ? parseInt(rooms_count) : null,
        },
      };

      // Date d'entrée (uniquement pour EDLS)
      if (check_in_date && type === 'residential_lease_check_out') {
        reportBody.check_in_date = check_in_date;
      }

      // Clone depuis rapport précédent
      if (from_report_id) {
        reportBody.from_inspection_report = {
          inspection_report: from_report_id,
          options: {
            ignore_tenant_signatories: true,
            ignore_element_states: true,
            ignore_element_defects: true,
            ignore_element_comments: true,
            ignore_element_pictures: true,
            ignore_global_pictures: true,
          }
        };
      }

      // Créer le rapport
      const reportRes = await fetch(`${BASE_URL}/inspection_reports`, {
        method: 'POST',
        headers: { 'X-Api-Key': NOCKEE_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(reportBody),
      });
      const reportData = await reportRes.json();
      if (!reportRes.ok) return res.status(reportRes.status).json(reportData);

      const reportId = reportData.id;

      // Signataires
      const signataires = [];

      // 1. Locataire
      if (locataire_nom || locataire_email) {
        signataires.push({
          type: 'tenant',
          first_name: locataire_prenom || '',
          last_name: locataire_nom || '',
          email: locataire_email || null,
          phone: locataire_tel || null,
        });
      }

      // 2. Bailleur — personne morale (cabinet)
      if (bailleur_legal_name || bailleur_email) {
        const bailleurSig = {
          type: 'owner',
          legal_name: bailleur_legal_name || '',
          email: bailleur_email || null,
        };
        // Ajouter le contact gestionnaire si disponible
        if (bailleur_contact) {
          const parts = bailleur_contact.trim().split(' ');
          bailleurSig.first_name = parts[0] || '';
          bailleurSig.last_name = parts.slice(1).join(' ') || '';
        }
        signataires.push(bailleurSig);
      }

      // 3. Mandataire EPI (toujours avec edl@epi-gs.com)
      signataires.push({
        type: 'property_manager',
        legal_name: 'EPI Expertises Immobilières',
        first_name: 'Robin',
        last_name: 'ALBET',
        email: 'edl@epi-gs.com',
      });

      // Créer tous les signataires
      const sigResults = await Promise.allSettled(
        signataires.map(sig =>
          fetch(`${BASE_URL}/inspection_report_signatories`, {
            method: 'POST',
            headers: { 'X-Api-Key': NOCKEE_API_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...sig, inspection_report: reportId }),
          }).then(r => r.json())
        )
      );

      return res.status(200).json({
        success: true,
        report: reportData,
        signatories: sigResults.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason?.message }),
      });

    } else {
      return res.status(400).json({ error: 'Action inconnue' });
    }

    // Actions simples
    const fetchOptions = {
      method,
      headers: { 'X-Api-Key': NOCKEE_API_KEY, 'Content-Type': 'application/json' },
    };
    if (fetchBody) fetchOptions.body = fetchBody;
    const response = await fetch(url, fetchOptions);
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    return res.status(200).json(data);

  } catch (error) {
    console.error('Nockee proxy error:', error);
    return res.status(500).json({ error: error.message });
  }
}
