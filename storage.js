// ============================================================
//  storage.js — all persistence
// ============================================================
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');

function ensureFile(filePath, defaultContent) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultContent, null, 2), 'utf8');
  }
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function loadJson(file, defaultVal) {
  ensureFile(file, defaultVal);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) || defaultVal;
  } catch {
    return defaultVal;
  }
}

function saveJson(file, data) {
  try {
    ensureFile(file, Array.isArray(data) ? [] : {});
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    logger.error(`save ${path.basename(file)} failed`, { err: e.message });
  }
}

// ------------------------------------------------------------
//  Simple UID sets (followed, messaged, liked_posts, ...)
// ------------------------------------------------------------
function makeTracker(file) {
  return {
    load: () => loadJson(file, {}),
    has: (uid) => Boolean(loadJson(file, {})[uid]),
    add: (uid, info = {}) => {
      const d = loadJson(file, {});
      d[uid] = { at: new Date().toISOString(), ...info };
      saveJson(file, d);
    },
    count: () => Object.keys(loadJson(file, {})).length,
  };
}

const followed = makeTracker(config.storage.followedFile);
const messaged = makeTracker(config.storage.messagedFile);
const likedPosts = makeTracker(config.storage.likedPostsFile);
const commentedPosts = makeTracker(config.storage.commentedPostsFile);
const likedComments = makeTracker(config.storage.likedCommentsFile);
const repliedComments = makeTracker(config.storage.repliedCommentsFile);

// ------------------------------------------------------------
//  Pending DMs
// ------------------------------------------------------------
function getPendingDMs() {
  const f = followed.load();
  const m = messaged.load();
  const pending = [];
  for (const [uid, info] of Object.entries(f)) {
    if (!m[uid]) pending.push({ uid, ...info });
  }
  return pending;
}

// ------------------------------------------------------------
//  Daily counters
// ------------------------------------------------------------
const DEFAULT_DAILY = {
  date: todayUTC(),
  follows: 0,
  messages: 0,
  postLikes: 0,
  comments: 0,
  commentLikes: 0,
  replies: 0,
};

function loadDaily() {
  const file = config.storage.dailyFile;
  ensureFile(file, DEFAULT_DAILY);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
    if (!data.date) data.date = todayUTC();
    for (const k of Object.keys(DEFAULT_DAILY)) {
      if (k === 'date') continue;
      if (typeof data[k] !== 'number') data[k] = 0;
    }
    return data;
  } catch {
    return { ...DEFAULT_DAILY };
  }
}

function saveDaily(data) {
  try {
    ensureFile(config.storage.dailyFile, DEFAULT_DAILY);
    fs.writeFileSync(config.storage.dailyFile, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    logger.error('saveDaily failed', { err: e.message });
  }
}

function resetDailyIfNewDay() {
  const data = loadDaily();
  if (data.date !== todayUTC()) {
    logger.info(`📅 New day — resetting counters (was ${data.date})`);
    saveDaily({ ...DEFAULT_DAILY, date: todayUTC() });
    return true;
  }
  return false;
}

function incField(field) {
  resetDailyIfNewDay();
  const data = loadDaily();
  data[field] = (data[field] || 0) + 1;
  saveDaily(data);
  return data[field];
}

function getField(field) {
  resetDailyIfNewDay();
  return loadDaily()[field] || 0;
}

module.exports = {
  // Trackers
  followed, messaged, likedPosts, commentedPosts, likedComments, repliedComments,
  wasFollowed: followed.has,
  markFollowed: followed.add,
  followedCount: followed.count,
  wasMessaged: messaged.has,
  markMessaged: messaged.add,
  messagedCount: messaged.count,
  wasPostLiked: likedPosts.has,
  markPostLiked: likedPosts.add,
  wasPostCommented: commentedPosts.has,
  markPostCommented: commentedPosts.add,
  wasCommentLiked: likedComments.has,
  markCommentLiked: likedComments.add,
  wasCommentReplied: repliedComments.has,
  markCommentReplied: repliedComments.add,
  // Pending
  getPendingDMs,
  // Daily
  resetDailyIfNewDay,
  todayUTC,
  getField,
  incField,
  loadDaily,
};