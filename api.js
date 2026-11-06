// ============================================================
//  api.js — Friendline HTTP client (v157 Optimized)
//  Updated: premium-feed, new reactions, v157 headers
// ============================================================
const axios = require('axios');
const crypto = require('crypto');
const config = require('./config');
const logger = require('./logger');
const auth = require('./auth');
const { sleep } = require('./utils');

const APP_BUILD = String(process.env.APP_VERSION_CODE || '157');

function randomUA() {
  const arr = config.api.userAgents || [config.api.userAgent];
  return arr[Math.floor(Math.random() * arr.length)];
}

function versionHeaders() {
  return { 'x-app-build': APP_BUILD, 'x-app-version': APP_BUILD };
}

const client = axios.create({
  baseURL: config.api.baseUrl,
  timeout: config.api.timeout,
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': config.api.apiKey,
    'Accept-Encoding': 'gzip',
    Connection: 'Keep-Alive',
    'Cache-Control': 'no-cache',
  },
  validateStatus: () => true,
});

const resolved = {
  userDetails: null,
  streakStatus: null,
  streakClaim: null,
};

function classifyError(data) {
  if (!data) return null;
  if (data.code === 'ACCOUNT_BLOCKED') return 'ACCOUNT_BLOCKED';
  if (data.code === 'MESSAGE_USER_BLOCKED') return 'MESSAGE_USER_BLOCKED';
  if (data.code === 'RATE_LIMITED') return 'RATE_LIMITED';
  if (data.code === 'UPDATE_REQUIRED') return 'UPDATE_REQUIRED';
  if (data.code === 'ALREADY_FOLLOWED') return 'ALREADY_FOLLOWED';
  if (data.code === 'FOLLOWING_LIMIT_REACHED') return 'FOLLOWING_LIMIT_REACHED';
  return null;
}

function makeError(code, message) {
  const e = new Error(code + (message ? `: ${message}` : ''));
  e.code = code;
  e.message = message || code;
  return e;
}

async function rawRequest(account, method, url, { params, data } = {}) {
  const headers = { ...versionHeaders() };
  headers.Authorization = `Bearer ${await auth.getToken(account)}`;
  headers['User-Agent'] = randomUA();
  if (method.toUpperCase() === 'POST' && !headers['Idempotency-Key']) {
    headers['Idempotency-Key'] = crypto.randomUUID();
  }

  try {
    let res = await client.request({ method, url, params, data, headers });

    if (res.status === 401) {
      logger.warn(`[api] 401 on ${method} ${url} — refresh + retry`);
      try {
        const fresh = await auth.forceRefresh(account);
        res = await client.request({
          method, url, params, data,
          headers: { ...headers, Authorization: `Bearer ${fresh}` },
        });
      } catch (e) {
        logger.warn(`[api] refresh+retry failed: ${e.message}`);
      }
    }

    return { ok: true, status: res.status, data: res.data };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, data: null };
  }
}

// ------------------------------------------------------------
//  Hardcoded Endpoints
// ------------------------------------------------------------
async function getMyDetails(account) {
  const r = await rawRequest(account, 'GET', '/users/user', {
    params: { uid: account.uid, targetUid: account.uid },
  });
  return r.status === 200 ? r.data : null;
}

async function getSuggestions(account, page = 1) {
  const r = await rawRequest(account, 'GET', '/users/suggestions', {
    params: { page, uid: account.uid, filter: config.loop.filter },
  });
  if (r.status === 200 && r.data?.success) return r.data;
  const cls = classifyError(r.data);
  if (cls) throw makeError(cls, r.data?.message);
  return { success: false, users: [] };
}

// 🚨 UPDATED: Now uses /posts/premium-feed
async function getFeed(account, cursor = null, limit = 20) {
  const params = { limit };
  if (cursor) params.cursor = cursor;
  const r = await rawRequest(account, 'GET', '/posts/premium-feed', { params });
  if (r.status === 200 && r.data?.success) return r.data;
  const cls = classifyError(r.data);
  if (cls) throw makeError(cls, r.data?.message);
  throw new Error(`Feed error: ${r.status}`);
}

