// ============================================================
//  followbot.js — follow + unfollow + warm-up + DM + engagement
//  FIX: Randomized task selection + 5s pause (Fast Mode)
// ============================================================
const config = require('./config');
const logger = require('./logger');
const api = require('./api');
const storage = require('./storage');
const { sleep, uniqBy, hms } = require('./utils');

const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;

let botUid = null;
const cooldowns = { follow: 0, unfollow: 0, message: 0, like: 0, commentLike: 0, comment: 0, reply: 0, followBack: 0 };
const hourly = { follows: [], messages: [] };
const failCounts = { follow: 0, unfollow: 0, message: 0, like: 0, commentLike: 0, comment: 0, reply: 0, followBack: 0 };
const blockCooldowns = { follow: 0, unfollow: 0, message: 0, like: 0, commentLike: 0, comment: 0, reply: 0, followBack: 0 };
const pendingQueue = [];
let globalCooldownUntil = 0;

function pruneHourly(arr) { return arr.filter((t) => t > Date.now() - ONE_HOUR); }
function hourlyCount(arr) { return pruneHourly(arr).length; }
function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function isActiveHours() {
  if (!config.loop.activeHoursPkt || config.loop.activeHoursPkt.length === 0) return true;
  const pktHour = (new Date().getUTCHours() + 5) % 24;
  return config.loop.activeHoursPkt.includes(pktHour);
}

function canFollow() {
  if (!isActiveHours()) return false;
  if (Date.now() < cooldowns.follow) return false;
  if (Date.now() < blockCooldowns.follow) return false;
  if (hourlyCount(hourly.follows) >= config.loop.maxFollowsPerHour) return false;
  if (storage.getField('follows') >= config.loop.followsPerDay) return false;
  return true;
}
function canFollowBack() {
  if (!isActiveHours()) return false;
  if (Date.now() < cooldowns.followBack) return false;
  if (Date.now() < blockCooldowns.followBack) return false;
  if (storage.getField('follows') >= config.loop.followsPerDay) return false;
  return true;
}
function canUnfollow() {
  if (!isActiveHours()) return false;
  if (Date.now() < cooldowns.unfollow) return false;
  if (Date.now() < blockCooldowns.unfollow) return false;
  if (storage.getField('unfollows') >= config.loop.unfollowsPerDay) return false;
  return true;
}
function canMessage() {
  if (!isActiveHours()) return false;
  if (Date.now() < cooldowns.message) return false;
  if (Date.now() < blockCooldowns.message) return false;
  if (hourlyCount(hourly.messages) >= config.loop.maxMessagesPerHour) return false;
  if (storage.getField('messages') >= config.loop.newConversationsPerDay) return false;
  return true;
}
function canLikePost() {
  if (!isActiveHours()) return false;
  if (Date.now() < cooldowns.like) return false;
  if (Date.now() < blockCooldowns.like) return false;
  if (storage.getField('postLikes') >= config.loop.postLikesPerDay) return false;
  return true;
}
function canLikeComment() {
  if (!isActiveHours()) return false;
  if (Date.now() < cooldowns.commentLike) return false;
  if (Date.now() < blockCooldowns.commentLike) return false;
  if (storage.getField('commentLikes') >= config.loop.commentLikesPerDay) return false;
  return true;
}
function canComment() {
  if (!isActiveHours()) return false;
  if (Date.now() < cooldowns.comment) return false;
  if (Date.now() < blockCooldowns.comment) return false;
  if (storage.getField('comments') >= config.loop.commentsPerDay) return false;
  return true;
}
function canReply() {
  if (!isActiveHours()) return false;
  if (Date.now() < cooldowns.reply) return false;
  if (Date.now() < blockCooldowns.reply) return false;
  if (storage.getField('replies') >= config.loop.repliesPerDay) return false;
  return true;
}

function allQuotasHit() {
  return (
    storage.getField('follows') >= config.loop.followsPerDay &&
    storage.getField('unfollows') >= config.loop.unfollowsPerDay &&
    storage.getField('messages') >= config.loop.newConversationsPerDay &&
    storage.getField('postLikes') >= config.loop.postLikesPerDay &&
    storage.getField('commentLikes') >= config.loop.commentLikesPerDay &&
    storage.getField('comments') >= config.loop.commentsPerDay &&
    storage.getField('replies') >= config.loop.repliesPerDay
  );
}

