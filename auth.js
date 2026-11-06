// ============================================================
//  auth.js — Silent Token Manager (Only refreshes when online)
// ============================================================
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = path.join(__dirname, 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');

const FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyAL8AhggOf-dpGm7hND8dermSeMdCn2BNE';
const REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const tokenCache = new Map();

function decodeJwt(t) {
  try {
    return JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

function loadCacheFromDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(AUTH_FILE)) return;
    const saved = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    for (const uid of Object.keys(saved)) {
      tokenCache.set(uid, saved[uid]);
    }
  } catch (e) {
    logger.warn(`[auth] loadCacheFromDisk: ${e.message}`);
  }
}

function saveCacheToDisk() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const out = {};
    for (const [uid, v] of tokenCache.entries()) out[uid] = v;
    fs.writeFileSync(AUTH_FILE, JSON.stringify(out, null, 2));
  } catch (e) {
    logger.warn(`[auth] saveCacheToDisk: ${e.message}`);
  }
}

async function refreshFor(account) {
  const cached = tokenCache.get(account.uid) || {};
  if (cached.refreshBroken) throw new Error('refresh disabled (previous sub mismatch)');
  if (!account.refreshToken) throw new Error('no refresh token');

  logger.info(`[auth] refreshing ${account.name} (${account.email})...`);

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken,
  });

  const res = await fetch(REFRESH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'FriendlineBot/1.0',
    },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`refresh HTTP ${res.status}: ${text.slice(0, 200)}`);

  let data;
  try { data = JSON.parse(text); } catch { throw new Error('refresh: non-JSON'); }

  const newId = data.id_token || data.access_token;
  if (!newId) throw new Error('no id_token in response');

  const payload = decodeJwt(newId);
  if (payload.sub !== account.uid) {
    tokenCache.set(account.uid, { refreshBroken: true });
    saveCacheToDisk();
    throw new Error('sub mismatch');
  }

  const expiresIn = Number(data.expires_in) || 3600;
  tokenCache.set(account.uid, {
    idToken: newId,
    expiresAt: Date.now() + expiresIn * 1000,
    refreshBroken: false,
  });
  saveCacheToDisk();

  logger.success(`[auth] ✅ ${account.name} token refreshed — valid ${expiresIn}s`);
  return newId;
}

async function getToken(account) {
  const cached = tokenCache.get(account.uid);

  if (cached && cached.idToken && cached.expiresAt > Date.now() + REFRESH_MARGIN_MS) {
    return cached.idToken;
  }

  try {
    return await refreshFor(account);
  } catch (e) {
    logger.warn(`[auth] refresh failed for ${account.name}: ${e.message}`);
    if (account.authToken) {
      const raw = account.authToken.replace(/^Bearer\s+/i, '').trim();
      const payload = decodeJwt(raw);
      const exp = payload.exp ? payload.exp * 1000 : 0;
      if (exp > Date.now()) {
        logger.warn(`[auth] ${account.name} — using static AUTH_TOKEN fallback`);
        tokenCache.set(account.uid, { idToken: raw, expiresAt: exp });
        saveCacheToDisk();
        return raw;
      }
    }
    throw e;
  }
}

async function forceRefresh(account) {
  return refreshFor(account);
}

async function initAll(accounts) {
  loadCacheFromDisk();
  logger.info(`[auth] initialising ${accounts.length} account(s)...`);

  for (const account of accounts) {
    try {
      await getToken(account);
    } catch (e) {
      logger.error(`[auth] ${account.name} init failed: ${e.message}`);
    }
  }
  // 🛑 REMOVED setInterval background refreshes so bot is totally silent when offline!
}

module.exports = { initAll, getToken, forceRefresh, refreshFor };