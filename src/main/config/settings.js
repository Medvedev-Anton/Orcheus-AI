/**
 * Управление настройками приложения
 */

const fs = require('fs');
const path = require('path');
const { SETTINGS_FILE, DEFAULT_SETTINGS } = require('./constants');

/**
 * Загрузка настроек из файла
 * @returns {object} Настройки приложения
 */
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
  } catch (_) { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

/**
 * Сохранение настроек в файл
 * @param {object} settings - Настройки для сохранения
 */
function persistSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

module.exports = { loadSettings, persistSettings };
