// ============================================================
//  daily.js — Auto Check-in / Streak Claimer (Offline Aware)
// ============================================================
const api = require('./api');
const config = require('./config');
const logger = require('./logger');

const TAG = 'DAILY';

function isActiveHours() {
  if (!config.loop.activeHoursPkt || config.loop.activeHoursPkt.length === 0) return true;
  const pktHour = (new Date().getUTCHours() + 5) % 24;
  return config.loop.activeHoursPkt.includes(pktHour);
}

async function checkAndClaimStreak(account) {
  if (!isActiveHours()) return;

  try {
    const status = await api.getStreakStatus(account);
    if (!status) return;
    
    if (status.pendingClaim) {
      logger.info(`[${TAG}] 🎁 Pending streak claim found! Today's reward: ${status.todayRewardCoins} coins.`);
      const claim = await api.claimStreak(account);
      if (claim && claim.success) {
        logger.success(`[${TAG}] ✅ Claimed ${claim.credited} coins! Streak: ${claim.currentStreak} days. New balance: ${claim.balance}`);
      }
    } else {
      logger.info(`[${TAG}] Streak already claimed today. Current streak: ${status.currentStreak} days.`);
    }
  } catch (e) {
    logger.error(`[${TAG}] Error checking streak: ${e.message}`);
  }
}

async function startDailyTasks(accounts) {
  const account = accounts[0];
  logger.info(`[${TAG}] Auto Check-in / Streak Claimer started.`);
  
  await checkAndClaimStreak(account);
  
  // Check every 3 hours (instead of 1) to reduce API calls
  setInterval(async () => {
    await checkAndClaimStreak(account);
  }, 3 * 60 * 60 * 1000);
}

module.exports = { startDailyTasks };