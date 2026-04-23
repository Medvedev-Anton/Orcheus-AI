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
  flowiseUrl: process.env.FLOWISE_URL || 'http://localhost:3000',
  flowId: process.env.FLOW_ID || '',
  token: process.env.FLOWISE_TOKEN || '',
  projectRoot: process.env.PROJECT_ROOT || path.join(app.getPath('documents'), 'flowise-projects'),
};

// Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY;

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
  SUPABASE_URL,
  SUPABASE_ANON,
  PRETTIER_PARSERS,
  SKIP_FOLDERS,
  FLOWISE_TIMEOUT,
};
