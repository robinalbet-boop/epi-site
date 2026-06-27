// api/apps-script.js — Proxy Vercel → Google Apps Script
// Évite les problèmes no-cors et double requête preflight

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwh-8UhW3rCTbrJV0n8FJUZrYdyQKiUlCTt-nNv0YJBfk-7qJcyJNsDl1po-h51-G3r/exec';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'GET') {
      // Requête GET — transmettre les query params
      const queryString = new URLSearchParams(req.query).toString();
      const url = queryString ? APPS_SCRIPT_URL + '?' + queryString : APPS_SCRIPT_URL;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        redirect: 'follow',
      });
      const text = await response.text();
      try {
        res.status(200).json(JSON.parse(text));
      } catch {
        res.status(200).send(text);
      }
    } else if (req.method === 'POST') {
      // Requête POST — transmettre le body JSON
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        redirect: 'follow',
      });
      const text = await response.text();
      try {
        res.status(200).json(JSON.parse(text));
      } catch {
        res.status(200).send(text);
      }
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('Proxy Apps Script error:', err);
    res.status(500).json({ error: err.message });
  }
}
