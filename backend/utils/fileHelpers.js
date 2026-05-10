/**
 * File Helper Utilities for MCP Endpoints
 * Adapted from src/main/services/files.js for backend use
 */

const path = require('path');
const fsp = require('fs/promises');

// SKIP_FOLDERS constant (same as in frontend)
const SKIP_FOLDERS = new Set(['node_modules', '.git', '.next', 'dist', '__pycache__', '.idea', '.vscode', 'build', 'out']);

/**
 * Безопасное разрешение пути (защита от path traversal)
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 * @param {string} projectRoot - Корневая папка проекта
 * @param {string} relPath - Относительный путь
 * @returns {string} Абсолютный путь
 */
function safeResolve(projectRoot, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    throw new Error('Пустой путь');
  }
  if (relPath.includes('\0')) {
    throw new Error('Недопустимый символ в пути');
  }
  if (path.isAbsolute(relPath)) {
    throw new Error('Абсолютные пути запрещены');
  }
  
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
 * Рекурсивное построение дерева файлов
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 14.3
 * @param {string} dirPath - Путь к директории
 * @param {string} relBase - Базовый относительный путь
 * @param {number} currentDepth - Текущая глубина рекурсии
 * @param {number} maxDepth - Максимальная глубина рекурсии (default: 10)
 * @returns {Promise<Array>} Дерево файлов
 */
async function listDir(dirPath, relBase, currentDepth = 0, maxDepth = 10) {
  // Requirement 14.3: Limit recursive depth to 10 levels
  if (currentDepth >= maxDepth) {
    return [];
  }

  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const items = [];
  for (const e of entries) {
    // Requirement 5.4: Skip hidden files (starting with ".")
    // Requirement 5.5: Skip folders defined in SKIP_FOLDERS
    if (e.name.startsWith('.') || SKIP_FOLDERS.has(e.name)) continue;
    
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    const abs = path.join(dirPath, e.name);
    
    if (e.isDirectory()) {
      const children = await listDir(abs, rel, currentDepth + 1, maxDepth);
      items.push({
        type: 'dir',
        name: e.name,
        path: rel,
        fullPath: abs,
        children
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
  
  // Requirement 5.7: Sort results with directories first, then files, alphabetically
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  
  return items;
}

/**
 * Search for text in files recursively
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 14.2
 * @param {string} dirPath - Root directory to search
 * @param {string} query - Search query (case-insensitive)
 * @param {string} filePattern - Optional glob pattern (e.g., "*.js")
 * @param {number} maxResults - Maximum number of results (default: 100)
 * @returns {Promise<Array>} Array of matches
 */
async function searchInFiles(dirPath, query, filePattern = null, maxResults = 100) {
  const matches = [];
  const lowerQuery = query.toLowerCase();
  
  /**
   * Check if filename matches glob pattern
   * Simple glob implementation supporting * and **
   */
  function matchesPattern(filename, pattern) {
    if (!pattern) return true;
    
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(filename);
  }
  
  /**
   * Recursively search directory
   */
  async function searchDir(currentPath, relativePath = '') {
    // Requirement 14.2: Stop if max results reached
    if (matches.length >= maxResults) return;
    
    let entries;
    try {
      entries = await fsp.readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    
    for (const entry of entries) {
      if (matches.length >= maxResults) break;
      
      // Requirement 8.3: Skip hidden files and SKIP_FOLDERS
      if (entry.name.startsWith('.') || SKIP_FOLDERS.has(entry.name)) continue;
      
      const entryPath = path.join(currentPath, entry.name);
      const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      
      if (entry.isDirectory()) {
        // Requirement 8.2: Recursively search subdirectories
        await searchDir(entryPath, entryRelPath);
      } else if (entry.isFile()) {
        // Requirement 8.4: Apply file pattern filter if provided
        if (!matchesPattern(entry.name, filePattern)) continue;
        
        try {
          // Read file content
          const content = await fsp.readFile(entryPath, 'utf8');
          const lines = content.split('\n');
          
          // Requirement 8.5: Perform case-insensitive search
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= maxResults) break;
            
            const line = lines[i];
            const lowerLine = line.toLowerCase();
            
            if (lowerLine.includes(lowerQuery)) {
              // Requirement 8.6: Return match with file, line, lineNumber, match
              matches.push({
                file: entryRelPath,
                line: line,
                lineNumber: i + 1, // 1-indexed
                match: query
              });
            }
          }
        } catch (readError) {
          // Skip files that can't be read (binary files, permission issues, etc.)
          continue;
        }
      }
    }
  }
  
  await searchDir(dirPath);
  return matches;
}

/**
 * Timeout wrapper for async operations
 * Requirements: 14.5, 14.6
 * @param {Promise} promise - Promise to wrap with timeout
 * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
 * @param {string} operationName - Name of operation for error message
 * @returns {Promise} Promise that rejects if timeout exceeded
 */
function withTimeout(promise, timeoutMs = 30000, operationName = 'Operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    })
  ]);
}

module.exports = {
  safeResolve,
  listDir,
  searchInFiles,
  withTimeout,
  SKIP_FOLDERS
};
