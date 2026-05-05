/**
 * IPC обработчики для Flowise API
 */

const { ipcMain } = require('electron');
const { getUser } = require('../services/auth');
const { callFlowise, extractFiles, startGenerate } = require('../services/flowise');
const { writeProjectFiles } = require('../services/files');
const { loadSettings } = require('../config/settings');
const http = require('http');
const { BACKEND_URL } = require('../config/constants');

let currentGeneration = null;

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

  // Потоковая генерация файлов
  ipcMain.handle('flowise:generate', async (event, { question, chatId }) => {
    const { user } = await getUser();
    if (!user) {
      event.sender.send('flowise:stream-event', { type: 'error', message: 'Необходима авторизация. Войдите в аккаунт.' });
      return;
    }

    const settings = loadSettings();
    const send = event.sender;
    currentGeneration = startGenerate(question, chatId, settings.projectRoot, (sseEvent) => {
      if (!send.isDestroyed()) {
        send.send('flowise:stream-event', sseEvent);
      }
      if (sseEvent.type === 'done' || sseEvent.type === 'error') {
        currentGeneration = null;
      }
    });
  });

  // Отмена потоковой генерации
  ipcMain.handle('flowise:generate-cancel', async (event) => {
    if (currentGeneration) {
      currentGeneration.cancel();
      currentGeneration = null;
    }
    if (!event.sender.isDestroyed()) {
      event.sender.send('flowise:stream-event', { type: 'error', message: 'Генерация отменена пользователем' });
    }
  });

  // Статистика токенов
  ipcMain.handle('flowise:get-token-usage', async () => {
    return new Promise((resolve) => {
      const baseUrl = BACKEND_URL.replace(/\/+$/, '').replace('localhost', '127.0.0.1');
      http.get(`${baseUrl}/api/usage`, { headers: { 'x-session-id': 'global' } }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { resolve(null); }
        });
      }).on('error', () => resolve(null));
    });
  });
}

module.exports = { registerFlowiseHandlers };
