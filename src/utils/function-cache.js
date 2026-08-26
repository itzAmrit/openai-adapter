'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FUNCTION_CALL_CONTEXT_CACHE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CACHE_FILE_PATH = path.join(os.tmpdir(), 'codex_gemini_function_call_cache.json');

const functionCallContextCache = new Map();

const loadCacheFromDisk = () => {
  try {
    if (fs.existsSync(CACHE_FILE_PATH)) {
      const content = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
      const data = JSON.parse(content);
      const now = Date.now();
      for (const [key, entry] of Object.entries(data)) {
        if (entry && entry.expiresAt > now && entry.part) {
          functionCallContextCache.set(key, entry);
        }
      }
    }
  } catch (_err) {
    // Ignore read errors gracefully
  }
};

const saveCacheToDisk = () => {
  try {
    const data = {};
    const now = Date.now();
    for (const [key, entry] of functionCallContextCache.entries()) {
      if (entry && entry.expiresAt > now) {
        data[key] = entry;
      }
    }
    const entries = Object.entries(data).sort((a, b) => b[1].expiresAt - a[1].expiresAt);
    const sliced = entries.slice(0, 5000);
    const limitedData = Object.fromEntries(sliced);
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(limitedData), 'utf8');
  } catch (_err) {
    // Ignore write errors gracefully
  }
};

// Auto-load cache on startup
loadCacheFromDisk();

const pruneExpiredContexts = () => {
  const now = Date.now();
  let changed = false;
  for (const [key, entry] of functionCallContextCache.entries()) {
    if (entry.expiresAt <= now) {
      functionCallContextCache.delete(key);
      changed = true;
    }
  }
  if (changed) {
    saveCacheToDisk();
  }
};

const cacheFunctionCallContext = (key, part) => {
  pruneExpiredContexts();
  functionCallContextCache.set(key, {
    part,
    expiresAt: Date.now() + FUNCTION_CALL_CONTEXT_CACHE_MS,
  });
  saveCacheToDisk();
};

const getFunctionCallContext = (key) => {
  const entry = functionCallContextCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    functionCallContextCache.delete(key);
    saveCacheToDisk();
    return null;
  }
  return entry.part;
};

module.exports = {
  cacheFunctionCallContext,
  getFunctionCallContext,
  _test: {
    functionCallContextCache,
    loadCacheFromDisk,
    saveCacheToDisk,
    CACHE_FILE_PATH,
  },
};
