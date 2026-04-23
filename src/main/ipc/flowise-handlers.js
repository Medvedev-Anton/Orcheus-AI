/**
 * IPC обработчики для Flowise API
 */

const { ipcMain } = require('electron');
const { getUser } = require('../services/auth');
const { callFlowise, extractFiles } = require('../services/flowise');
const { writeProjectFiles } = require('../services/files');
const { loadSettings } = require('../config/settings');

/**
 * Регистрация IPC обработчиков для Flowise
 */
function registerFlowiseHandlers() {
  ipcMain.handle('flowise:predict', async (event, { question, chatId }) => {
    // Проверка авторизации
    const { user } = await getUser();
    if (!user) {
      return { ok: false, error: 'Необходима авторизация. Войдите в аккаунт.' };
    }

    const settings = loadSettings();
    const send = event.sender;
    const progress = (msg) => {
      console.log('[Progress]', msg);
      if (!send.isDestroyed()) send.send('flowise:progress', msg);
    };

    try {
      const payload = await callFlowise(question, chatId, settings, progress);
      progress('Извлекаем файлы из ответа...');
      const files = extractFiles(payload);
      progress(`Найдено файлов: ${files.length}. Записываем...`);
      const written = await writeProjectFiles(settings.projectRoot, files, progress);
      console.log('[OK] Записано файлов:', written.map(f => f.name));
      return { ok: true, files: written };
    } catch (err) {
      console.error('[ERROR] flowise:predict —', err.message);
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { registerFlowiseHandlers };
