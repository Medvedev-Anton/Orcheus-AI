/**
 * Константы приложения
 */

const path = require('path');
const { app } = require('electron');

// Пути к файлам
const SETTINGS_FILE = path.join(app.getPath('userData'), 'orcheus-ai-settings.json');
const SESSION_FILE = path.join(app.getPath('userData'), 'orcheus-ai-session.json');

// Настройки по умолчанию
const DEFAULT_SETTINGS = {
  projectRoot: path.join(app.getPath('documents'), 'orcheus-projects'),
};

// Backend URL (прокси-сервер)
const BACKEND_URL = 'http://localhost:3001';

// Supabase (зашитые ключи — anon key публичный, безопасен для клиента)
const SUPABASE_URL = 'https://bghbeegzxbodmdhbugxm.supabase.co';
const SUPABASE_ANON = 'sb_publishable_cmxhvdZ4RSIAmTSfQ9zFMQ_0ut6D8Fu';

// Prettier парсеры
const PRETTIER_PARSERS = {
  js: 'babel', jsx: 'babel', mjs: 'babel', cjs: 'babel',
  ts: 'babel', tsx: 'babel',
  css: 'css', scss: 'css', less: 'css',
  html: 'html', htm: 'html',
  json: 'json',
  md: 'markdown',
  yaml: 'yaml', yml: 'yaml',
};

// Игнорируемые папки для дерева файлов
const SKIP_FOLDERS = new Set(['node_modules', '.git', '.next', 'dist', '__pycache__', '.idea', '.vscode', 'build', 'out']);

// Таймауты
const FLOWISE_TIMEOUT = 900000; // 15 минут

module.exports = {
  SETTINGS_FILE,
  SESSION_FILE,
  DEFAULT_SETTINGS,
  BACKEND_URL,
  SUPABASE_URL,
  SUPABASE_ANON,
  PRETTIER_PARSERS,
  SKIP_FOLDERS,
  FLOWISE_TIMEOUT,
};
