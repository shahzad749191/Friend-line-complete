// ============================================================
//  photobot.js — Auto Post Pinterest Images + Random Captions
// ============================================================
const api = require('./api');
const config = require('./config');
const logger = require('./logger');
const { sleep } = require('./utils');

const TAG = 'PHOTOBOT';

// 🧪 TEST MODE: Set to true to test, false for normal schedule
const TEST_NOW = false; 

async function fetchPinterestImage(query) {
  try {
    const url = `https://www.pinterest.com/resource/BaseSearchResource/get/?data={"options":{"query":"${encodeURIComponent(query)}","scope":"pins"}}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Accept': 'application/json'
      }
    });
    
    if (!res.ok) throw new Error(`Pinterest HTTP ${res.status}`);
    const data = await res.json();
    
    const results = data?.resource_response?.data?.results || [];
    const images = results
      .filter(r => r.type === 'pin' && r.images?.orig?.url)
      .map(r => r.images.orig.url);
      
    if (images.length === 0) throw new Error('No images found in Pinterest response');
    
    return images[Math.floor(Math.random() * images.length)];
  } catch (e) {
    logger.warn(`[${TAG}] Pinterest fetch failed: ${e.message}. Falling back to Lorem Picsum...`);
    return `https://picsum.photos/1080/1080?random=${Math.floor(Math.random() * 1000)}`;
  }
}

async function postPinterestImage(account) {
  try {
    logger.info(`[${TAG}] 🔍 Searching Pinterest for "${config.photopost.searchQuery}"...`);
    const imageUrl = await fetchPinterestImage(config.photopost.searchQuery);
    
    logger.info(`[${TAG}] ⬇️ Downloading image...`);
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Download failed: ${imgRes.status}`);
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    
    logger.info(`[${TAG}] ⬆️ Uploading to Friendline...`);
    const mediaUrl = await api.uploadImage(account, buffer);
    
    // 🚨 NEW: Pick a random caption from the array
    const captions = config.photopost.captions || ['Follow Me To GEt Follow Back'];
    const randomCaption = captions[Math.floor(Math.random() * captions.length)];

    logger.info(`[${TAG}] 📝 Creating post with caption: "${randomCaption}"...`);
    const postRes = await api.createImagePost(account, {
      text: randomCaption,
      mediaUrl,
      country: config.photopost.country,
      city: config.photopost.city,
      categoryId: config.photopost.categoryId,
      subcategoryId: config.photopost.subcategoryId
    });
    
    if (postRes.data?.success) {
      const pid = postRes.data.post?.postId || 'unknown';
      logger.success(`[${TAG}] ✅ Posted Image! postId=${pid}`);
      
      // 🚀 Boosting the image immediately
      logger.info(`[${TAG}] 🚀 Boosting post ${pid}...`);
      await api.boostPost(account, pid);
    } else {
      logger.warn(`[${TAG}] ❌ Post failed: ${JSON.stringify(postRes.data)}`);
    }
  } catch (e) {
    logger.error(`[${TAG}] ❌ Error: ${e.message}`);
  }
}

function msUntilNextHourUtc(hours) {
  const now = new Date();
  const candidates = hours.map(h => {
    const t = new Date(now);
    t.setUTCHours(h, 0, 0, 0);
    if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
    return t;
  }).sort((a, b) => a - b);
  return { ms: candidates[0] - now, next: candidates[0] };
}

async function startPhotoBot(accounts) {
  if (!config.photopost.enabled) return;
  
  const account = accounts[0];
  const hours = config.photopost.hoursUtc || [];
  
  logger.info(`[${TAG}] Started. Query: "${config.photopost.searchQuery}"`);
  logger.info(`[${TAG}]   Post hours UTC: [${hours.join(', ')}]`);
  logger.info(`[${TAG}]   Loaded ${config.photopost.captions.length} caption variations.`);

  // 🧪 TEST MODE EXECUTION
  if (TEST_NOW) {
    logger.warn(`[${TAG}] 🧪 TEST MODE ENABLED — Forcing an image post NOW!`);
    setTimeout(async () => {
      await postPinterestImage(account);
    }, 3000);
  }
  
  function scheduleNext() {
    const { ms, next } = msUntilNextHourUtc(hours);
    logger.info(`[${TAG}] ⏰ Next photo at ${next.toISOString()} (in ${(ms / 3600000).toFixed(2)}h)`);
    
    setTimeout(async () => {
      logger.info(`[${TAG}] ⏰ Time to post image.`);
      await postPinterestImage(account);
      scheduleNext();
    }, ms);
  }
  
  scheduleNext();
}

module.exports = { startPhotoBot };