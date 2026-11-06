// ============================================================
//  logger.js
// ============================================================
const fs = require('fs');
const path = require('path');
const config = require('./config');

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ts() {
  return new Date().toISOString();
}

function safe(obj) {
  try {
    return typeof obj === 'string' ? obj : JSON.stringify(obj);
  } catch {
    return '[unserializable]';
  }
}

const logger = {
  info(msg, meta) {
    const line = `[${ts()}] INFO  ${msg}${meta ? ' ' + safe(meta) : ''}`;
    console.log('\x1b[36m%s\x1b[0m', line);
  },
  success(msg, meta) {
    const line = `[${ts()}] OK    ${msg}${meta ? ' ' + safe(meta) : ''}`;
    console.log('\x1b[32m%s\x1b[0m', line);
  },
  warn(msg, meta) {
    const line = `[${ts()}] WARN  ${msg}${meta ? ' ' + safe(meta) : ''}`;
    console.log('\x1b[33m%s\x1b[0m', line);
  },
  error(msg, meta) {
    const line = `[${ts()}] ERROR ${msg}${meta ? ' ' + safe(meta) : ''}`;
    console.log('\x1b[31m%s\x1b[0m', line);
    try {
      ensureDir(config.storage.errorFile);
      fs.appendFileSync(config.storage.errorFile, line + '\n', 'utf8');
    } catch {}
  },
  raw(msg) {
    console.log(msg);
  },
};

module.exports = logger;