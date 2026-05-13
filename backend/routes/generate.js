/**
 * GET /api/generate/stream endpoint
 * SSE-стриминг для пошаговой генерации файлов
 */

const http = require('http');
const https = require('https');
const path = require('path');
const fsp = require('fs/promises');
const { config, isStreamingConfigured } = require('../config');
const { getUsage } = require('./llmProxy');

/**
 * Отправка SSE-события
 * @param {object} res - Express response
 * @param {object} event - Объект события
 */
function sendEvent(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Sanitize имени файла — замена недопустимых символов
 * @param {string} name - Имя файла
 * @returns {string} Очищенное имя
 */
function sanitizeName(name) {
  return name.replace(/[<>:"|?*\0]/g, '_');
}

/**
 * Безопасное разрешение пути (защита от path traversal)
 */
function safeResolve(projectRoot, relPath) {
  if (typeof relPath !== 'string' || !relPath.trim()) throw new Error('Пустой путь');
  if (relPath.includes('\0')) throw new Error('Недопустимый символ в пути');
  if (path.isAbsolute(relPath)) throw new Error('Абсолютные пути запрещены');
  const norm = path.normalize(relPath);
  if (norm.startsWith('..') || norm.includes('..' + path.sep)) throw new Error('Выход за пределы PROJECT_ROOT');
  const full = path.resolve(projectRoot, norm);
  const rel = path.relative(projectRoot, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Небезопасный путь: ' + relPath);
  return full;
}

/**
 * Запись одного файла в директорию проекта
 */
async function writeSingleFile(projectRoot, name, content) {
  const safeName = sanitizeName(name);
  const full = safeResolve(projectRoot, safeName);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, 'utf8');
  return { name: safeName, fullPath: full };
}

/**
 * Форматирование времени для логов
 * @returns {string} Время в формате HH:MM:SS
 */
function getTimestamp() {
  const now = new Date();
  return now.toTimeString().split(' ')[0]; // HH:MM:SS
}

/**
 * HTTP-запрос к Flowise API
 * @param {string} url - URL эндпоинта
 * @param {object} body - Тело запроса
 * @param {string} token - Токен авторизации
 * @param {object} vars - Динамические переменные (authToken, projectRoot)
 * @param {string} flowName - Название агентфлоу для логов (Planner/Generator)
 * @returns {Promise<object>} Ответ от Flowise
 */
function callFlowiseHttp(url, body, token, vars = {}, flowName = 'Unknown') {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return reject(new Error('Invalid Flowise URL'));
    }

    // Добавляем overrideConfig.vars в body
    const flowisePayload = {
      ...body,
      streaming: false,
      overrideConfig: {
        vars: {
          authToken: vars.authToken || '',
          projectRoot: vars.projectRoot || '',
          projectFiles: vars.projectFiles || '[]',
        }
      }
    };

    const bodyStr = JSON.stringify(flowisePayload);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'Authorization': `Bearer ${token}`
    };

    const startTime = Date.now();
    console.log(`[${getTimestamp()}] [${flowName}] → Запрос к Flowise | Node: Agent 0`);

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname,
        method: 'POST',
        headers,
        timeout: 0
      },
      (flowiseRes) => {
        const chunks = [];
        flowiseRes.on('data', (chunk) => chunks.push(chunk));
        flowiseRes.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          
          if (flowiseRes.statusCode !== 200) {
            console.error(`[${getTimestamp()}] [${flowName}] ✗ Ошибка HTTP ${flowiseRes.statusCode} | Время: ${duration}s`);
            return reject(new Error(`Flowise error ${flowiseRes.statusCode}: ${text.slice(0, 200)}`));
          }

          console.log(`[${getTimestamp()}] [${flowName}] ✓ Ответ получен | Время: ${duration}s | Размер: ${text.length} байт`);

          try {
            const payload = JSON.parse(text);
            resolve(payload);
          } catch (e) {
            resolve({ text });
          }
        });
      }
    );

    req.on('error', (err) => {
      console.error(`[${getTimestamp()}] [${flowName}] ✗ Ошибка соединения: ${err.message}`);
      reject(err);
    });
    req.write(bodyStr);
    req.end();
  });
}

/**
 * Попытка парсинга JSON
 * @param {string} value - Строка для парсинга
 * @returns {object|null}
 */