function setCooldown(action, ms, reason) {
  cooldowns[action] = Date.now() + ms;
  logger.warn(`⏳ ${action} cooldown ${hms(ms)} — ${reason}`);
}
function setBlock(action, ms, reason) {
  blockCooldowns[action] = Date.now() + ms;
  logger.error(`⛔ ${action} BLOCKED ${hms(ms)} — ${reason}`);
}
function handleError(action, e) {
  failCounts[action]++;
  const msg = String(e.message || e.code || 'unknown');

  if (
    msg.includes('503') || msg.includes('502') || msg.includes('500') || 
    msg.includes('Feed error') && msg.includes('50') ||
    msg.includes('Network Error') || msg.includes('timeout')
  ) {
    if (Date.now() > globalCooldownUntil) {
      globalCooldownUntil = Date.now() + 15 * 60 * 1000;
      logger.warn(`🚨 Server outage detected (503). Sleeping GLOBALLY for 15 minutes...`);
    }
    return;
  }

  if (msg.includes('You can only comment 2 times on this post')) return;
  if (msg.includes('Hourly comment limit') || msg.includes('30/hour')) {
    setCooldown(action, 30 * 60 * 1000, `Hourly limit reached — sleeping 30m`);
    return;
  }
  if (e.code === 'ACCOUNT_BLOCKED') { setBlock(action, ONE_DAY, `ACCOUNT_BLOCKED: ${msg}`); return; }
  if (e.code === 'MESSAGE_USER_BLOCKED') { setBlock(action, config.cooldowns.userBlock, `MESSAGE_USER_BLOCKED: ${msg}`); return; }
  if (e.code === 'RATE_LIMITED') {
    if (failCounts[action] >= 3) setBlock(action, config.cooldowns.userBlock, `3× RATE_LIMITED: ${msg}`);
    else setCooldown(action, config.cooldowns.rateLimit, `RATE_LIMITED: ${msg}`);
    return;
  }
  if (e.code === 'FOLLOWING_LIMIT_REACHED') { setBlock(action, config.cooldowns.userBlock, `Following limit reached`); return; }
  setCooldown(action, 60_000, `error: ${msg}`);
}
function onSuccess(action) { failCounts[action] = 0; }

async function doFollowBack(account) {
  if (!config.loop.followBackEnabled) return false;
  if (Date.now() < cooldowns.followBack) return false;

  let followers;
  try {
    followers = await api.getFollowers(account);
  } catch (e) {
    handleError('followBack', e);
    return false;
  }

  if (!followers || !followers.length) {
    cooldowns.followBack = Date.now() + config.loop.followBackCheckMs;
    return false;
  }

  const targetUser = followers.find(u => 
    u.uid !== botUid && 
    u.isFollowed === false && 
    !storage.wasFollowed(u.uid)
  );

  if (!targetUser) {
    cooldowns.followBack = Date.now() + config.loop.followBackCheckMs;
    return false;
  }

  const targetUid = targetUser.uid;
  const label = targetUser.username ? `@${targetUser.username}` : targetUid;

  try {
    await api.followUser(account, targetUid);
    storage.markFollowed(targetUid, { name: targetUser.name, username: targetUser.username });
    storage.incField('follows');
    hourly.follows.push(Date.now());
    onSuccess('followBack');
    // 🛑 FIX: Add 15 min cooldown so it doesn't get stuck on follow-backs
    cooldowns.followBack = Date.now() + 15 * 60 * 1000; 
    
    logger.success(`followBack: ✓ Followed back ${label} | ${storage.getField('follows')}/${config.loop.followsPerDay} today`);
    return true;
  } catch (e) {
    if (e.code === 'ALREADY_FOLLOWED') {
      storage.markFollowed(targetUid, { name: targetUser.name, username: targetUser.username });
    }
    handleError('followBack', e);
    cooldowns.followBack = Date.now() + 5000;
    return false;
  }
}

