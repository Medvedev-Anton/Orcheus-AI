/**
 * Logger Utility
 * Requirements: 4.3, 4.4
 * 
 * Контролируемое логирование с поддержкой уровней:
 * - debug: все сообщения
 * - info: info, warn, error
 * - warn: warn, error
 * - error: только error
 */

const { config } = require('../config');

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

/**
 * Получить текущий уровень логирования
 * @returns {number}
 */
function getCurrentLevel() {
  return LOG_LEVELS[config.logLevel] ?? LOG_LEVELS.info;
}

/**
 * Проверить, нужно ли логировать на данном уровне
 * @param {string} level
 * @returns {boolean}
 */
function shouldLog(level) {
  const currentLevel = getCurrentLevel();
  const messageLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  return messageLevel >= currentLevel;
}

/**
 * Форматировать сообщение с timestamp
 * @param {string} level
 * @param {string} message
 * @returns {string}
 */
function formatMessage(level, message) {
  const timestamp = new Date().toISOString();
  const levelUpper = level.toUpperCase().padEnd(5);
  return `[${timestamp}] [${levelUpper}] ${message}`;
}

/**
 * Логирование debug уровня
 * Только в development режиме или при LOG_LEVEL=debug
 * @param {string} message
 * @param {...any} args
 */
function debug(message, ...args) {
  if (shouldLog('debug')) {
    console.log(formatMessage('debug', message), ...args);
  }
}

/**
 * Логирование info уровня
 * @param {string} message
 * @param {...any} args
 */
function info(message, ...args) {
  if (shouldLog('info')) {
    console.log(formatMessage('info', message), ...args);
  }
}

/**
 * Логирование warn уровня
 * @param {string} message
 * @param {...any} args
 */
function warn(message, ...args) {
  if (shouldLog('warn')) {
    console.warn(formatMessage('warn', message), ...args);
  }
}

/**
 * Логирование error уровня
 * @param {string} message
 * @param {...any} args
 */
function error(message, ...args) {
  if (shouldLog('error')) {
    console.error(formatMessage('error', message), ...args);
  }
}

module.exports = {
  debug,
  info,
  warn,
  error,
  shouldLog,
  getCurrentLevel
};