async function getComments(account, postId, page = 1) {
  const r = await rawRequest(account, 'GET', '/comments', {
    params: { uid: account.uid, postId, page },
  });
  if (r.status === 200 && r.data?.success) return r.data;
  return { comments: [] };
}

async function getFollowers(account) {
  const r = await rawRequest(account, 'GET', '/users/follows', {
    params: { page: 1, uid: account.uid, targetUid: account.uid, type: 'Followers' }
  });
  if (r.status === 200 && r.data?.success) return r.data.users || [];
  return [];
}

async function getFollowing(account, page = 1) {
  const r = await rawRequest(account, 'GET', '/users/follows', {
    params: { page, uid: account.uid, targetUid: account.uid, type: 'Following' }
  });
  if (r.status === 200 && r.data?.success) return r.data.users || [];
  return [];
}

async function followUser(account, targetUid) {
  const r = await rawRequest(account, 'POST', '/users/follow', {
    data: { followerUid: account.uid, followingUid: targetUid, uid: targetUid, targetUid: targetUid },
  });
  const cls = classifyError(r.data);
  if (cls === 'ALREADY_FOLLOWED') return { success: true, alreadyFollowed: true };
  if (cls) throw makeError(cls, r.data?.message);
  return r.data;
}

async function unfollowUser(account, targetUid) {
  const r = await rawRequest(account, 'POST', '/users/unfollow', {
    data: { followerUid: account.uid, followingUid: targetUid, uid: targetUid, targetUid: targetUid },
  });
  if (r.status === 200 && r.data?.success) return r.data;
  throw new Error(`Unfollow failed: ${r.data?.message || r.status}`);
}

async function sendMessage(account, receiverUid, text) {
  const r = await rawRequest(account, 'POST', '/messages/createMessage', {
    data: { mediaType: 'text', media: '', text, uid: account.uid, receiver: receiverUid },
  });
  const cls = classifyError(r.data);
  if (cls) throw makeError(cls, r.data?.message);
  if (!r.data?.success) throw new Error(`Send failed: ${r.status}`);
  return r.data;
}

// 🚨 UPDATED: Randomizes reaction
async function likePost(account, postId) {
  const reactions = ['Good', 'Love it', 'Hot'];
  const reaction = reactions[Math.floor(Math.random() * reactions.length)];
  
  const r = await rawRequest(account, 'POST', '/posts/likePost', {
    params: { postId, uid: account.uid, reaction },
    data: {},
  });
  const cls = classifyError(r.data);
  if (cls) throw makeError(cls, r.data?.message);
  if (!r.data?.success) throw new Error(`Like failed: ${r.status}`);
  return r.data;
}

// 🚨 UPDATED: Randomizes reaction
async function likeComment(account, postId, commentId) {
  const reactions = ['Good', 'Love it', 'Hot'];
  const reaction = reactions[Math.floor(Math.random() * reactions.length)];
  
  const r = await rawRequest(account, 'POST', '/comments/likeComment', {
    params: { postId, commentId, uid: account.uid, reaction },
    data: {},
  });
  const cls = classifyError(r.data);
  if (cls) throw makeError(cls, r.data?.message);
  if (!r.data?.success) throw new Error(`Comment like failed: ${r.status}`);
  return r.data;
}

async function createComment(account, postId, text) {
  const r = await rawRequest(account, 'POST', '/comments/createComment', {
    data: { text, uid: account.uid, postId, media: '', mediaType: 'text' },
  });
  const cls = classifyError(r.data);
  if (cls) throw makeError(cls, r.data?.message);
  if (!r.data?.success) throw new Error(`Comment failed: ${r.status}`);
  return r.data;
}

async function createReply(account, postId, commentId, text) {
  const r = await rawRequest(account, 'POST', '/replies/createReply', {
    data: { text, uid: account.uid, postId, commentId, media: '', mediaType: 'text' },
  });
  const cls = classifyError(r.data);
  if (cls) throw makeError(cls, r.data?.message);
  if (!r.data?.success) throw new Error(`Reply failed: ${r.status}`);
  return r.data;
}