async function doUnfollow(account) {
  if (!config.loop.unfollowsPerDay || config.loop.unfollowsPerDay === 0) return false;
  
  let following;
  try {
    following = await api.getFollowing(account);
  } catch (e) {
    handleError('unfollow', e);
    return false;
  }

  if (!following || !following.length) {
    cooldowns.unfollow = Date.now() + 5 * 60 * 1000;
    return false;
  }

  const target = following[following.length - 1];
  const label = target.username ? `@${target.username}` : target.uid;

  try {
    await api.unfollowUser(account, target.uid);
    const dayCount = storage.incField('unfollows');
    onSuccess('unfollow');
    cooldowns.unfollow = Date.now() + config.loop.unfollowCooldownMs;
    logger.success(`unfollow: ⊘ Unfollowed ${label} (oldest) | ${dayCount}/${config.loop.unfollowsPerDay} today`);
    return true;
  } catch (e) {
    handleError('unfollow', e);
    return false;
  }
}

async function fetchSuggestions(account) {
  const all = [];
  for (let page = 1; page <= config.loop.maxPages; page++) {
    const res = await api.getSuggestions(account, page);
    const users = Array.isArray(res?.users) ? res.users : [];
    if (!users.length) break;
    all.push(...users);
    if (users.length < (res.limit || 20)) break;
    await sleep(config.loop.delayBetweenPagesMs);
  }
  return uniqBy(all, (u) => u.uid).filter((u) => {
    if (!u || !u.uid) return false;
    if (u.uid === botUid) return false;
    if (u.isFollowed === true) return false;
    if (storage.wasFollowed(u.uid)) return false;
    return true;
  });
}

async function doFollow(account) {
  let targets;
  try { targets = await fetchSuggestions(account); } 
  catch (e) { handleError('follow', e); return false; }
  
  if (!targets.length) {
    logger.info('follow: no new targets');
    cooldowns.follow = Date.now() + 5 * 60 * 1000;
    return false;
  }
  const target = targets[0];
  const label = target.username ? `@${target.username}` : target.uid;
  try {
    const res = await api.followUser(account, target.uid);
    storage.markFollowed(target.uid, { name: target.name, username: target.username });
    const dayCount = storage.incField('follows');
    hourly.follows.push(Date.now());
    onSuccess('follow');
    cooldowns.follow = Date.now() + config.loop.delayBetweenFollowsMs;

    if (res.alreadyFollowed) {
      logger.info(`follow: ⊘ already following ${label}`);
    } else {
      logger.success(`follow: ✓ ${label} | ${dayCount}/${config.loop.followsPerDay} today`);
      pendingQueue.push({
        uid: target.uid, name: target.name, username: target.username,
        followedAt: Date.now(), warmupDone: false, postId: null,
      });
    }
    return true;
  } catch (e) { handleError('follow', e); return false; }
}

async function doWarmup(account) {
  if (!config.loop.warmupEnabled) return false;
  const now = Date.now();
  const ready = pendingQueue.find((p) => !p.warmupDone && now - p.followedAt >= config.loop.delayBeforeWarmupMs);
  if (!ready) return false;

  const label = ready.username ? `@${ready.username}` : ready.uid;
  let post = null;
  try {
    const feed = await api.getFeed(account, null, 50);
    post = (feed.posts || []).find((p) => p.uid === ready.uid);
  } catch (e) {
    handleError('like', e);
    return false; 
  }

  if (!post || !post.postId) {
    ready.warmupDone = true;
    logger.info(`warmup: ${label} — no recent post — skipping`);
    return true;
  }
  ready.postId = post.postId;

  if (canLikePost() && !post.isLiked && !storage.wasPostLiked(post.postId)) {
    try {
      await api.likePost(account, post.postId);
      storage.markPostLiked(post.postId, { uid: ready.uid });
      storage.incField('postLikes');
      onSuccess('like');
      cooldowns.like = Date.now() + config.loop.likeCooldownMs;
      logger.success(`warmup: ❤ liked ${label}'s post`);
    } catch (e) { handleError('like', e); }
    await sleep(4000);
  }

  if (canComment() && !storage.wasPostCommented(post.postId)) {
    const text = pickRandom(config.comments.texts);
    try {
      const res = await api.createComment(account, post.postId, text);
      storage.markPostCommented(post.postId, { uid: ready.uid, commentId: res.comment?.commentId, text });
      storage.incField('comments');
      onSuccess('comment');
      cooldowns.comment = Date.now() + config.loop.commentCooldownMs;
      logger.success(`warmup: 💬 commented on ${label}'s post`);
    } catch (e) { 
      handleError('comment', e); 
      if (e.message && e.message.includes('You can only comment 2 times on this post')) {
          storage.markPostCommented(post.postId, { uid: ready.uid, text: 'LIMIT_REACHED' });
          cooldowns.comment = Date.now() + 2000;
      }
    }
  }
  ready.warmupDone = true;
  return true;
}

