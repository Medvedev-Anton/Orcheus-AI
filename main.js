'use strict';

/**
 * Orcheus AI - Главный процесс Electron
 * Точка входа приложения
 * Requirements: 2.3
 */

// Загрузка переменных окружения из .env файла
// ВАЖНО: должен быть до импорта других модулей!
require('dotenv').config();

const { app, BrowserWindow } = require('electron');
const { createWindow, getMainWindow } = require('./src/main/window');
const { registerSettingsHandlers } = require('./src/main/ipc/settings-handlers');
const { registerAuthHandlers } = require('./src/main/ipc/auth-handlers');
const { registerFlowiseHandlers } = require('./src/main/ipc/flowise-handlers');
const { registerFileHandlers, setMainWindow } = require('./src/main/ipc/file-handlers');
const { registerChatHandlers } = require('./src/main/ipc/chat-handlers');

// Import config service
// Requirements: 2.3
const { loadConfig } = require('./src/main/services/config');

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  // Load configuration from backend before initializing services
  // Requirements: 2.3
  console.log('[Main] Loading configuration from backend...');
  await loadConfig();
  console.log('[Main] Configuration loaded');
  
  const window = createWindow();
  setMainWindow(window);
  
  // Регистрация IPC обработчиков
  registerSettingsHandlers();
  registerAuthHandlers();
  registerFlowiseHandlers();
  registerFileHandlers();
  registerChatHandlers();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWindow = createWindow();
      setMainWindow(newWindow);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