function tryParseJson(value) {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizePathForCompare(p) {
  if (typeof p !== 'string' || !p.trim()) return '';
  return path.normalize(p.replace(/\\/g, '/')).replace(/^(\.\/)+/, '').toLowerCase();
}

function pathsRoughlyMatch(a, b) {
  const na = normalizePathForCompare(a);
  const nb = normalizePathForCompare(b);
  if (!na || !nb) return false;
  return na === nb || na.endsWith(nb) || nb.endsWith(na);
}

function flattenUsedTools(root) {
  const out = [];
  const seen = new WeakSet();
  function walk(obj, depth) {
    if (depth > 25 || obj == null || typeof obj !== 'object') return;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (Array.isArray(obj.usedTools)) out.push(...obj.usedTools);
    if (Array.isArray(obj.used_tools)) out.push(...obj.used_tools);
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item, depth + 1);
    } else {
      for (const k of Object.keys(obj)) {
        if (k === 'usedTools' || k === 'used_tools') continue;
        walk(obj[k], depth + 1);
      }
    }
  }
  walk(root, 0);
  return out;
}

function getToolInputs(tool) {
  if (!tool || typeof tool !== 'object') return null;
  return tool.toolInput || tool.tool_input || tool.args || tool.parameters || tool.input || null;
}

/**
 * Flowise often puts MCP result in toolOutput as a JSON string:
 * {"success":true,"action":"write_file","path":"index.html","content":"<!DOCTYPE..."}
 * Prefer this over toolInput when both exist (proper newlines / escaping).
 */
function parseWriteFileToolOutput(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const content = raw.content;
    const p = raw.path;
    if (
      typeof content === 'string'
      && content.length
      && typeof p === 'string'
      && p.trim()
      && (raw.action === 'write_file' || raw.success === true)
    ) {
      return { path: p, content };
    }
    return null;
  }
  if (typeof raw !== 'string') return null;
  const parsed = tryParseJson(raw.trim());
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.content !== 'string' || !parsed.content.length) return null;
  if (typeof parsed.path !== 'string' || !parsed.path.trim()) return null;
  if (parsed.action === 'write_file' || parsed.success === true) {
    return { path: parsed.path, content: parsed.content };
  }
  return null;
}

/**
 * Flowise returns agent prose in `text` but real code in tool records (toolInput / toolOutput).
 */
function extractFromUsedTools(generatorResponse, expectedFileName) {
  const tools = flattenUsedTools(generatorResponse);
  const safeExpected = sanitizeName(expectedFileName);
  const pathMatches = [];
  const writeLike = [];
  for (const tool of tools) {
    const toolName = String(tool.tool || tool.name || '').toLowerCase();
    const fromOut = parseWriteFileToolOutput(tool.toolOutput ?? tool.tool_output);
    const inputs = getToolInputs(tool);

    let fromInput = null;
    if (inputs && typeof inputs === 'object') {
      const p = inputs.path || inputs.filePath || inputs.file;
      const c = inputs.content;
      if (typeof p === 'string' && p.trim() && typeof c === 'string' && c.length) {
        fromInput = { path: p, content: c };
      }
    }

    let entry = null;
    if (fromOut && fromInput && pathsRoughlyMatch(fromOut.path, fromInput.path)) {
      entry = { path: fromInput.path, content: fromOut.content };
    } else if (fromOut && pathsRoughlyMatch(fromOut.path, safeExpected)) {
      entry = fromOut;
    } else if (fromInput && pathsRoughlyMatch(fromInput.path, safeExpected)) {
      entry = fromInput;
    } else if (fromOut && (toolName.includes('write') || toolName.includes('project'))) {
      entry = fromOut;
    } else if (fromInput && (toolName.includes('write') || toolName.includes('project'))) {
      entry = fromInput;
    }

    if (!entry) continue;

    if (pathsRoughlyMatch(entry.path, safeExpected)) pathMatches.push(entry);
    if (toolName.includes('write') || toolName.includes('project')) writeLike.push(entry);
  }
  if (pathMatches.length === 1) return pathMatches[0];
  if (pathMatches.length > 1) {
    const exact = pathMatches.find((m) => normalizePathForCompare(m.path) === normalizePathForCompare(safeExpected));
    return exact || pathMatches[0];
  }
  if (writeLike.length === 1) return writeLike[0];
  return null;
}

/**
 * Any nested { path, content } matching the planned file (some Flowise versions omit usedTools shape).
 */