async function doSendDM(account) {
  const now = Date.now();
  const ready = pendingQueue.find((p) => p.warmupDone && now - p.followedAt >= config.loop.delayBeforeDMms);
  if (!ready) return false;

  const label = ready.username ? `@${ready.username}` : ready.uid;
  const text = pickRandom(config.message.texts);

  try {
    await api.sendMessage(account, ready.uid, text);
    storage.markMessaged(ready.uid, { name: ready.name, username: ready.username });
    const dayCount = storage.incField('messages');
    hourly.messages.push(Date.now());
    onSuccess('message');
    cooldowns.message = Date.now() + config.loop.delayBetweenMessagesMs;

    const idx = pendingQueue.indexOf(ready);
    if (idx >= 0) pendingQueue.splice(idx, 1);

    logger.success(`message: ✉ ${label} | "${text.slice(0, 40)}..." | ${dayCount}/${config.loop.newConversationsPerDay} today`);
    return true;
  } catch (e) {
    handleError('message', e);
    if (e.code === 'MESSAGE_USER_BLOCKED' || e.code === 'USER_BLOCKED_MESSAGES') {
      storage.markMessaged(ready.uid, { name: ready.name, username: ready.username });
      const idx = pendingQueue.indexOf(ready);
      if (idx >= 0) pendingQueue.splice(idx, 1);
    }
    return false;
  }
}

async function doLikePost(account) {
  let feed;
  try { feed = await api.getFeed(account, null, 20); } 
  catch (e) { handleError('like', e); return false; }
  
  const posts = (feed.posts || []).filter((p) => p.postId && !p.isLiked && !storage.wasPostLiked(p.postId));
  if (!posts.length) {
    cooldowns.like = Date.now() + 5 * 60 * 1000;
    return false;
  }
  const post = posts[0];
  const label = post.username ? `@${post.username}` : post.uid;
  try {
    await api.likePost(account, post.postId);
    storage.markPostLiked(post.postId, { uid: post.uid });
    const dayCount = storage.incField('postLikes');
    onSuccess('like');
    cooldowns.like = Date.now() + config.loop.likeCooldownMs;
    logger.success(`like: ❤ ${label}'s post | ${dayCount}/${config.loop.postLikesPerDay} today`);
    return true;
  } catch (e) { handleError('like', e); return false; }
}

async function doLikeComment(account) {
  let feed;
  try { feed = await api.getFeed(account, null, 20); } 
  catch (e) { handleError('commentLike', e); return false; }
  
  const posts = (feed.posts || []).filter((p) => p.postId && (p.commentCount || 0) > 0);
  if (!posts.length) {
    cooldowns.commentLike = Date.now() + 5 * 60 * 1000;
    return false;
  }
  const post = pickRandom(posts);
  let commentsRes;
  try { commentsRes = await api.getComments(account, post.postId, 1); } 
  catch (e) { handleError('commentLike', e); return false; }
  
  const comments = (commentsRes.comments || []).filter((c) => {
    const cid = c.commentId || c.id;
    return cid && c.uid !== botUid && !c.isLiked && !storage.wasCommentLiked(cid);
  });
  if (!comments.length) {
    cooldowns.commentLike = Date.now() + 60 * 1000;
    return false;
  }
  const comment = comments[0];
  const commentId = comment.commentId || comment.id;
  const label = comment.username ? `@${comment.username}` : comment.uid;
  try {
    await api.likeComment(account, post.postId, commentId);
    storage.markCommentLiked(commentId, { postId: post.postId, uid: comment.uid });
    const dayCount = storage.incField('commentLikes');
    onSuccess('commentLike');
    cooldowns.commentLike = Date.now() + config.loop.commentLikeCooldownMs;
    logger.success(`commentLike: ❤ ${label}'s comment | ${dayCount}/${config.loop.commentLikesPerDay} today`);
    return true;
  } catch (e) { handleError('commentLike', e); return false; }
}

