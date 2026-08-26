'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const config = require('../config');

const execFileAsync = promisify(execFile);

let accessToken = null;
let accessTokenExpiresAt = 0;

async function getAccessToken(forceRefresh = false) {
  // If we have a direct API key configured, use that instead of gcloud ADC
  if (config.vertex.apiKey) {
    return null;
  }

  if (!forceRefresh && accessToken && accessTokenExpiresAt > Date.now()) {
    return accessToken;
  }

  // Resolve gcloud binary path (either from config or auto-detected on PATH)
  const gcloudBin = config.vertex.gcloudBin || 'gcloud';

  try {
    const { stdout } = await execFileAsync(
      gcloudBin,
      ['auth', 'application-default', 'print-access-token'],
      { timeout: 30000 }
    );
    accessToken = stdout.trim();
    // Cache for 45 minutes (gcloud default tokens expire in 1 hour)
    accessTokenExpiresAt = Date.now() + (45 * 60 * 1000);
    return accessToken;
  } catch (error) {
    console.error('[auth] Failed to retrieve Application Default Credentials using gcloud:', error.message);
    throw new Error(`gcloud auth print-access-token failed: ${error.message}. Run 'gcloud auth application-default login' first.`);
  }
}

module.exports = {
  getAccessToken,
};
