// ============================================================
//  autopost.js — Trending API with Smart Filters
//  FIX: If all matching videos are already posted, retry in 10m
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const config = require('./config');
const logger = require('./logger');
const api = require('./api');
const { sleep } = require('./utils');

const TAG = 'AUTOPOST';
const TMP_DIR = path.join(__dirname, 'data', 'tmp');
const STATE_FILE = path.join(__dirname, 'data', 'autopost_state.json');

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const FFMPEG = 'ffmpeg';
const FFPROBE = 'ffprobe';

const TEST_NOW = false;

let state = {
  postedToday: {},
  postedVideoIds: [],
};
try {
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    state = { ...state, ...saved };
  }
} catch (e) {
  logger.warn(`[${TAG}] load state: ${e.message}`);
}

function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
  catch (e) { logger.warn(`[${TAG}] save state: ${e.message}`); }
}

const todayStr = () => new Date().toISOString().slice(0, 10);

function randHex(n = 8) {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
const uuid = () => crypto.randomUUID();

async function ffmpegVersion() {
  try {
    const { stdout } = await execAsync(`${FFMPEG} -version`);
    return (stdout || '').split('\n')[0];
  } catch { return null; }
}

const OMKAR_API_KEY = process.env.OMKAR_API_KEY || 'ok_0ffe50e920b43ae5297e53863568fa31';

function deepFindVideoUrl(obj, depth = 0) {
  if (!obj || depth > 12) return null;
  if (typeof obj === 'string') {
    const lower = obj.toLowerCase();
    if (!lower.startsWith('http')) return null;
    const badExts = ['.jpg', '.jpeg', '.webp', '.png', '.gif', '.heic', '.svg'];
    if (badExts.some(e => lower.includes(e))) return null;
    const badAudio = ['/audio/', 'audio-', '/music/', 'music-', '.m4a', '.mp3', '.wav', '.aac'];
    if (badAudio.some(a => lower.includes(a))) return null;
    if (
      lower.includes('.mp4') || lower.includes('.m3u8') ||
      lower.includes('tiktokcdn') || lower.includes('byteoversea') ||
      lower.includes('tiktokv.com') || lower.includes('tiktokv.us') ||
      lower.includes('akamaized') || lower.includes('video/tos') ||
      lower.includes('play') || lower.includes('download')
    ) return obj;
    return null;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = deepFindVideoUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof obj === 'object') {
    const badKeys = ['cover', 'covers', 'dynamic_cover', 'origin_cover', 'thumbnail', 'thumb', 'image', 'avatar', 'music', 'sound'];
    const priority = [
      'hd_play_url', 'play_url', 'video_url', 'hd_video_url', 'download_url',
      'play_addr', 'play_addr_h264', 'download_addr', 'downloadAddr', 'playAddr',
      'url_list', 'url', 'play', 'hdplay', 'wmplay', 'video', 'media'
    ];
    for (const key of priority) {
      if (obj[key] !== undefined && !badKeys.some(b => key.toLowerCase().includes(b))) {
        const found = deepFindVideoUrl(obj[key], depth + 1);
        if (found) return found;
      }
    }
    for (const key of Object.keys(obj)) {
      if (badKeys.some(b => key.toLowerCase().includes(b))) continue;
      if (priority.includes(key)) continue;
      const found = deepFindVideoUrl(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function fetchFilteredTrending() {
  const market = (config.autopost.trendingMarket || 'PK').toUpperCase();
  const blocked = config.autopost.blockedKeywords || [];
  const targets = config.autopost.targetKeywords || [];
  
  const trendingUrl = `https://tiktok-scraper.omkar.cloud/feed/trending?country=${market}`;
  logger.info(`[${TAG}] 🔍 Fetching TRENDING videos for country: ${market}...`);

  let data = null;
  try {
    const res = await fetch(trendingUrl, {
      headers: { 'API-Key': OMKAR_API_KEY, 'Accept': 'application/json' },
    });
    if (res.ok) {
      data = await res.json();
    } else {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
  } catch (e) {
    throw new Error(`Trending fetch failed: ${e.message}`);
  }

  const videos = data.videos || [];
  if (!Array.isArray(videos) || !videos.length) {
    throw new Error('Trending endpoint returned 0 videos');
  }

  const originalCount = videos.length;

  const filtered = videos.filter(v => {
    const desc = (v.description || '').toLowerCase();
    
    if (blocked.some(word => desc.includes(word))) return false;

    const w = v.video?.width || 0;
    const h = v.video?.height || 0;
    if (w < 720 && h < 720) return false;

    if (targets.length > 0) {
      const hasTarget = targets.some(word => desc.includes(word));
      if (!hasTarget) return false;
    }

    return true;
  });

  logger.info(`[${TAG}] ✅ Found ${filtered.length} matching videos out of ${originalCount} trending (filtered out ${originalCount - filtered.length}).`);

  return filtered.map(v => {
    const id = v.id || v.video_id;
    const videoObj = v.video || {};
    const qualities = videoObj.qualities || [];
    const bestQuality = qualities.find(q => q.quality === '1080p') || qualities.find(q => q.quality === '720p') || qualities[0] || {};
    const playUrl = videoObj.download_link || bestQuality.play_link || videoObj.play_link || deepFindVideoUrl(v);
    
    let createMs = Date.now();
    if (v.created_at) {
      const t = new Date(v.created_at).getTime();
      if (!isNaN(t)) createMs = t;
    }

    return {
      video_id: id,
      title: v.description || '',
      create_time: createMs,
      duration: videoObj.duration_seconds || v.duration || 0,
      play: playUrl,
      tiktok_url: v.link || null,
    };
  }).filter(v => v && v.video_id && v.play);
}

async function getFreshVideoUrlFromDetails(videoId, tiktokUrl) {
  const candidates = [];
  if (videoId) candidates.push({ value: videoId, label: `video=${videoId}` });
  if (tiktokUrl) candidates.push({ value: tiktokUrl, label: 'video=<url>' });

  for (const c of candidates) {
    const endpoint = `https://tiktok-scraper.omkar.cloud/tiktok/videos/details?video=${encodeURIComponent(c.value)}`;
    try {
      const res = await fetch(endpoint, {
        headers: { 'API-Key': OMKAR_API_KEY, 'Accept': 'application/json' },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const freshUrl = deepFindVideoUrl(data);
      if (freshUrl) return freshUrl;
    } catch (e) {}
  }
  return null;
}

async function tryDownload(targetUrl, filePath, label) {
  const headersSets = [
    { label: 'mobile UA', headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36', 'Referer': 'https://www.tiktok.com/', 'Accept': '*/*' } },
    { label: 'App UA', headers: { 'User-Agent': 'com.ss.android.ugc.trill/2613 (Linux; U; Android 10; en_US; Pixel 4; Build/QQ3A.200805.001; Cronet/58.0.2991.0)', 'Accept': '*/*' } },
    { label: 'allorigins', useProxy: true, headers: { 'Accept': '*/*' } },
  ];

  for (const h of headersSets) {
    try {
      const finalUrl = h.useProxy ? `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}` : targetUrl;
      const res = await fetch(finalUrl, { headers: h.headers });
      if (!res.ok) continue;
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('image/')) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100 * 1024) continue;
      fs.writeFileSync(filePath, buf);
      logger.success(`[${TAG}] ✅ Downloaded (${(buf.length / 1024 / 1024).toFixed(2)} MB) via ${label}/${h.label}`);
      return buf.length;
    } catch (e) {}
  }
  return 0;
}

async function downloadToFile(video, filePath) {
  const candidates = [];
  if (video.play) candidates.push({ url: video.play, label: 'trending play URL' });
  
  const omkarUrl = await getFreshVideoUrlFromDetails(video.video_id, video.tiktok_url);
  if (omkarUrl) candidates.push({ url: omkarUrl, label: 'Omkar details' });

  for (const c of candidates) {
    const n = await tryDownload(c.url, filePath, c.label);
    if (n) return n;
  }
  throw new Error('All download strategies failed');
}

async function getVideoInfo(mp4Path) {
  try {
    const checkCmd = `${FFPROBE} -v error -select_streams v:0 -show_entries stream=codec_type -of default=noprint_wrappers=1:nokey=1 "${mp4Path}"`;
    const { stdout: checkOut } = await execAsync(checkCmd, { maxBuffer: 1024 * 1024 });
    if (!checkOut.trim().includes('video')) return { duration: 0, hasVideo: false };
    const durCmd = `${FFPROBE} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${mp4Path}"`;
    const { stdout: durOut } = await execAsync(durCmd, { maxBuffer: 1024 * 1024 });
    const d = parseFloat(durOut.trim());
    return { duration: Number.isFinite(d) ? Math.round(d) : 0, hasVideo: true };
  } catch { return { duration: 0, hasVideo: false }; }
}

async function transcodeToSingleFileHLS(inputMp4, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const playlist = path.join(outDir, 'index.m3u8');
  const segFile = path.join(outDir, 'stream.ts');
  const cmd = [
    FFMPEG, '-y', '-i', `"${inputMp4}"`,
    '-vf', '"scale=trunc(iw/2)*2:trunc(ih/2)*2"',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k', '-hls_time', '99999',
    '-hls_list_size', '0', '-hls_playlist_type', 'vod',
    '-hls_flags', 'single_file', '-hls_segment_filename', `"${segFile}"`, `"${playlist}"`,
  ].join(' ');
  const { stderr } = await execAsync(cmd, { maxBuffer: 1024 * 1024 * 64 });
  if (!fs.existsSync(playlist) || !fs.existsSync(segFile)) throw new Error('ffmpeg no output — ' + stderr.slice(-300));
  return { playlist, streamFile: segFile };
}

async function extractThumbnail(inputMp4, outFile) {
  const cmd = [FFMPEG, '-y', '-i', `"${inputMp4}"`, '-ss', '00:00:01', '-vf', '"scale=720:-1"', '-vframes', '1', '-q:v', '3', `"${outFile}"`].join(' ');
  await execAsync(cmd, { maxBuffer: 1024 * 1024 * 16 });
  return outFile;
}

async function getStorageTokenBatch(account, filenames) {
  const r = await api.rawRequest(account, 'POST', '/uploads/storage-token-batch', { data: { kind: 'post', filenames, idempotencyKey: uuid() } });
  if (r.status !== 200 || !r.data?.success) throw new Error(`storage-token-batch (${r.status})`);
  return r.data;
}

async function getStorageTokenSingle(account, filename) {
  const r = await api.rawRequest(account, 'POST', '/uploads/storage-token', { data: { kind: 'post', filename, idempotencyKey: uuid() } });
  if (r.status !== 200 || !r.data?.success) throw new Error(`storage-token (${r.status})`);
  return r.data;
}

async function putToPresignedUrl(uploadUrl, localFile) {
  const buf = fs.readFileSync(localFile);
  const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
  if (res.status !== 200 && res.status !== 201) throw new Error(`PUT → ${res.status}`);
}

async function createPost(account, { text, videoLink, thumbnail, durationSeconds }) {
  const suffix = config.autopost.captionSuffix || '';
  const finalText = ((text || '').trim() + suffix).trim();
  const body = { text: finalText, uid: account.uid, media: thumbnail || '', mediaType: 'video', country: config.autopost.country, city: config.autopost.city, videoLink };
  if (durationSeconds) body.videoDurationSeconds = durationSeconds;
  return await api.rawRequest(account, 'POST', '/posts/createPost', { data: body });
}

async function uploadVideoToFriendline(account, localMp4) {
  const workDir = path.join(TMP_DIR, `hls_${Date.now()}_${randHex(6)}`);
  fs.mkdirSync(workDir, { recursive: true });
  const { playlist, streamFile } = await transcodeToSingleFileHLS(localMp4, workDir);
  const thumbPath = path.join(workDir, 'thumb.jpg');
  await extractThumbnail(localMp4, thumbPath);
  const batch = await getStorageTokenBatch(account, ['stream.ts', 'index.m3u8']);
  
  const streamUpload = batch.uploads.find(u => u.filename === 'stream.ts');
  if (!streamUpload) throw new Error('no stream.ts token');
  await putToPresignedUrl(streamUpload.uploadUrl, streamFile);

  const playlistUpload = batch.uploads.find(u => u.filename === 'index.m3u8');
  if (!playlistUpload) throw new Error('no index.m3u8 token');
  await putToPresignedUrl(playlistUpload.uploadUrl, playlist);

  const thumbName = `${account.uid}_${Date.now()}_${randHex(12)}.jpg`;
  const thumbToken = await getStorageTokenSingle(account, thumbName);
  await putToPresignedUrl(thumbToken.uploadUrl, thumbPath);

  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  return { videoLink: `${batch.publicBaseUrl}index.m3u8`, thumbnail: thumbToken.publicUrl };
}

async function postNextVideo(account) {
  let perm;
  let retries = 3;
  
  while (retries > 0) {
    try {
      const r = await api.rawRequest(account, 'GET', '/dashboard/mediaPermissions', { params: { uid: account.uid } });
      if (r.status === 200 && r.data?.data) { perm = r.data.data; break; }
    } catch (e) {}
    retries--;
    if (retries > 0) await sleep(5000);
  }

  if (!perm) return false;

  const today = todayStr();
  const count = state.postedToday[today] || 0;
  
  const maxVideos = config.autopost.hoursUtc.length;

  if (count >= maxVideos || perm.dailyLimitReached) {
    logger.info(`[${TAG}] ⛔ Daily video limit reached (${count}/${maxVideos}) — skipping.`);
    return true; 
  }
  
  logger.info(`[${TAG}] 📋 Videos today: ${count}/${maxVideos}`);

  let videos;
  try {
    videos = await fetchFilteredTrending();
  } catch (e) {
    logger.error(`[${TAG}] ❌ Fetch failed: ${e.message}`);
    return false;
  }

  if (videos.length === 0) {
    logger.info(`[${TAG}] ⏳ No matching videos in trending feed right now. Retrying in 10 minutes...`);
    return false; 
  }

  videos.sort(() => Math.random() - 0.5);
  const posted = new Set(state.postedVideoIds);

  let foundCandidate = false;

  for (const v of videos) {
    if (posted.has(v.video_id)) continue;
    
    foundCandidate = true;

    if (v.duration && v.duration > config.autopost.maxVideoDurationSec) {
      state.postedVideoIds.push(v.video_id); saveState(); continue;
    }
    if (v.duration && v.duration < config.autopost.minVideoDurationSec) {
      state.postedVideoIds.push(v.video_id); saveState(); continue;
    }

    logger.info(`[${TAG}] 🎯 Next: ${v.video_id} | "${(v.title || '').slice(0, 60)}"`);
    const localMp4 = path.join(TMP_DIR, `${v.video_id}.mp4`);
    let bytes = 0;
    
    try {
      bytes = await downloadToFile(v, localMp4);
    } catch (e) {
      logger.error(`[${TAG}] ❌ Download failed: ${e.message}`);
      state.postedVideoIds.push(v.video_id); saveState(); continue;
    }

    const info = await getVideoInfo(localMp4);
    if (!info.hasVideo || info.duration > config.autopost.maxVideoDurationSec) {
      state.postedVideoIds.push(v.video_id); saveState();
      try { fs.unlinkSync(localMp4); } catch {} continue;
    }

    let uploaded;
    try {
      uploaded = await uploadVideoToFriendline(account, localMp4);
    } catch (e) {
      logger.error(`[${TAG}] ❌ Upload failed: ${e.message}`);
      try { fs.unlinkSync(localMp4); } catch {}
      return false; 
    }
    try { fs.unlinkSync(localMp4); } catch {}

    try {
      const r = await createPost(account, {
        text: v.title || '',
        videoLink: uploaded.videoLink,
        thumbnail: uploaded.thumbnail,
        durationSeconds: info.duration,
      });

      if ((r.status === 201 || r.status === 200) && r.data?.success) {
        state.postedVideoIds.push(v.video_id);
        state.postedToday[today] = (state.postedToday[today] || 0) + 1;
        saveState();
        
        const pid = r.data?.post?.postId || r.data?.postId || '(unknown)';
        logger.success(`[${TAG}] ✅ Posted! — today ${state.postedToday[today]}`);

        if (pid && pid !== '(unknown)') {
          logger.info(`[${TAG}] 🚀 Boosting post ${pid}...`);
          await api.boostPost(account, pid);
        }

        return true;
      } else {
        logger.warn(`[${TAG}] ⚠️ createPost failed: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
        if (r.status === 403 || r.status === 400) {
            logger.info(`[${TAG}] 🛑 Friendline server rejected extra video. Limit reached on server side.`);
            return true; 
        }
      }
    } catch (e) {
      logger.error(`[${TAG}] ❌ createPost error: ${e.message}`);
    }
  }

  if (!foundCandidate) {
    logger.info(`[${TAG}] ⏳ All matching trending videos are already posted. Retrying in 10 minutes for fresh ones...`);
  }
  
  return false; // Triggers a 10-minute retry instead of waiting 3 hours
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

async function startAutopost(accounts) {
  if (!config.autopost.enabled) return;

  const account = accounts[0];
  const hours = config.autopost.hoursUtc || [];

  logger.info(`[${TAG}] Started (TRENDING + FILTERS + BOOST). Account: ${account.name} (${account.uid})`);
  logger.info(`[${TAG}]   Target Keywords: ${config.autopost.targetKeywords.join(', ')}`);
  logger.info(`[${TAG}]   Blocked Keywords: ${config.autopost.blockedKeywords.join(', ')}`);

  if (TEST_NOW) {
    setTimeout(async () => {
      try { await postNextVideo(account); } catch (e) { logger.error(e.message); }
    }, 3000);
  }

  function scheduleNext(isRetry = false) {
    let ms, next;
    
    if (isRetry) {
      ms = 10 * 60 * 1000;
      next = new Date(Date.now() + ms);
      logger.info(`[${TAG}] ⏰ Retrying in 10 minutes at ${next.toISOString()}`);
    } else {
      const nextHour = msUntilNextHourUtc(hours);
      ms = nextHour.ms;
      next = nextHour.next;
      logger.info(`[${TAG}] ⏰ Next post at ${next.toISOString()} (in ${(ms / 3600000).toFixed(2)}h)`);
    }

    setTimeout(async () => {
      try {
        const success = await postNextVideo(account);
        if (success === false) scheduleNext(true);
        else scheduleNext(false);
      } catch (e) {
        logger.error(`[${TAG}] ❌ cycle error: ${e.message}`);
        scheduleNext(true);
      }
    }, ms);
  }

  scheduleNext(false);
}

module.exports = { startAutopost };