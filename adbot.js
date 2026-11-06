// ============================================================
//  adbot.js — Auto Watch Ad & Claim Coins (Offline Aware)
// ============================================================
const api = require('./api');
const config = require('./config');
const logger = require('./logger');
const { sleep, hms } = require('./utils');

const TAG = 'ADBOT';

function isActiveHours() {
  if (!config.loop.activeHoursPkt || config.loop.activeHoursPkt.length === 0) return true;
  const pktHour = (new Date().getUTCHours() + 5) % 24;
  return config.loop.activeHoursPkt.includes(pktHour);
}

async function runAdCycle(account) {
  // 🛑 If offline, wait 30 minutes before checking again
  if (!isActiveHours()) {
    return 30 * 60 * 1000; 
  }

  try {
    const status = await api.getCoinsStatus(account);
    const caps = status.caps;

    if (!caps.watchAdsEnabled) {
      return 3600000; 
    }

    if (caps.adsRemainingToday <= 0) {
      logger.info(`[${TAG}] 📅 No ads remaining today (0 left). Sleeping for 4 hours...`);
      return 4 * 3600000; 
    }

    if (caps.adCooldownRemainingSeconds > 0) {
      const waitMs = (caps.adCooldownRemainingSeconds + 5) * 1000;
      logger.info(`[${TAG}] ⏳ Cooldown active. Sleeping for ${hms(waitMs)}...`);
      return waitMs;
    }

    logger.info(`[${TAG}] 🎬 Attempting to start ad. Next reward: ${caps.nextAdRewardCoins} coins. (${caps.adsRemainingToday} left today)`);
    const attempt = await api.attemptAd(account);
    
    if (!attempt.allowed) {
      return attempt.retryAfterSeconds * 1000;
    }

    logger.info(`[${TAG}] 📺 "Watching" ad for 30 seconds...`);
    await sleep(30000);

    logger.info(`[${TAG}] 💰 Claiming reward...`);
    const reward = await api.claimAdReward(account);

    if (reward.success) {
      logger.success(`[${TAG}] ✅ Claimed ${reward.credited} coins! New balance: ${reward.balance}`);
      const randomSeconds = Math.floor(Math.random() * 301) + 605; 
      const randomMs = randomSeconds * 1000;
      logger.info(`[${TAG}] ⏱️ Randomized wait time: sleeping for ${hms(randomMs)} before next ad...`);
      return randomMs; 
    }

    return 60000; 

  } catch (e) {
    logger.error(`[${TAG}] ❌ Error: ${e.message}`);
    return 60000; 
  }
}

async function startAdBot(accounts) {
  const account = accounts[0];
  logger.info(`[${TAG}] Ad Farmer started (Offline Aware).`);

  while (true) {
    const waitMs = await runAdCycle(account);
    await sleep(waitMs);
  }
}

module.exports = { startAdBot };