/**
 * Работа с файловой системой проекта
 */

const path = require('path');
const fsp = require('fs/promises');
const { SKIP_FOLDERS } = require('../config/constants');
const { formatContent } = require('./formatter');

/**
 * Безопасное разрешение пути (защита от path traversal)
 * @param {string} projectRoot - Корневая папка проекта
 * @param {string} relPath - Относительный путь
 * @returns {string} Абсолютный путь
 */
function safeResolve(projectRoot, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) throw new Error('Пустой путь');
  if (relPath.includes('\0')) throw new Error('Недопустимый символ в пути');
  if (path.isAbsolute(relPath)) throw new Error('Абсолютные пути запрещены');
  
  const norm = path.normalize(relPath);
  if (norm.startsWith('..') || norm.includes('..' + path.sep)) {
    throw new Error('Выход за пределы PROJECT_ROOT');
  }
  
  const full = path.resolve(projectRoot, norm);
  const rel = path.relative(projectRoot, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Небезопасный путь: ' + relPath);
  }
  
  return full;
}

/**
 * Запись файлов проекта
 * @param {string} projectRoot - Корневая папка проекта
 * @param {Array} files - Массив файлов
 * @param {function} progressCb - Callback для прогресса
 * @returns {Promise<Array>} Записанные файлы
 */
async function writeProjectFiles(projectRoot, files, progressCb) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Нет файлов для записи в ответе');
  }
  
  await fsp.mkdir(projectRoot, { recursive: true });
  const written = [];

  for (const f of files) {
    if (!f || typeof f !== 'object') continue;
    if (typeof f.name !== 'string' || !f.name.trim()) continue;
    if (typeof f.content !== 'string') continue;

    const full = safeResolve(projectRoot, f.name);
    await fsp.mkdir(path.dirname(full), { recursive: true });

    // Flowise иногда возвращает литеральные \n \t вместо реальных символов
    let content = f.content;
    if (!content.includes('\n') && content.includes('\\n')) {
      content = content
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '')
        .replace(/\\\\/g, '\\');
    }

    // Авто-форматирование через Prettier
    content = await formatContent(f.name, content);
    progressCb?.(`Оформатирован: ${f.name}`);

    await fsp.writeFile(full, content, 'utf8');
    written.push({ name: f.name, fullPath: full });
    progressCb?.(`Записан: ${f.name}`);
  }

  await fsp.writeFile(
    path.join(projectRoot, '.flowise-manifest.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), files: written }, null, 2),
    'utf8'
  );

  return written;
}

/**
 * Запись одного файла в директорию проекта
 * @param {string} projectRoot - Корневая папка проекта
 * @param {string} name - Относительный путь файла
 * @param {string} content - Содержимое файла
 * @returns {Promise<{ name: string, fullPath: string }>}
 */
async function writeSingleFile(projectRoot, name, content) {
  // Sanitize недопустимых символов в имени
  const safeName = name.replace(/[<>:"|?*\0]/g, '_');
  const full = safeResolve(projectRoot, safeName);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, 'utf8');
  return { name: safeName, fullPath: full };
}

/**
 * Рекурсивное построение дерева файлов
 * @param {string} dirPath - Путь к директории
 * @param {string} relBase - Базовый относительный путь
 * @returns {Promise<Array>} Дерево файлов
 */
async function listDir(dirPath, relBase) {
  let entries;
  try { entries = await fsp.readdir(dirPath, { withFileTypes: true }); }
  catch { return []; }

  const items = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_FOLDERS.has(e.name)) continue;
    
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    const abs = path.join(dirPath, e.name);
    
    if (e.isDirectory()) {
      items.push({
        type: 'dir',
        name: e.name,
        path: rel,
        children: await listDir(abs, rel)
      });
    } else {
      items.push({
        type: 'file',
        name: e.name,
        path: rel,
        fullPath: abs
      });
    }
  }
  
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  
  return items;
}

/**
 * Flatten file tree for Flowise $vars.projectFiles (JSON array of { path, type, name }).
 * @param {Array} nodes - Output of listDir
 * @returns {Array<{path: string, type: string, name: string}>}
 */
function flattenFileTreeForVars(nodes) {
  const out = [];
  if (!Array.isArray(nodes)) return out;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    if (node.path) {
      out.push({
        path: node.path,
        type: node.type === 'dir' ? 'dir' : 'file',
        name: node.name || '',
      });
    }
    if (node.type === 'dir' && Array.isArray(node.children)) {
      out.push(...flattenFileTreeForVars(node.children));
    }
  }
  return out;
}

/**
 * Чтение файла
 * @param {string} filePath - Путь к файлу
 * @returns {Promise<{ok: boolean, content?: string, error?: string}>}
 */
async function readFile(filePath) {
  try {
    const content = await fsp.readFile(filePath, 'utf8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Запись файла
 * @param {string} filePath - Путь к файлу
 * @param {string} content - Содержимое
 * @param {string} projectRoot - Корневая папка проекта
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function writeFile(filePath, content, projectRoot) {
  try {
    const rel = path.relative(projectRoot, filePath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Запись за пределами папки проекта запрещена');
    }
    await fsp.writeFile(filePath, content, 'utf8');
    console.log('[Write]', filePath);
    return { ok: true };
  } catch (err) {
    console.error('[Write ERROR]', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  safeResolve,
  writeProjectFiles,
  writeSingleFile,
  listDir,
  flattenFileTreeForVars,
  readFile,
  writeFile,
};