async function doComment(account) {
  let feed;
  try { feed = await api.getFeed(account, null, 20); } 
  catch (e) { handleError('comment', e); return false; }
  
  const posts = (feed.posts || []).filter((p) => p.postId && p.uid !== botUid && !storage.wasPostCommented(p.postId));
  if (!posts.length) {
    cooldowns.comment = Date.now() + 5 * 60 * 1000;
    return false;
  }
  const post = posts[0];
  const label = post.username ? `@${post.username}` : post.uid;
  const text = pickRandom(config.comments.texts);
  try {
    const res = await api.createComment(account, post.postId, text);
    storage.markPostCommented(post.postId, { uid: post.uid, commentId: res.comment?.commentId, text });
    const dayCount = storage.incField('comments');
    onSuccess('comment');
    cooldowns.comment = Date.now() + config.loop.commentCooldownMs;
    logger.success(`comment: 💬 on ${label}'s post | ${dayCount}/${config.loop.commentsPerDay} today`);
    return true;
  } catch (e) { 
    handleError('comment', e); 
    if (e.message && e.message.includes('You can only comment 2 times on this post')) {
        storage.markPostCommented(post.postId, { uid: post.uid, text: 'LIMIT_REACHED' });
        cooldowns.comment = Date.now() + 2000; 
    }
    return false; 
  }
}

async function doReply(account) {
  let feed;
  try { feed = await api.getFeed(account, null, 20); } 
  catch (e) { handleError('reply', e); return false; }
  
  const posts = (feed.posts || []).filter((p) => p.postId && (p.commentCount || 0) > 0);
  if (!posts.length) {
    cooldowns.reply = Date.now() + 5 * 60 * 1000;
    return false;
  }
  const post = pickRandom(posts);
  let commentsRes;
  try { commentsRes = await api.getComments(account, post.postId, 1); } 
  catch (e) { handleError('reply', e); return false; }
  
  const comments = (commentsRes.comments || []).filter((c) => {
    const cid = c.commentId || c.id;
    return cid && c.uid !== botUid && !storage.wasCommentReplied(cid);
  });
  if (!comments.length) {
    cooldowns.reply = Date.now() + 60 * 1000;
    return false;
  }
  const comment = comments[0];
  const commentId = comment.commentId || comment.id;
  const authorLabel = comment.username ? `@${comment.username}` : comment.uid;
  const text = pickRandom(config.replies.texts).replace('{{username}}', comment.username || '');
  try {
    const res = await api.createReply(account, post.postId, commentId, text);
    storage.markCommentReplied(commentId, { postId: post.postId, replyId: res.reply?.replyId });
    const dayCount = storage.incField('replies');
    onSuccess('reply');
    cooldowns.reply = Date.now() + config.loop.replyCooldownMs;
    logger.success(`reply: 💬 to ${authorLabel} | ${dayCount}/${config.loop.repliesPerDay} today`);
    return true;
  } catch (e) { 
    handleError('reply', e); 
    if (e.message && e.message.includes('You can only comment 2 times on this post')) {
        storage.markCommentReplied(commentId, { postId: post.postId, replyId: 'LIMIT_REACHED' });
        cooldowns.reply = Date.now() + 2000;
    }
    return false; 
  }
}

