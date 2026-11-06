// ============================================================
//  index.js — entry point (Ad Coin Farming Only)
// ============================================================
const config = require('./config');
const logger = require('./logger');
const auth = require('./auth');
const accounts = require('./accounts');

// Only import the Ad Bot
const { startAdBot } = require('./adbot');

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
  logger.raw('║     FRIENDLINE AD COIN FARMER                ║');
  logger.raw('╚══════════════════════════════════════════════╝');
  logger.info(`Base URL           : ${config.api.baseUrl}`);
  logger.info(`Accounts Loaded    : ${accounts.length}`);
  logger.raw('');

  // 1. Init auth for ALL accounts
  await auth.initAll(accounts);
  logger.info('Auth ready for all accounts.');
  logger.raw('');

  // 2. Start ONLY the Ad Farmer for EACH account
  accounts.forEach((account) => {
    logger.info(`🚀 Launching Ad Farmer for: ${account.name} (${account.uid})`);
    
    // Starts the Ad Farmer (watches 18-20 ads for coins)
    startAdBot([account]); 
  });
}

bootstrap().catch((e) => {
  logger.error('Bootstrap failed', { err: e.message, stack: e.stack });
});