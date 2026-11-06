// ============================================================
//  config.js — 5 Videos & 6 Photos per Day
// ============================================================
require('dotenv').config();

const splitCsv = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

const DEFAULT_MESSAGES = [
  'Hey! 👋 I just followed you — would you please follow me back? 🙏',
  'Hi! Just followed you. Follow back? 😊',
];

const config = {
  api: {
    baseUrl: process.env.API_BASE_URL || 'https://v2.friendline.online',
    apiKey: process.env.API_KEY || '057e5d078184657fb0c6ef150cc997ccqpwetuq9wetq9wetqwe',
    timeout: parseInt(process.env.REQUEST_TIMEOUT_MS || '25000', 10),
    maxRetries: parseInt(process.env.MAX_RETRIES || '2', 10),
    retryDelayMs: parseInt(process.env.RETRY_DELAY_MS || '3000', 10),
    userAgent: process.env.USER_AGENT || 'Dalvik/2.1.0 (Linux; U; Android 9; SO-41B Build/PQ3A.190605.07291804)',
    userAgents: [
      'Dalvik/2.1.0 (Linux; U; Android 9; SO-41B Build/PQ3A.190605.07291804)',
    ],
    endpoints: {}, 
  },

  loop: {
    // 🛑 STRICT SECURE LIMITS (For Main Account)
    followsPerDay: 5,          
    maxFollowsPerHour: 10, 
    unfollowsPerDay: 250,        
    newConversationsPerDay: 45, 
    messagesPerDay: 200,
    maxMessagesPerHour: 5,
    
    postLikesPerDay: 450,        
    commentLikesPerDay: 280,
    replyLikesPerDay: 180,
    
    commentsPerDay: 85,         
    repliesPerDay: 85,          
    
    likeCooldownMs: 60000,        // 1 min (faster likes)
    commentLikeCooldownMs: 1200000, 
    replyLikeCooldownMs: 1200000,
    commentCooldownMs: 900000,     // 15 mins
    replyCooldownMs: 900000,
    unfollowCooldownMs: 300000,    // 5 mins

    warmupEnabled: false, 
    delayBeforeDMms: 300000,
    delayBetweenFollowsMs: 60000, 
    delayBetweenMessagesMs: 1800000,
    
    delayBetweenPagesMs: 5000,
    delayBetweenCyclesMs: 30000,
    maxPages: 1,
    filter: process.env.SUGGESTIONS_FILTER || 'latest_active',
    skipAlreadyFollowed: process.env.SKIP_ALREADY_FOLLOWED !== 'false',

    followBackEnabled: true,
    followBackCheckMs: 60000,
    
    // 🕒 WAKE WINDOWS: 6 AM to 11 PM PKT (Covers all posting times)
    activeHoursPkt: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23], 
  },

  cooldowns: {
    rateLimit: parseInt(process.env.RATE_LIMIT_COOLDOWN_MS || '3600000', 10),
    hardBlock: parseInt(process.env.HARD_BLOCK_COOLDOWN_MS || '14400000', 10),
    userBlock: parseInt(process.env.USER_BLOCK_COOLDOWN_MS || '86400000', 10),
  },

  message: {
    texts: process.env.MESSAGE_TEXT && process.env.MESSAGE_TEXT.trim()
      ? [process.env.MESSAGE_TEXT.trim()]
      : DEFAULT_MESSAGES,
  },

  comments: {
    texts: [
      'Follow me & I\'ll follow back in 30 sec! ⚡',
      'Follow me for instant follow back! 🔥',
      'Beautiful post! Follow me, I follow back fast 🚀',
    ],
  },

  replies: {
    texts: [
      '@{{username}} follow me, I follow back in 30s ⚡',
      '@{{username}} follow me for instant follow back 🔥',
    ],
  },

  storage: {
    followedFile: process.env.FOLLOWED_FILE || './data/followed.json',
    messagedFile: process.env.MESSAGED_FILE || './data/messaged.json',
    likedPostsFile: process.env.LIKED_POSTS_FILE || './data/liked_posts.json',
    commentedPostsFile: process.env.COMMENTED_POSTS_FILE || './data/commented_posts.json',
    likedCommentsFile: process.env.LIKED_COMMENTS_FILE || './data/liked_comments.json',
    repliedCommentsFile: process.env.REPLIED_COMMENTS_FILE || './data/replied_comments.json',
    dailyFile: process.env.DAILY_FILE || './data/daily.json',
    errorFile: process.env.ERROR_FILE || './data/errors.log',
  },

  autopost: {
    enabled: true,
    trendingMarket: 'pk', 
    targetKeywords: ['islamic', 'makkah', 'madinah', 'hadees', 'hadith', 'quran', 'muslim', 'allah', 'muhammad', 'islam', 'sunnah', 'dua', ],
    blockedKeywords: ['funny', 'comedy', 'meme', 'prank', 'joke', 'fail', 'laugh', 'music', 'dance', 'song', 'rap'],
    
    // 🎬 VIDEO SCHEDULE (5 Times a Day)
    // 10 AM, 1 PM, 4 PM, 7 PM, 10 PM PKT
    hoursUtc: [5, 8, 11, 14, 17], 
    
    captionSuffix: '\n\n🕌 Follow me & I\'ll follow you back in 30 SECONDS ⚡\n💯 100% guaranteed follow back — challenge! 🚀\n👥 Let\'s grow together #follow #foryou #viral',
    country: 'pakistan',
    city: '',
    maxVideoSizeMb: 95,
    maxVideoDurationSec: 180,
    minVideoDurationSec: 5,
  },

  photopost: {
    enabled: true,
    searchQuery: 'islamic',
    
    // 📸 PHOTO SCHEDULE (6 Times a Day)
    // 6 AM, 9 AM, 12 PM, 3 PM, 6 PM, 9 PM PKT
    hoursUtc: [1, 4, 7, 10, 13, 16], 
    
    country: 'pakistan',
    city: 'lahore',
    categoryId: 'cat_art',
    subcategoryId: 'sub_art_photo',
    captions: [
      'Follow Me To Get Follow Back in 30 Sec! ⚡',
      'Drop a follow, I follow back instantly! 🔥',
      'Need followers? I return the favor fast! 🙌',
      'Follow me for daily Islamic posts & instant follow back! 📸',
      'Follow me for beautiful reminders ✨ I follow back! 🚀',
      'Hit follow & I\'ll follow you right back! 💯',
      'Follow me for a quick follow back! ⚡',
      'Daily Islamic drops 🕌 Follow me & I follow back!',
      'Let\'s grow together! Follow me, I follow back. 🔥',
      'Instant follow back guaranteed! Follow me now. ⚡'
    ]
  }
};

module.exports = config;