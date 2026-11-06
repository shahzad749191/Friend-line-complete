// ============================================================
//  index.js — entry point (Multi-Account Support)
// ============================================================
const config = require('./config');
const logger = require('./logger');
const auth = require('./auth');
const accounts = require('./accounts');
const { startFollowBot } = require('./followbot');
const { startAutopost } = require('./autopost');
const { startDailyTasks } = require('./daily');
const { startAdBot } = require('./adbot');
const { startPhotoBot } = require('./photobot');

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection (ignored)', {
    reason: String(reason && reason.stack ? reason.stack : reason),
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception (ignored)', {
    err: err.message,
    stack: err.stack,
  });
});

async function bootstrap() {
  logger.raw('');
  logger.raw('╔══════════════════════════════════════════════╗');
  logger.raw('║     FRIENDLINE MULTI-ACCOUNT BOT             ║');
  logger.raw('╚══════════════════════════════════════════════╝');
  logger.info(`Base URL           : ${config.api.baseUrl}`);
  logger.info(`Accounts Loaded    : ${accounts.length}`);
  logger.raw('');

  // 1. Init auth for ALL accounts
  await auth.initAll(accounts);
  logger.info('Auth ready for all accounts.');
  logger.raw('');

  // 2. Start background tasks for EACH account
  accounts.forEach((account) => {
    logger.info(`🚀 Launching background tasks for: ${account.name} (${account.uid})`);
    
    // We pass [account] (an array with just this one account) 
    // because the bot modules are designed to accept an array and use index [0].
    
    startDailyTasks([account]);
    startAdBot([account]); 
    startPhotoBot([account]); 
    
    startFollowBot([account]).catch((e) => {
      logger.error(`Follow bot crashed for ${account.name}`, { err: e.message, stack: e.stack });
    });

    startAutopost([account]).catch((e) => {
      logger.error(`Autopost crashed for ${account.name}`, { err: e.message, stack: e.stack });
    });
  });
}

bootstrap().catch((e) => {
  logger.error('Bootstrap failed', { err: e.message, stack: e.stack });
});