function extractPathContentPair(generatorResponse, expectedFileName) {
  const safeExpected = sanitizeName(expectedFileName);
  const matches = [];
  const seen = new WeakSet();
  function walk(obj, depth) {
    if (depth > 25 || obj == null || typeof obj !== 'object') return;
    if (seen.has(obj)) return;
    seen.add(obj);
    if (
      typeof obj.path === 'string'
      && typeof obj.content === 'string'
      && obj.content.length > 0
      && pathsRoughlyMatch(obj.path, safeExpected)
    ) {
      matches.push({ path: obj.path, content: obj.content });
    }
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item, depth + 1);
    } else {
      for (const k of Object.keys(obj)) walk(obj[k], depth + 1);
    }
  }
  walk(generatorResponse, 0);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const exact = matches.find((m) => normalizePathForCompare(m.path) === normalizePathForCompare(safeExpected));
    return exact || matches[0];
  }
  return null;
}

function deepFindWriteFilePayload(obj, depth = 0) {
  if (depth > 25 || obj == null) return null;
  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const content = obj.content;
    const p = obj.path;
    if (
      typeof content === 'string'
      && content.length
      && typeof p === 'string'
      && p.trim()
      && (obj.action === 'write_file' || obj.success === true)
    ) {
      return { path: p, content };
    }
  }
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const r = deepFindWriteFilePayload(item, depth + 1);
      if (r) return r;
    }
  } else if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const r = deepFindWriteFilePayload(obj[k], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function extractCodeFenceFromText(text, fileName) {
  if (typeof text !== 'string') return null;
  const ext = path.extname(fileName || '').toLowerCase();
  const langByExt = {
    '.html': ['html', 'htm'],
    '.htm': ['html'],
    '.css': ['css'],
    '.js': ['javascript', 'js'],
    '.ts': ['typescript', 'ts'],
    '.tsx': ['tsx', 'typescript'],
    '.jsx': ['jsx', 'javascript'],
    '.json': ['json'],
    '.md': ['markdown', 'md'],
  };
  const langs = langByExt[ext] || [];
  for (const lang of langs) {
    const re = new RegExp('```\\s*' + lang + '\\s*\\n([\\s\\S]*?)```', 'i');
    const m = text.match(re);
    if (m) return m[1].trim();
  }
  const generic = /```(?:[a-z0-9+#]+)?\s*\n([\s\S]*?)```/i;
  const gm = text.match(generic);
  return gm ? gm[1].trim() : null;
}

function looksLikeNaturalLanguageSummary(s) {
  if (typeof s !== 'string' || s.length < 40) return false;
  const t = s.trimStart();
  if (/^Файл\s*`/.test(t)) return true;
  if (/^The file\s+/i.test(t)) return true;
  if (/^Successfully\s+(created|written)/i.test(t)) return true;
  if (/\*\*DOCTYPE\*\*/i.test(t)) return true;
  if (/минимальный\s+HTML/i.test(t)) return true;
  if (/следующей\s+структурой/i.test(t)) return true;
  return false;
}

function textLooksLikeSourceCode(s) {
  if (typeof s !== 'string') return false;
  const t = s.trimStart();
  if (/<!DOCTYPE/i.test(t)) return true;
  if (/<html[\s>]/i.test(t)) return true;
  if (/^\s*\/\//.test(t)) return true;
  if (/^\s*import\s+/.test(t)) return true;
  if (/^\s*export\s+/.test(t)) return true;
  if (/^\s*function\s+/.test(t)) return true;
  if (/^\s*class\s+/.test(t)) return true;
  return false;
}

/**
 * Real file bytes from Generator prediction — never prefer agent `text` over tool inputs.
 * @param {object|string} generatorResponse
 * @param {string} expectedFileName
 * @returns {{ path: string, content: string }|null}
 */
function extractGeneratorFilePayload(generatorResponse, expectedFileName) {
  const safeExpected = sanitizeName(expectedFileName);

  if (typeof generatorResponse === 'string') {
    try {
      const parsed = JSON.parse(generatorResponse);
      return extractGeneratorFilePayload(parsed, safeExpected);
    } catch {
      if (!looksLikeNaturalLanguageSummary(generatorResponse)) {
        return { path: safeExpected, content: generatorResponse };
      }
      return null;
    }
  }

  if (!generatorResponse || typeof generatorResponse !== 'object') return null;

  if (
    typeof generatorResponse.content === 'string'
    && generatorResponse.content.length
    && (generatorResponse.action === 'write_file' || generatorResponse.success === true)
  ) {
    return {
      path: sanitizeName(generatorResponse.path || safeExpected),
      content: generatorResponse.content,
    };
  }

  const fromTools = extractFromUsedTools(generatorResponse, safeExpected);
  if (fromTools) {
    return { path: sanitizeName(fromTools.path), content: fromTools.content };
  }

  const pair = extractPathContentPair(generatorResponse, safeExpected);
  if (pair) {
    return { path: sanitizeName(pair.path), content: pair.content };
  }

  const deep = deepFindWriteFilePayload(generatorResponse);
  if (deep && typeof deep.content === 'string') {
    return {
      path: sanitizeName(deep.path || safeExpected),
      content: deep.content,
    };
  }

  if (generatorResponse.json != null) {
    const j = typeof generatorResponse.json === 'string'
      ? tryParseJson(generatorResponse.json)
      : generatorResponse.json;
    if (j) {
      const nested = extractGeneratorFilePayload(j, safeExpected);
      if (nested) return nested;
    }
  }

  if (typeof generatorResponse.text === 'string') {
    const fenced = extractCodeFenceFromText(generatorResponse.text, safeExpected);
    if (fenced) return { path: safeExpected, content: fenced };
  }

  if (typeof generatorResponse.content === 'string' && generatorResponse.content.length && !generatorResponse.text) {
    if (!looksLikeNaturalLanguageSummary(generatorResponse.content)) {
      return { path: safeExpected, content: generatorResponse.content };
    }
  }

  if (typeof generatorResponse.text === 'string') {
    const t = generatorResponse.text;
    if (textLooksLikeSourceCode(t) && !looksLikeNaturalLanguageSummary(t)) {
      return { path: safeExpected, content: t };
    }
  }

  return null;
}

/**
 * Извлечение JSON из markdown code blocks
 * @param {string} text - Строка, которая может содержать markdown code blocks
 * @returns {string} Извлечённый JSON или исходная строка
 */
function extractJsonFromMarkdown(text) {
  if (typeof text !== 'string') return text;
  
  // Regex для поиска markdown code blocks
  // Паттерн: ``` + optional language (json|javascript|js) + newline + content + newline + ```
  const codeBlockRegex = /```(?:json|javascript|js)?\s*\n([\s\S]*?)\n```/g;
  
  const matches = [];
  let match;
  
  // Собираем все совпадения
  while ((match = codeBlockRegex.exec(text)) !== null) {
    matches.push(match[1].trim());
  }
  
  // Если нет markdown блоков, возвращаем исходную строку
  if (matches.length === 0) {
    return text;
  }
  
  // Пробуем каждый найденный блок
  for (const content of matches) {
    // Проверяем, является ли содержимое валидным JSON
    if (tryParseJson(content) !== null) {
      return content; // Возвращаем первый валидный JSON
    }
  }
  
  // Если ни один блок не содержит валидный JSON, возвращаем исходную строку
  return text;
}

/**
 * Extract first balanced JSON value starting at openCh (handles prose before `[` or `{`).
 */
function extractFirstBalancedJson(text, openCh, closeCh) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf(openCh);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\' && inString) {
      escape = true;
      continue;
    }
    if (c === '"' && !escape) {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) {
        const slice = text.slice(start, i + 1);
        try {
          return JSON.parse(slice);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Planner output: prose + JSON array, or fenced JSON, or { "files": [...] }.
 */
function extractPlanFilesFromText(text) {
  if (typeof text !== 'string') return null;

  const fromMd = extractJsonFromMarkdown(text);
  let parsed = tryParseJson(fromMd);
  if (parsed?.files && Array.isArray(parsed.files)) return parsed.files;
  if (Array.isArray(parsed)) return parsed;

  parsed = tryParseJson(text.trim());
  if (parsed?.files && Array.isArray(parsed.files)) return parsed.files;
  if (Array.isArray(parsed)) return parsed;

  const fromArray = extractFirstBalancedJson(text, '[', ']');
  if (Array.isArray(fromArray)) return fromArray;

  const fromObj = extractFirstBalancedJson(text, '{', '}');
  if (fromObj?.files && Array.isArray(fromObj.files)) return fromObj.files;

  return null;
}

/**
 * Нормализует один элемент плана к { name, description, action }
 * Поддерживает разные варианты ключей от LLM
 */
function normalizeFileEntry(item) {
  if (!item || typeof item !== 'object') return null;
  
  // Ищем поле с именем файла
  const name = item.name || item.fileName || item.file_name || item.filename || item.path || item.filePath;
  if (!name || typeof name !== 'string') return null;
  
  // Ищем поле с описанием
  const description = item.description || item.desc || item.purpose || item.content || '';
  
  // Ищем поле с действием (create или edit)
  const action = item.action || 'create'; // По умолчанию create для обратной совместимости
  
  return { 
    name: name.trim(), 
    description: String(description),
    action: action === 'edit' ? 'edit' : 'create' // Валидация: только create или edit
  };
}

/**
 * Парсинг Generation_Plan из ответа Flowise
 * @param {object} payload - Ответ от Planner Flow
 * @returns {Array<{name: string, description: string, action: string}>}
 */
function parsePlan(payload) {
  let rawFiles = null;

  // Прямой объект с files
  if (payload?.files && Array.isArray(payload.files)) {
    rawFiles = payload.files;
  }
  // Текст: markdown, чистый JSON, или проза + массив [...]
  else if (typeof payload?.text === 'string') {
    rawFiles = extractPlanFilesFromText(payload.text);
  }
  // Поле json
  else if (payload?.json != null) {
    const extracted = typeof payload.json === 'string' ? extractJsonFromMarkdown(payload.json) : payload.json;
    if (typeof extracted === 'string') {
      rawFiles = extractPlanFilesFromText(extracted);
    } else if (extracted?.files && Array.isArray(extracted.files)) {
      rawFiles = extracted.files;
    } else if (Array.isArray(extracted)) {
      rawFiles = extracted;
    }
  }
  // JSON-строка в поле files (строка)
  else if (typeof payload?.files === 'string') {
    const parsed = tryParseJson(payload.files);
    if (Array.isArray(parsed)) rawFiles = parsed;
    else if (parsed?.files && Array.isArray(parsed.files)) rawFiles = parsed.files;
  }

  if (!rawFiles || rawFiles.length === 0) {
    // Дополнительная диагностика для отладки
    console.error('[PLANNER] Не удалось найти массив файлов. Структура ответа:', JSON.stringify(payload, null, 2).slice(0, 500));
    throw new Error('Invalid plan format: missing or invalid "files" array');
  }

  // Нормализуем каждый элемент
  const normalized = rawFiles.map(normalizeFileEntry).filter(Boolean);
  if (normalized.length === 0) {
    throw new Error(`Plan files have unexpected structure. First item keys: ${Object.keys(rawFiles[0] || {}).join(', ')}`);
  }

  return normalized;
}

/**
 * GET /api/generate/stream
 * SSE-эндпоинт для потоковой генерации
 */
async function generateStreamHandler(req, res, next) {
  try {
    // Установка SSE-заголовков
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Флаг отмены
    let aborted = false;
    req.on('close', () => {
      aborted = true;
      console.log(`[${getTimestamp()}] [GENERATE] ⚠ Клиент отключился`);
    });

    // Проверка конфигурации
    if (!isStreamingConfigured) {
      sendEvent(res, { type: 'error', message: 'Streaming generation is not configured' });
      return res.end();
    }

    // Валидация параметров
    const { question, chatId } = req.query;
    if (!question || typeof question !== 'string' || !question.trim()) {
      sendEvent(res, { type: 'error', message: 'Пустой вопрос' });
      return res.end();
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${getTimestamp()}] [GENERATE] 🚀 Начало генерации проекта`);
    console.log(`[${getTimestamp()}] [GENERATE] User: ${req.user?.id || 'unknown'}`);
    console.log(`[${getTimestamp()}] [GENERATE] Запрос: ${question.slice(0, 100)}${question.length > 100 ? '...' : ''}`);
    console.log(`${'='.repeat(80)}\n`);

    // projectRoot передаётся клиентом в query
    const projectRoot = req.query.projectRoot;
    if (!projectRoot || typeof projectRoot !== 'string' || !projectRoot.trim()) {
      sendEvent(res, { type: 'error', message: 'Не указана папка проекта (projectRoot)' });
      return res.end();
    }

    const projectFiles =
      typeof req.query.projectFiles === 'string' && req.query.projectFiles.trim()
        ? req.query.projectFiles
        : '[]';

    // Подготовка динамических переменных для Flowise
    const authToken = req.headers.authorization?.replace('Bearer ', '') || '';
    const vars = {
      authToken,
      projectRoot,
      projectFiles,
    };

    console.log(`[${getTimestamp()}] [GENERATE] Variables: authToken=${authToken ? 'set' : 'missing'}, projectRoot=${projectRoot}, projectFiles bytes=${projectFiles.length}`);

    // Этап 1: Планирование
    console.log(`\n[${getTimestamp()}] [PLANNER] 📋 Этап 1: Планирование проекта`);
    sendEvent(res, { type: 'status', message: 'Планируем проект...' });

    const baseUrl = config.flowiseUrl.replace(/\/+$/, '');
    const plannerUrl = `${baseUrl}/api/v1/prediction/${config.plannerFlowId}`;

    let plan;
    try {
      const plannerResponse = await callFlowiseHttp(plannerUrl, { question, chatId }, config.flowiseToken, vars, 'PLANNER');
      console.log(`[${getTimestamp()}] [PLANNER] Ответ получен, парсинг плана...`);
      const files = parsePlan(plannerResponse);
      
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error('Plan contains no files');
      }

      plan = files;
      console.log(`[${getTimestamp()}] [PLANNER] ✓ План создан: ${plan.length} файлов`);
      plan.forEach((f, i) => {
        const actionIcon = f.action === 'edit' ? '✏️' : '➕';
        console.log(`[${getTimestamp()}] [PLANNER]   ${i + 1}. ${actionIcon} ${f.name} (${f.action}) - ${f.description?.slice(0, 60) || 'без описания'}`);
      });
      sendEvent(res, { type: 'plan', files: plan });
    } catch (err) {
      console.error(`[${getTimestamp()}] [PLANNER] ✗ Ошибка планирования: ${err.message}`);
      sendEvent(res, { type: 'error', message: `Ошибка планирования: ${err.message}` });
      return res.end();
    }

    // Этап 2: Генерация файлов
    console.log(`\n[${getTimestamp()}] [GENERATOR] 📝 Этап 2: Генерация файлов (${plan.length} шт.)`);
    const generatorUrl = `${baseUrl}/api/v1/prediction/${config.generatorFlowId}`;
    const writtenFiles = [];

    for (let i = 0; i < plan.length; i++) {
      const fileSpec = plan[i];
      if (aborted) {
        console.log(`[${getTimestamp()}] [GENERATOR] ⚠ Генерация отменена клиентом`);
        break;
      }

      const fileName = sanitizeName(fileSpec.name);
      const action = fileSpec.action || 'create';
      console.log(`\n[${getTimestamp()}] [GENERATOR] 📄 Файл ${i + 1}/${plan.length}: ${fileName} (${action})`);
      sendEvent(res, { type: 'file_start', name: fileName, action });

      try {
        // Генерация файла с указанием action
        const generatorQuestion = `Action: ${action}\nFile: ${fileName}\nDescription: ${fileSpec.description || ''}\nContext: ${question}`;
        const generatorResponse = await callFlowiseHttp(generatorUrl, { question: generatorQuestion }, config.flowiseToken, vars, `GENERATOR [${fileName}]`);

        const extracted = extractGeneratorFilePayload(generatorResponse, fileName);
        if (!extracted || typeof extracted.content !== 'string') {
          throw new Error(
            `Generator did not return file content for ${fileName}. ` +
            'Expected write_project_file tool args (path + content), fenced code in the reply, or JSON action write_file.'
          );
        }

        const result = {
          name: extracted.path || fileName,
          content: extracted.content,
        };
        writtenFiles.push(result);

        console.log(`[${getTimestamp()}] [GENERATOR] ✓ Файл сгенерирован: ${result.name} (${result.content.length} байт)`);
        sendEvent(res, { type: 'file_done', name: result.name, content: result.content });
      } catch (err) {
        console.error(`[${getTimestamp()}] [GENERATOR] ✗ Ошибка файла ${fileName}: ${err.message}`);
        sendEvent(res, { type: 'error', message: `Ошибка файла ${fileName}: ${err.message}` });
        // Продолжаем генерацию следующих файлов
      }
    }

    // Завершение
    if (!aborted) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`[${getTimestamp()}] [GENERATE] ✅ Генерация завершена | Создано файлов: ${writtenFiles.length}/${plan.length}`);
      console.log(`${'='.repeat(80)}\n`);
      const usage = getUsage('global');
      sendEvent(res, { type: 'done', files: writtenFiles, tokenUsage: usage });
    }

    res.end();
  } catch (err) {
    console.error('[Generate] Unexpected error:', err);
    if (!res.headersSent) {
      next(err);
    } else {
      sendEvent(res, { type: 'error', message: 'Внутренняя ошибка сервера' });
      res.end();
    }
  }
}

module.exports = { generateStreamHandler };
