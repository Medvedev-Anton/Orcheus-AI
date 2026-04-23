/**
 * Форматирование кода через Prettier
 */

const { PRETTIER_PARSERS } = require('../config/constants');

let prettier = null;
try { prettier = require('prettier'); } catch { /* not installed */ }

/**
 * Форматирование содержимого файла
 * @param {string} filename - Имя файла
 * @param {string} content - Содержимое файла
 * @returns {Promise<string>} Отформатированное содержимое
 */
async function formatContent(filename, content) {
  if (!prettier) return content;
  
  const ext = filename.split('.').pop().toLowerCase();
  const parser = PRETTIER_PARSERS[ext];
  if (!parser) return content;
  
  try {
    return await prettier.format(content, {
      parser,
      printWidth: 100,
      tabWidth: 2,
      singleQuote: true,
      semi: true,
      trailingComma: 'es5',
    });
  } catch {
    return content; // если не удалось форматировать — оставляем как есть
  }
}

module.exports = { formatContent };
