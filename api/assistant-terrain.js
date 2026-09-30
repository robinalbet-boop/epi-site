// api/assistant-terrain.js — Assistant Terrain IA pour EPI v2
// Avec accès live aux missions du Sheet et aux mails Gmail

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzqKY7eDpgAMEAdGXZDPuLIslYEtqb5HH_UEElGFRVBAZmm7tTNagbGPPFvrXfyqAVx/exec';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, password, message, history } = req.body || {};

  // ── Vérification mot de passe ──────────────────────────────────
  if (action === 'check_password') {
    const TERRAIN_PASSWORD = process.env.TERRAIN_PASSWORD || '';
    return res.status(200).json({ valid: password && password === TERRAIN_PASSWORD });
  }

  // ── Chat ────────────────────────────────────────────────────────
  if (action === 'chat') {
    const ANTHROPIC_KEY = process.env['CLÉ_API_ANTHROPIC'];
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Clé API Anthropic manquante' });
    if (!message) return res.status(400).json({ error: 'Message manquant' });

    // ── 1. Récupérer les missions récentes/à venir (±7 jours) ────
    let missionsContext = '';
    try {
      const mResp = await fetch(`${APPS_SCRIPT_URL}?action=getMissions`, {
        signal: AbortSignal.timeout(8000)
      });
      if (mResp.ok) {
        const missions = await mResp.json();
        if (Array.isArray(missions) && missions.length > 0) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);

          const toDate = s => {
            if (!s) return null;
            if (s.includes('/')) { const p = s.split('/'); return new Date(parseInt(p[2]), parseInt(p[1])-1, parseInt(p[0])); }
            const p = s.split('-'); return p.length === 3 ? new Date(parseInt(p[0]), parseInt(p[1])-1, parseInt(p[2])) : null;
          };

          const formatMission = m => {
            const d = toDate(m.date_rdv);
            const dateStr = d ? d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : (m.date_rdv || 'date inconnue');
            const isToday = d && d.getTime() === today.getTime();
            const isPast = d && d < today;
            const flag = isToday ? '📅 AUJOURD\'HUI' : isPast ? '✅ Passée' : '🔜 À venir';
            return `[${flag}] ${dateStr} | ${m.id} | ${m.type} | ${m.address}${m.etage ? ' étage '+m.etage : ''}${m.code_immeuble ? ' (code: '+m.code_immeuble+')' : ''} | Locataire: ${m.locataire||'NC'} | Tél: ${m.tel_locataire||'NC'} | Proprio: ${m.proprietaire||'NC'} | Client: ${m.client} | Statut: ${m.statut}${m.observations ? ' | Obs: '+m.observations.substring(0,100) : ''}`;
          };

          missionsContext = `\n## MISSIONS (±7 jours)\n${missions.map(formatMission).join('\n')}`;
        } else {
          missionsContext = '\n## MISSIONS\nAucune mission trouvée sur ±7 jours.';
        }
      }
    } catch (err) {
      missionsContext = '\n## MISSIONS\n⚠️ Impossible de récupérer les missions (timeout ou erreur).';
      console.error('getMissions error:', err.message);
    }

    // ── 2. Récupérer les mails récents si la question semble y faire référence ──
    let mailsContext = '';
    const msgLower = message.toLowerCase();
    const parleDeMails = ['mail', 'email', 'message', 'reçu', 'envoyé', 'répondu', 'confirmation', 'client a dit', 'agence a', 'locataire a'].some(k => msgLower.includes(k));

    if (parleDeMails) {
      try {
        // Extraire éventuellement un nom/adresse de la question pour cibler la recherche
        const mResp = await fetch(`${APPS_SCRIPT_URL}?action=getMails&nb=15`, {
          signal: AbortSignal.timeout(10000)
        });
        if (mResp.ok) {
          const mails = await mResp.json();
          if (Array.isArray(mails) && mails.length > 0) {
            mailsContext = `\n\n## MAILS RÉCENTS (14 derniers jours)\n` +
              mails.map((m, i) => `${i+1}. [${m.date}] De: ${m.de} | Sujet: ${m.sujet}\n   → ${m.extrait}`).join('\n\n');
          }
        }
      } catch (err) {
        console.error('getMails error:', err.message);
      }
    }

    // ── 3. Construire le system prompt avec contexte live ─────────
    const now = new Date();
    const today = now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const heure = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    const systemPrompt = `Tu es l'Assistant Terrain d'EPI (Expertises et Prestations Immobilières), une société d'expertise immobilière parisienne spécialisée dans les états des lieux.

Tu aides les techniciens terrain Julien et Jonathan au quotidien. Ils font des EDLE (entrées) et EDLS (sorties) dans toute la région parisienne.

## Date et heure actuelles
${today} — ${heure}

## Informations EPI
- Société : EPI Expertises Immobilières
- Responsable : Robin Albet (robin.albet@epi-gs.com / 06 74 07 61 24)
- Adresse : 15 rue George Sand, 75016 Paris
- Outil terrain : Nockee (app état des lieux)
- Sheet suivi missions : Google Sheet ID = 13GNBedjrSoaPrHjC8woluE_4JBhn42UDI6fzU8FKngk
- Techniciens : Julien (jmarelles@gmail.com) et Jonathan (menardjo78@gmail.com)

## Colonnes du Sheet
ID | Date création | Client | Type (EDLE/EDLS) | Type Bien | Surface | Adresse | Étage | Code Immeuble | Propriétaire | Locataire | Email Locataire | Tél Locataire | Gestionnaire | Email Gestionnaire | Mois | Date RDV | Observations | Statut | Prix | Compta

## Clients principaux
M3G, CABINET MAURICE BURGER (CMB), SOFINCAL CONSEIL, EUROPA GESTION PARISIENNE, ADUXIM, VLN, MAVILLE IMMOBILIER, DMG DAVID MARCHENOIR GESTION, PAP EDL, COMEANDWORK, AMBASSADE DU CANADA, MOVEIN
${missionsContext}${mailsContext}

## Ton rôle
- Répondre aux questions sur les missions, locataires, adresses, codes immeuble, contacts
- Expliquer les procédures d'état des lieux (EDLE, EDLS)
- Aider à rédiger des constats ou observations
- Rappeler les obligations légales (loi ALUR, délais, contradictoire)
- Gérer les situations difficiles (locataire absent, refus de signer, dégradations)
- Expliquer la différence entre dégradation imputable et vétusté
- Donner des conseils pratiques terrain

## Style de réponse
- COURT et DIRECT — tu parles à quelqu'un en déplacement, souvent depuis un téléphone
- Si une info est dans les données ci-dessus, donne-la immédiatement et précisément
- Si une info n'est pas disponible, dis-le clairement et suggère de contacter Robin
- Toujours en français`;

    // ── 4. Appel Claude ───────────────────────────────────────────
    const messages = [];
    if (history && Array.isArray(history)) {
      for (const msg of history.slice(-10)) {
        if (msg.role && msg.content) messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: 'user', content: message });

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-5',
          max_tokens: 1024,
          system: systemPrompt,
          messages,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Claude API error:', response.status, errText);
        return res.status(500).json({ error: `Erreur API Claude: ${response.status}` });
      }

      const data = await response.json();
      const reply = data.content?.[0]?.text || '';
      return res.status(200).json({ reply });

    } catch (err) {
      console.error('Fetch error:', err);
      return res.status(500).json({ error: 'Erreur de connexion à Claude' });
    }
  }

  return res.status(400).json({ error: 'Action inconnue' });
}
