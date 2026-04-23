/**
 * Общие утилиты для main и renderer процессов
 */

/**
 * Генерация уникального ID
 * @returns {string} Уникальный ID
 */
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * Экранирование HTML символов
 * @param {string} str - Исходная строка
 * @returns {string} Экранированная строка
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Получение emoji-иконки по расширению файла
 * @param {string} name - Имя файла
 * @returns {string} Emoji иконка
 */
function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    js: '📜', mjs: '📜', cjs: '📜',
    ts: '🔷', tsx: '🔷',
    jsx: '⚛',
    html: '🌐', htm: '🌐',
    css: '🎨', scss: '🎨', sass: '🎨', less: '🎨',
    json: '📋',
    md: '📝',
    svg: '🖼', png: '🖼', jpg: '🖼', gif: '🖼', ico: '🖼',
    py:  '🐍',
    sh:  '⚡', bat: '⚡', ps1: '⚡',
    env: '🔧', yaml: '🔧', yml: '🔧', toml: '🔧',
  };
  return map[ext] || '📄';
}

module.exports = { genId, escapeHtml, fileIcon };
