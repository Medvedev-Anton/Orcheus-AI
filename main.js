'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const fsp  = require('fs/promises');
const http  = require('http');
const https = require('https');

// ─── Prettier formatter ──────────────────────────────────────────────────────────────
let prettier = null;
try { prettier = require('prettier'); } catch { /* not installed */ }

const PRETTIER_PARSERS = {
  js: 'babel', jsx: 'babel', mjs: 'babel', cjs: 'babel',
  ts: 'babel', tsx: 'babel',
  css: 'css', scss: 'css', less: 'css',
  html: 'html', htm: 'html',
  json: 'json',
  md: 'markdown',
  yaml: 'yaml', yml: 'yaml',
};

async function formatContent(filename, content) {
  if (!prettier) return content;
  const ext    = filename.split('.').pop().toLowerCase();
  const parser = PRETTIER_PARSERS[ext];
  if (!parser) return content;
  try {
    return await prettier.format(content, {
      parser,
      printWidth:     100,
      tabWidth:       2,
      singleQuote:    true,
      semi:           true,
      trailingComma:  'es5',
    });
  } catch {
    return content; // если не удалось форматировать — оставляем как есть
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

const SETTINGS_FILE = path.join(app.getPath('userData'), 'orcheus-ai-settings.json');

const DEFAULT_SETTINGS = {
  flowiseUrl: process.env.FLOWISE_URL || 'http://localhost:3000',
  flowId:     process.env.FLOW_ID     || '',
  token:      process.env.FLOWISE_TOKEN || '',
  projectRoot: process.env.PROJECT_ROOT || path.join(app.getPath('documents'), 'flowise-projects'),
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) };
    }
  } catch (_) { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function persistSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

// ─── Path safety ──────────────────────────────────────────────────────────────

function safeResolve(projectRoot, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) throw new Error('Пустой путь');
  if (relPath.includes('\0')) throw new Error('Недопустимый символ в пути');
  if (path.isAbsolute(relPath)) throw new Error('Абсолютные пути запрещены');
  const norm = path.normalize(relPath);
  if (norm.startsWith('..') || norm.includes('..' + path.sep)) throw new Error('Выход за пределы PROJECT_ROOT');
  const full = path.resolve(projectRoot, norm);
  const rel  = path.relative(projectRoot, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Небезопасный путь: ' + relPath);
  return full;
}

// ─── Flowise helpers ──────────────────────────────────────────────────────────

function tryParseJson(value) {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function extractFiles(payload) {
  if (Array.isArray(payload)) return payload;

  if (payload?.files) {
    if (Array.isArray(payload.files)) return payload.files;
    const p = tryParseJson(payload.files);
    if (Array.isArray(p)) return p;
    if (Array.isArray(p?.files)) return p.files;
  }
  if (payload?.json) {
    if (Array.isArray(payload.json)) return payload.json;
    if (Array.isArray(payload.json.files)) return payload.json.files;
    const p = tryParseJson(payload.json);
    if (Array.isArray(p)) return p;
    if (Array.isArray(p?.files)) return p.files;
  }
  if (typeof payload?.text === 'string') {
    const p = tryParseJson(payload.text);
    if (Array.isArray(p)) return p;
    if (Array.isArray(p?.files)) return p.files;
  }
  if (payload?.choices?.[0]?.message?.content) {
    const content = payload.choices[0].message.content;
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const p = tryParseJson(match[0]);
      if (Array.isArray(p?.files)) return p.files;
    }
    return [{ name: 'index.html', content }];
  }
  return [{ name: 'index.html', content: '<!-- fallback -->' }];
}

// ─── Flowise API call ─────────────────────────────────────────────────────────

function callFlowise(question, chatId, settings, progressCb) {
  return new Promise((resolve, reject) => {
    const baseUrl = (settings.flowiseUrl || 'http://localhost:3000')
      .replace(/\/+$/, '')
      .replace('localhost', '127.0.0.1');
    const { flowId, token } = settings;

    if (!flowId) return reject(new Error('FLOW_ID не настроен. Откройте настройки.'));
    if (!question?.trim()) return reject(new Error('Пустой вопрос'));

    let parsed;
    try { parsed = new URL(`${baseUrl}/api/v1/prediction/${flowId}`); }
    catch (e) { return reject(new Error('Некорректный Flowise URL: ' + e.message)); }

    const body = JSON.stringify({ question, streaming: false });
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    console.log(`[Flowise] → POST ${baseUrl}/api/v1/prediction/${flowId}`);
    console.log(`[Flowise] Вопрос: ${question.slice(0, 120)}${question.length > 120 ? '...' : ''}`);
    progressCb?.('Подключаемся к Flowise...');

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname,
        method: 'POST',
        headers,
      },
      (res) => {
        progressCb?.(`Запрос отправлен (HTTP ${res.statusCode}), ожидаем ответ...`);
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          console.log(`[Flowise] HTTP ${res.statusCode} | ${text.length} байт`);
          if (res.statusCode !== 200) {
            // Попытаться извлечь читаемое сообщение из JSON-ответа Flowise
            let errMsg = text.slice(0, 500);
            try {
              const errJson = JSON.parse(text);
              if (errJson.message) errMsg = errJson.message;
            } catch { /* raw text */ }
            console.error(`[Flowise] Ошибка ${res.statusCode}:`, errMsg);
            return reject(new Error(errMsg));
          }
          progressCb?.('Обрабатываем ответ...');
          let payload;
          try { payload = JSON.parse(text); }
          catch { payload = { text }; }
          resolve(payload);
        });
      }
    );

    req.on('error', (err) => { console.error('[Flowise] Ошибка соединения:', err.message); reject(err); });
    req.setTimeout(900000, () => {
      req.destroy();
      reject(new Error('Таймаут запроса (15 минут)'));
    });
    req.write(body);
    req.end();
  });
}

