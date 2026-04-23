/**
 * IPC обработчики для настроек
 */

const { ipcMain } = require('electron');
const { loadSettings, persistSettings } = require('../config/settings');

/**
 * Регистрация IPC обработчиков для настроек
 */
function registerSettingsHandlers() {
  ipcMain.handle('settings:load', () => loadSettings());

  ipcMain.handle('settings:save', (_e, settings) => {
    persistSettings(settings);
    return { ok: true };
  });
}

module.exports = { registerSettingsHandlers };