// ------------------------------------------------------------
//  Auto Boost
// ------------------------------------------------------------
async function getActiveBoosts(account) {
  const r = await rawRequest(account, 'GET', '/coins/boosts/active');
  if (r.status === 200 && r.data?.success) return r.data.boosts || [];
  return [];
}

async function boostPost(account, postId) {
  try {
    const activeBoosts = await getActiveBoosts(account);
    const alreadyBoosted = activeBoosts.find(b => b.postId === postId);
    if (alreadyBoosted) {
      logger.info(`[api] ⚡ Post ${postId} is already actively boosted!`);
      return alreadyBoosted;
    }
  } catch (e) {}

  const tryBoost = async (useFree) => {
    const body = { boostType: 'POST', durationMinutes: 60, useFree, postId };
    const r = await rawRequest(account, 'POST', '/coins/boosts', { data: body });
    if (r.status === 200 && r.data?.success) return r.data;
    return { success: false, error: r.data?.message || `HTTP ${r.status}` };
  };

  let res = await tryBoost(true);
  if (res.success) {
    logger.success(`[api] ⚡ Free Boost applied! expires: ${res.expiresAt}`);
    return res;
  }

  res = await tryBoost(false);
  if (res.success) {
    logger.success(`[api] ⚡ Paid Boost applied! (Coins spent: ${res.coinsSpent})`);
    return res;
  }

  return null;
}

// ------------------------------------------------------------
//  Streak & Coins
// ------------------------------------------------------------
async function getStreakStatus(account) {
  const r = await rawRequest(account, 'GET', '/coins/streaks/me');
  if (r.status === 200 && r.data?.success) return r.data;
  throw new Error('Failed to fetch streak status');
}

async function claimStreak(account) {
  const r = await rawRequest(account, 'POST', '/coins/streaks/claim', { data: {} });
  if (r.status === 200 && r.data?.success) return r.data;
  throw new Error('Failed to claim streak');
}

async function getCoinsStatus(account) {
  const r = await rawRequest(account, 'GET', '/coins/me');
  if (r.status === 200 && r.data?.success) return r.data;
  throw new Error('Failed to fetch coins status');
}

async function attemptAd(account) {
  const r = await rawRequest(account, 'POST', '/coins/ads/attempt', { data: {} });
  if (r.status === 200 && r.data?.success) return r.data;
  throw new Error(r.data?.message || 'Attempt failed');
}

async function claimAdReward(account) {
  const body = {
    adUnitId: 'ca-app-pub-9340661995322548/6523313720',
    transactionId: crypto.randomUUID(),
    ssvPayload: null
  };
  const r = await rawRequest(account, 'POST', '/coins/ads/reward', { data: body });
  if (r.status === 200 && r.data?.success) return r.data;
  throw new Error(r.data?.message || 'Reward claim failed');
}

// ------------------------------------------------------------
//  Upload Image & Post
// ------------------------------------------------------------
async function uploadImage(account, imageBuffer) {
  const r = await rawRequest(account, 'POST', '/uploads/storage-token', {
    data: { kind: 'post' }
  });
  if (r.status !== 200 || !r.data?.success) throw new Error('Failed to get storage token');

  const { uploadUrl, publicUrl } = r.data;

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: imageBuffer
  });

  if (uploadRes.status !== 200) throw new Error(`Image upload failed: ${uploadRes.status}`);
  return publicUrl;
}

async function createImagePost(account, { text, mediaUrl, country, city, categoryId, subcategoryId }) {
  const body = {
    text,
    uid: account.uid,
    media: mediaUrl,
    mediaType: 'image',
    country,
    city,
    videoLink: '',
    commentPrivacy: 'ALL',
    categoryId,
    subcategoryId
  };
  return await rawRequest(account, 'POST', '/posts/createPost', { data: body });
}

module.exports = {
  rawRequest,
  getMyDetails,
  getSuggestions,
  getFeed,
  getComments,
  getFollowers,
  getFollowing,
  followUser,
  unfollowUser,
  sendMessage,
  likePost,
  likeComment,
  createComment,
  createReply,
  boostPost,
  getStreakStatus,
  claimStreak,
  getCoinsStatus,
  attemptAd,
  claimAdReward,
  uploadImage,
  createImagePost,
};