// ─── File writing ─────────────────────────────────────────────────────────────

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

// ─── File tree listing ────────────────────────────────────────────────────────

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', '__pycache__', '.idea', '.vscode', 'build', 'out']);

async function listDir(dirPath, relBase) {
  let entries;
  try { entries = await fsp.readdir(dirPath, { withFileTypes: true }); }
  catch { return []; }

  const items = [];
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    const abs = path.join(dirPath, e.name);
    if (e.isDirectory()) {
      items.push({ type: 'dir', name: e.name, path: rel, children: await listDir(abs, rel) });
    } else {
      items.push({ type: 'file', name: e.name, path: rel, fullPath: abs });
    }
  }
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return items;
}

// ─── Window ────────────────────────────────────────────────────────────────────

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Orcheus AI',
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // DevTools по Ctrl+Shift+I
  const { globalShortcut } = require('electron');
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.control && input.shift && input.key === 'I') {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    }
  });
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('settings:load', () => loadSettings());

ipcMain.handle('settings:save', (_e, settings) => {
  persistSettings(settings);
  return { ok: true };
});

ipcMain.handle('flowise:predict', async (event, { question, chatId }) => {
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

ipcMain.handle('files:list', async () => {
  const { projectRoot } = loadSettings();
  try {
    const tree = await listDir(projectRoot, '');
    return { ok: true, tree, root: projectRoot };
  } catch (err) {
    return { ok: false, error: err.message, tree: [], root: projectRoot };
  }
});

ipcMain.handle('files:read', async (_e, filePath) => {
  try {
    const content = await fsp.readFile(filePath, 'utf8');
    return { ok: true, content };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('files:write', async (_e, { filePath, content }) => {
  try {
    const { projectRoot } = loadSettings();
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
});

ipcMain.handle('shell:open-folder', async () => {
  const { projectRoot } = loadSettings();
  try {
    await fsp.mkdir(projectRoot, { recursive: true });
    shell.openPath(projectRoot);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dialog:pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false };
  return { ok: true, path: result.filePaths[0] };
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
