export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLE_API_ANTHROPIC;
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'Clé API Anthropic manquante' });
  }

  try {
    const body = req.body;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: body.model || 'claude-opus-4-5',
        max_tokens: body.max_tokens || 4000,
        messages: body.messages,
        system: body.system,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    // Nettoyer le JSON si la réponse contient des balises markdown
    if (data.content && data.content[0] && data.content[0].type === 'text') {
      let text = data.content[0].text;
      // Supprimer les balises ```json et ```
      const cleaned = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      // Si ça ressemble à du JSON, le remplacer
      if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
        data.content[0].text = cleaned;
      }
    }

    return res.status(200).json(data);

  } catch (error) {
    console.error('Claude proxy error:', error);
    return res.status(500).json({ error: error.message });
  }
}
