'use strict';

require('dotenv').config();

const parseFallbackModels = (value) => {
  if (Array.isArray(value)) return value.map(m => String(m).trim().replace(/^google\//, '')).filter(Boolean);
  const raw = String(value || '').trim();
  if (!raw) return ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(m => String(m).trim().replace(/^google\//, '')).filter(Boolean);
    } catch (_e) {
      // Fall through
    }
  }
  return raw.split(',').map(m => String(m).trim().replace(/^google\//, '')).filter(Boolean);
};

const config = {
  port: Number(process.env.PORT || 8766),
  host: process.env.HOST || '127.0.0.1',
  debug: process.env.DEBUG === 'true' || process.env.DEBUG === '1',

  vertex: {
    project: process.env.VERTEX_PROJECT || process.env.GCP_PROJECT || '',
    location: process.env.VERTEX_LOCATION || 'global',
    model: String(process.env.VERTEX_MODEL || 'gemini-3.7-flash').replace(/^google\//, ''),
    fallbackModels: parseFallbackModels(process.env.VERTEX_FALLBACK_MODELS),
    apiKey: process.env.GEMINI_API_KEY || null,
    gcloudBin: process.env.GCLOUD_BIN || null,
  },
};

module.exports = config;
