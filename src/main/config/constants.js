/**
 * Константы приложения
 * Requirements: 1.5
 * 
 * ВАЖНО: Секреты больше не хранятся в клиентском коде!
 * Supabase ключи загружаются с backend через /api/config endpoint.
 * Fallback значения используются только для offline режима разработки.
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
// Requirements: 1.5
// Может быть переопределён через переменную окружения BACKEND_URL
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

// ─── FALLBACK Supabase Configuration ───
// ВАЖНО: Эти значения используются ТОЛЬКО как fallback при offline режиме!
// Основная конфигурация загружается с backend через /api/config
// Requirements: 2.4
const SUPABASE_URL_FALLBACK = 'https://bghbeegzxbodmdhbugxm.supabase.co';
const SUPABASE_ANON_FALLBACK = 'sb_publishable_cmxhvdZ4RSIAmTSfQ9zFMQ_0ut6D8Fu';

// Экспортируем fallback значения для использования в config service
const SUPABASE_URL = SUPABASE_URL_FALLBACK;
const SUPABASE_ANON = SUPABASE_ANON_FALLBACK;

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
const FLOWISE_TIMEOUT = 0; // Без таймаута — AgentFlow может работать долго

module.exports = {
  SETTINGS_FILE,
  SESSION_FILE,
  DEFAULT_SETTINGS,
  BACKEND_URL,
  // Fallback значения (используются только при offline режиме)
  SUPABASE_URL,
  SUPABASE_ANON,
  PRETTIER_PARSERS,
  SKIP_FOLDERS,
  FLOWISE_TIMEOUT,
};