async function startFollowBot(accounts) {
  const account = accounts[0];
  botUid = account.uid;

  const stoppingRef = { value: false };
  const stop = (sig) => {
    if (stoppingRef.value) return;
    stoppingRef.value = true;
    logger.warn(`Received ${sig} — stopping...`);
    setTimeout(() => process.exit(0), 2000);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  logger.raw('');
  logger.info('════════════════════════════════════════════════════════');
  logger.info('  FRIENDLINE FULL ENGAGEMENT BOT');
  logger.info(`  Account         : ${account.name} (${account.email})`);
  logger.info(`  UID             : ${account.uid}`);
  logger.info(`  Quotas/day      : follows=${config.loop.followsPerDay} unfollows=${config.loop.unfollowsPerDay} messages=${config.loop.newConversationsPerDay}`);
  logger.info(`                    likes=${config.loop.postLikesPerDay} commentLikes=${config.loop.commentLikesPerDay}`);
  logger.info(`                    comments=${config.loop.commentsPerDay} replies=${config.loop.repliesPerDay}`);
  logger.info(`  Follow-Back     : ${config.loop.followBackEnabled ? 'ENABLED (30s check)' : 'DISABLED'}`);
  logger.info(`  Active Hours PKT: ${config.loop.activeHoursPkt ? config.loop.activeHoursPkt.join(', ') : '24/7'}`);
  logger.info('════════════════════════════════════════════════════════');
  logger.raw('');

  try {
    const me = await api.getMyDetails(account);
    const u = me?.user || me;
    if (u && u.uid) {
      logger.success(`🔑 ${account.name} → "${u.name}" @${u.username} (follower=${u.followerCount ?? 0} following=${u.followingCount ?? 0})`);
    }
  } catch (e) {
    logger.warn(`Pre-check failed: ${e.message}`);
  }
  logger.raw('');

  let lastTickLog = 0;

  while (!stoppingRef.value) {
    storage.resetDailyIfNewDay();

    if (Date.now() < globalCooldownUntil) {
      const waitMs = globalCooldownUntil - Date.now();
      logger.info(`🚨 Global cooldown active (Server 503). Sleeping for ${hms(waitMs)}...`);
      await sleep(waitMs);
      continue;
    }

    if (!isActiveHours()) {
      const pktHour = (new Date().getUTCHours() + 5) % 24;
      const nextHour = config.loop.activeHoursPkt.find(h => h > pktHour) || config.loop.activeHoursPkt[0];
      let hoursToWait = (nextHour - pktHour + 24) % 24;
      if (hoursToWait === 0) hoursToWait = 24;
      const waitMs = hoursToWait * 60 * 60 * 1000;
      logger.info(`💤 Outside active hours (${pktHour}:00 PKT). Sleeping for ${hoursToWait}h until ${nextHour}:00 PKT...`);
      await sleep(waitMs);
      continue;
    }

    if (allQuotasHit()) {
      const waitMs = new Date().setUTCHours(24, 0, 0, 0) - Date.now();
      logger.info(`📅 All daily quotas reached — sleeping ${hms(waitMs)} until UTC midnight`);
      await sleep(waitMs);
      continue;
    }

    // 🛑 RANDOMIZED TASK SELECTION
    const availableActions = [];
    if (canFollowBack()) availableActions.push('followBack');
    if (pendingQueue.length > 0 && canMessage()) {
      const ready = pendingQueue.find((p) => p.warmupDone && Date.now() - p.followedAt >= config.loop.delayBeforeDMms);
      if (ready) availableActions.push('message');
    }
    if (config.loop.warmupEnabled && canLikePost()) {
      const ready = pendingQueue.find((p) => !p.warmupDone && Date.now() - p.followedAt >= config.loop.delayBeforeWarmupMs);
      if (ready) availableActions.push('warmup');
    }
    if (canFollow()) availableActions.push('follow');
    if (canUnfollow()) availableActions.push('unfollow');
    if (canLikePost()) availableActions.push('like');
    if (canLikeComment()) availableActions.push('commentLike');
    if (canComment()) availableActions.push('comment');
    if (canReply()) availableActions.push('reply');

    if (availableActions.length > 0) {
      const action = pickRandom(availableActions);
      let didAction = false;

      if (action === 'followBack') didAction = await doFollowBack(account);
      else if (action === 'message') didAction = await doSendDM(account);
      else if (action === 'warmup') didAction = await doWarmup(account);
      else if (action === 'follow') didAction = await doFollow(account);
      else if (action === 'unfollow') didAction = await doUnfollow(account);
      else if (action === 'like') didAction = await doLikePost(account);
      else if (action === 'commentLike') didAction = await doLikeComment(account);
      else if (action === 'comment') didAction = await doComment(account);
      else if (action === 'reply') didAction = await doReply(account);

      if (didAction) {
        // Fast 5 second pause
        await sleep(5000);
        continue;
      }
    }

    // If no action was taken (e.g., waiting for a cooldown to expire)
    await sleep(10000);
    if (Date.now() - lastTickLog > 5 * 60 * 1000) {
      lastTickLog = Date.now();
      const snap = {
        follows: storage.getField('follows'), 
        unfollows: storage.getField('unfollows'),
        messages: storage.getField('messages'),
        postLikes: storage.getField('postLikes'), commentLikes: storage.getField('commentLikes'),
        comments: storage.getField('comments'), replies: storage.getField('replies'),
        pendingWarmups: pendingQueue.filter((p) => !p.warmupDone).length,
        pendingDMs: pendingQueue.filter((p) => p.warmupDone).length,
      };
      logger.info(`📊 status: ${JSON.stringify(snap)}`);
    }
  }

  logger.info('Bot stopped.');
}

module.exports = { startFollowBot };