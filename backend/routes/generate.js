/**
 * GET/POST /api/generate/stream endpoint
 * SSE streaming for stepwise file generation.
 * POST JSON body is preferred so projectFiles is not truncated by URL limits.
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
        },
        // ВАЖНО: Также передаём через state для доступа в Custom Tools
        state: {
          projectFiles: vars.projectFiles || '[]',
          projectRoot: vars.projectRoot || '',
        }
      }
    };

    const bodyStr = JSON.stringify(flowisePayload);
    
    // Детальное логирование для отладки
    console.log(`[${flowName}] Flowise payload keys:`, Object.keys(flowisePayload));
    console.log(`[${flowName}] overrideConfig:`, JSON.stringify(flowisePayload.overrideConfig, null, 2));
    
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
    else if (typeof obj.usedTools === 'string' && obj.usedTools.trim()) {
      const parsed = tryParseJson(obj.usedTools);
      if (Array.isArray(parsed)) out.push(...parsed);
    }
    if (Array.isArray(obj.used_tools)) out.push(...obj.used_tools);
    else if (typeof obj.used_tools === 'string' && obj.used_tools.trim()) {
      const parsed = tryParseJson(obj.used_tools);
      if (Array.isArray(parsed)) out.push(...parsed);
    }
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

/**
 * Flowise AgentFlow v2 keeps usedTools inside agentFlowExecutedData[].data.output,
 * not at the top level of the prediction response.
 */
function collectUsedToolsFromResponse(generatorResponse) {
  const out = [];
  const pushAll = (items) => {
    if (Array.isArray(items)) out.push(...items);
  };

  pushAll(generatorResponse?.usedTools);
  pushAll(tryParseJson(generatorResponse?.usedTools));

  const execData = generatorResponse?.agentFlowExecutedData;
  if (Array.isArray(execData)) {
    for (const node of execData) {
      const output = node?.data?.output;
      if (!output || typeof output !== 'object') continue;
      pushAll(output.usedTools);
      pushAll(tryParseJson(output.usedTools));
      pushAll(output.used_tools);
      pushAll(tryParseJson(output.used_tools));
    }
  }

  pushAll(flattenUsedTools(generatorResponse));
  return out;
}

function extractWriteEntryFromTool(tool, expectedFileName) {
  const toolName = String(tool?.tool || tool?.name || '').toLowerCase();
  const fromOut = parseWriteFileToolOutput(tool?.toolOutput ?? tool?.tool_output);
  const inputs = getToolInputs(tool);

  let fromInput = null;
  if (inputs && typeof inputs === 'object') {
    const p = inputs.path || inputs.filePath || inputs.file;
    const c = inputs.content;
    if (typeof p === 'string' && p.trim() && typeof c === 'string' && c.length) {
      fromInput = { path: p, content: c };
    }
  }

  const safeExpected = expectedFileName ? sanitizeName(expectedFileName) : '';

  if (fromOut && fromInput && pathsRoughlyMatch(fromOut.path, fromInput.path)) {
    return { path: fromInput.path, content: fromOut.content };
  }
  if (fromOut && (!safeExpected || pathsRoughlyMatch(fromOut.path, safeExpected))) {
    return fromOut;
  }
  if (fromInput && (!safeExpected || pathsRoughlyMatch(fromInput.path, safeExpected))) {
    return fromInput;
  }
  if (fromOut && (toolName.includes('write') || toolName.includes('project'))) {
    return fromOut;
  }
  if (fromInput && (toolName.includes('write') || toolName.includes('project'))) {
    return fromInput;
  }
  return null;
}

function extractFromToolRoleMessages(generatorResponse) {
  const results = [];
  const seen = new WeakSet();
  function walk(obj, depth) {
    if (depth > 25 || obj == null || typeof obj !== 'object') return;
    if (seen.has(obj)) return;
    seen.add(obj);

    if (obj.role === 'tool') {
      const toolName = String(obj.name || obj.tool || '').toLowerCase();
      if (toolName.includes('write') || toolName.includes('project')) {
        const parsed = parseWriteFileToolOutput(obj.content ?? obj.toolOutput ?? obj.tool_output);
        if (parsed) results.push(parsed);
      }
    }

    if (Array.isArray(obj)) {
      for (const item of obj) walk(item, depth + 1);
    } else {
      for (const k of Object.keys(obj)) walk(obj[k], depth + 1);
    }
  }
  walk(generatorResponse, 0);
  return results;
}

function collectAllWriteFilePayloads(generatorResponse) {
  const results = [];
  const seenPaths = new Set();

  function add(entry) {
    if (!entry || typeof entry.content !== 'string' || !entry.content.length) return;
    if (typeof entry.path !== 'string' || !entry.path.trim()) return;
    const key = normalizePathForCompare(entry.path);
    if (!key || seenPaths.has(key)) return;
    seenPaths.add(key);
    results.push({ path: sanitizeName(entry.path), content: entry.content });
  }

  for (const tool of collectUsedToolsFromResponse(generatorResponse)) {
    add(extractWriteEntryFromTool(tool));
  }

  for (const msg of extractFromToolRoleMessages(generatorResponse)) {
    add(msg);
  }

  const seenDeep = new WeakSet();
  function walkWritePayloads(obj, depth) {
    if (depth > 25 || obj == null || typeof obj !== 'object') return;
    if (seenDeep.has(obj)) return;
    seenDeep.add(obj);

    if (
      typeof obj.path === 'string'
      && typeof obj.content === 'string'
      && obj.content.length
      && (obj.action === 'write_file' || obj.success === true)
    ) {
      add({ path: obj.path, content: obj.content });
    }

    if (Array.isArray(obj)) {
      for (const item of obj) walkWritePayloads(item, depth + 1);
    } else {
      for (const k of Object.keys(obj)) walkWritePayloads(obj[k], depth + 1);
    }
  }
  walkWritePayloads(generatorResponse, 0);

  return results;
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
  
  // Логирование для отладки
  console.log(`[DEBUG] parseWriteFileToolOutput: raw type=${typeof raw}, length=${raw.length}, first 200 chars:`, raw.slice(0, 200));
  
  const parsed = tryParseJson(raw.trim());
  if (!parsed || typeof parsed !== 'object') {
    console.log(`[DEBUG] parseWriteFileToolOutput: JSON parse failed or not an object`);
    return null;
  }
  if (typeof parsed.content !== 'string' || !parsed.content.length) {
    console.log(`[DEBUG] parseWriteFileToolOutput: content is not a string or empty. content type=${typeof parsed.content}`);
    return null;
  }
  if (typeof parsed.path !== 'string' || !parsed.path.trim()) {
    console.log(`[DEBUG] parseWriteFileToolOutput: path is not a string or empty. path type=${typeof parsed.path}`);
    return null;
  }
  if (parsed.action === 'write_file' || parsed.success === true) {
    console.log(`[DEBUG] parseWriteFileToolOutput: SUCCESS! Returning path=${parsed.path}, content length=${parsed.content.length}`);
    return { path: parsed.path, content: parsed.content };
  }
  console.log(`[DEBUG] parseWriteFileToolOutput: action/success check failed. action=${parsed.action}, success=${parsed.success}`);
  return null;
}

/**
 * Flowise returns agent prose in `text` but real code in tool records (toolInput / toolOutput).
 */
function extractFromUsedTools(generatorResponse, expectedFileName) {
  const tools = collectUsedToolsFromResponse(generatorResponse);
  const safeExpected = sanitizeName(expectedFileName);
  const pathMatches = [];
  const writeLike = [];
  for (const tool of tools) {
    const toolName = String(tool.tool || tool.name || '').toLowerCase();
    const entry = extractWriteEntryFromTool(tool, safeExpected);
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
  // Removed problematic DOCTYPE check that was matching HTML code
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

  const payloadsFromTools = collectAllWriteFilePayloads(generatorResponse);
  const payloadMatch = payloadsFromTools.find((p) => pathsRoughlyMatch(p.path, safeExpected));
  if (payloadMatch) {
    return { path: payloadMatch.path, content: payloadMatch.content };
  }
  if (payloadsFromTools.length === 1 && !safeExpected) {
    return payloadsFromTools[0];
  }

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
 * GET/POST /api/generate/stream — SSE stream
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

    // ─── Keep-alive ping для предотвращения разрыва соединения DPI/прокси ───
    // Отправляем пустой комментарий каждые 15 секунд
    // Это стандартное решение для SSE за корпоративными прокси и в сетях с DPI
    const keepAliveInterval = setInterval(() => {
      if (aborted || res.writableEnded) {
        clearInterval(keepAliveInterval);
        return;
      }
      res.write(': keep-alive\n\n');
    }, 15000);

    // Проверка конфигурации
    if (!isStreamingConfigured) {
      clearInterval(keepAliveInterval);
      sendEvent(res, { type: 'error', message: 'Streaming generation is not configured' });
      return res.end();
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const question = String(body.question ?? req.query.question ?? '').trim();
    const chatId = body.chatId ?? req.query.chatId ?? '';
    const projectRoot = String(body.projectRoot ?? req.query.projectRoot ?? '').trim();

    let projectFiles = '[]';
    if (body.projectFiles != null) {
      if (typeof body.projectFiles === 'string' && body.projectFiles.length > 0) {
        projectFiles = body.projectFiles;
      } else if (typeof body.projectFiles === 'object') {
        projectFiles = JSON.stringify(body.projectFiles);
      }
    } else if (typeof req.query.projectFiles === 'string' && req.query.projectFiles.trim()) {
      projectFiles = req.query.projectFiles;
    }

    if (!question) {
      clearInterval(keepAliveInterval);
      sendEvent(res, { type: 'error', message: 'Пустой вопрос' });
      return res.end();
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${getTimestamp()}] [GENERATE] 🚀 Начало генерации проекта`);
    console.log(`[${getTimestamp()}] [GENERATE] User: ${req.user?.id || 'unknown'}`);
    console.log(`[${getTimestamp()}] [GENERATE] Запрос: ${question.slice(0, 100)}${question.length > 100 ? '...' : ''}`);
    console.log(`[${getTimestamp()}] [GENERATE] Transport: ${req.method}, projectFiles source: ${body.projectFiles != null ? 'body' : (typeof req.query.projectFiles === 'string' && req.query.projectFiles.trim() ? 'query' : 'default')}`);
    console.log(`${'='.repeat(80)}\n`);

    if (!projectRoot) {
      sendEvent(res, { type: 'error', message: 'Не указана папка проекта (projectRoot)' });
      return res.end();
    }

    // Подготовка динамических переменных для Flowise
    const authToken = req.headers.authorization?.replace('Bearer ', '') || '';
    
    // Парсим projectFiles для добавления в system prompt
    let projectFilesList = '';
    try {
      const parsed = JSON.parse(projectFiles);
      if (Array.isArray(parsed) && parsed.length > 0) {
        projectFilesList = '\n\n=== EXISTING PROJECT FILES ===\n' + 
          parsed.map(f => `${f.path} (${f.type})`).join('\n') +
          '\n=== END OF PROJECT FILES ===\n';
      }
    } catch (e) {
      console.warn(`[${getTimestamp()}] [GENERATE] Failed to parse projectFiles for system prompt`);
    }
    
    const vars = {
      authToken,
      projectRoot,
      projectFiles,
      projectFilesList, // Добавляем список файлов для system prompt
    };

    console.log(`[${getTimestamp()}] [GENERATE] Variables: authToken=${authToken ? 'set' : 'missing'}, projectRoot=${projectRoot}, projectFiles bytes=${projectFiles.length}`);
    
    // Логирование содержимого projectFiles для отладки
    try {
      const parsed = JSON.parse(projectFiles);
      console.log(`[${getTimestamp()}] [GENERATE] projectFiles parsed: ${Array.isArray(parsed) ? parsed.length : 'not array'} items`);
      if (Array.isArray(parsed) && parsed.length > 0) {
        console.log(`[${getTimestamp()}] [GENERATE] First 5 files:`, parsed.slice(0, 5).map(f => f.path || f.name || f));
      }
    } catch (e) {
      console.error(`[${getTimestamp()}] [GENERATE] Failed to parse projectFiles:`, e.message);
    }

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
    const writtenNames = new Set();

    function isFileAlreadyWritten(fileName) {
      return writtenNames.has(normalizePathForCompare(sanitizeName(fileName)));
    }

    function recordWrittenFile(result) {
      const name = sanitizeName(result.name);
      const key = normalizePathForCompare(name);
      if (writtenNames.has(key)) return false;
      writtenNames.add(key);
      writtenFiles.push({ name, content: result.content });
      console.log(`[${getTimestamp()}] [GENERATOR] ✓ Файл сгенерирован: ${name} (${result.content.length} байт)`);
      sendEvent(res, { type: 'file_done', name, content: result.content });
      return true;
    }

    function payloadsForPlan(payloads) {
      return payloads.filter((payload) =>
        plan.some((spec) => pathsRoughlyMatch(spec.name, payload.path))
      );
    }

    for (let i = 0; i < plan.length; i++) {
      const fileSpec = plan[i];
      if (aborted) {
        console.log(`[${getTimestamp()}] [GENERATOR] ⚠ Генерация отменена клиентом`);
        break;
      }

      const fileName = sanitizeName(fileSpec.name);
      const action = fileSpec.action || 'create';

      if (isFileAlreadyWritten(fileName)) {
        console.log(`[${getTimestamp()}] [GENERATOR] ↷ Пропуск ${fileName} — уже создан ранее`);
        continue;
      }

      console.log(`\n[${getTimestamp()}] [GENERATOR] 📄 Файл ${i + 1}/${plan.length}: ${fileName} (${action})`);
      sendEvent(res, { type: 'file_start', name: fileName, action });

      try {
        const generatorQuestion = `Action: ${action}\nFile: ${fileName}\nDescription: ${fileSpec.description || ''}\nContext: ${question}`;
        let generatorResponse = await callFlowiseHttp(
          generatorUrl,
          { question: generatorQuestion },
          config.flowiseToken,
          vars,
          `GENERATOR [${fileName}]`
        );

        console.log(`[${getTimestamp()}] [GENERATOR] [DEBUG] Response structure:`, JSON.stringify(generatorResponse, null, 2).slice(0, 1000));

        let allPayloads = collectAllWriteFilePayloads(generatorResponse);
        let planPayloads = payloadsForPlan(allPayloads);
        let currentPayload = planPayloads.find((p) => pathsRoughlyMatch(p.path, fileName))
          || extractGeneratorFilePayload(generatorResponse, fileName);

        if (!currentPayload && action === 'create') {
          const retryQuestion =
            `CRITICAL: Action is CREATE for a NEW file "${fileName}". ` +
            'The file does NOT exist yet — do NOT call read_project_file. ' +
            `Generate full content and call write_project_file(path="${fileName}", content=...) immediately.\n\n` +
            generatorQuestion;
          console.log(`[${getTimestamp()}] [GENERATOR] ↻ Повтор для ${fileName} (create без write_project_file)`);
          generatorResponse = await callFlowiseHttp(
            generatorUrl,
            { question: retryQuestion },
            config.flowiseToken,
            vars,
            `GENERATOR [${fileName}] retry`
          );
          allPayloads = collectAllWriteFilePayloads(generatorResponse);
          planPayloads = payloadsForPlan(allPayloads);
          currentPayload = planPayloads.find((p) => pathsRoughlyMatch(p.path, fileName))
            || extractGeneratorFilePayload(generatorResponse, fileName);
        }

        if (!currentPayload || typeof currentPayload.content !== 'string') {
          console.error(`[${getTimestamp()}] [GENERATOR] [DEBUG] Extraction failed. Response keys:`, Object.keys(generatorResponse || {}));
          console.error(`[${getTimestamp()}] [GENERATOR] [DEBUG] Response.text:`, typeof generatorResponse?.text === 'string' ? generatorResponse.text.slice(0, 200) : 'N/A');
          const execData = generatorResponse?.agentFlowExecutedData;
          const lastOutput = Array.isArray(execData) ? execData[execData.length - 1]?.data?.output : null;
          const usedToolsCount = collectUsedToolsFromResponse(generatorResponse).length;
          console.error(`[${getTimestamp()}] [GENERATOR] [DEBUG] agentFlowExecutedData nodes:`, Array.isArray(execData) ? execData.length : 'N/A');
          console.error(`[${getTimestamp()}] [GENERATOR] [DEBUG] last node usedTools:`, Array.isArray(lastOutput?.usedTools) ? lastOutput.usedTools.length : (lastOutput?.usedTools ? 'string' : 'N/A'));
          console.error(`[${getTimestamp()}] [GENERATOR] [DEBUG] collected usedTools:`, usedToolsCount);
          console.error(`[${getTimestamp()}] [GENERATOR] [DEBUG] write payloads found:`, allPayloads.map((p) => p.path).join(', ') || 'none');

          throw new Error(
            `Generator did not return file content for ${fileName}. ` +
            'Expected write_project_file tool args (path + content), fenced code in the reply, or JSON action write_file.'
          );
        }

        for (const payload of planPayloads) {
          if (isFileAlreadyWritten(payload.path)) continue;
          recordWrittenFile({ name: payload.path, content: payload.content });
        }

        if (!isFileAlreadyWritten(fileName)) {
          recordWrittenFile({ name: currentPayload.path || fileName, content: currentPayload.content });
        }
      } catch (err) {
        console.error(`[${getTimestamp()}] [GENERATOR] ✗ Ошибка файла ${fileName}: ${err.message}`);
        sendEvent(res, { type: 'error', message: `Ошибка файла ${fileName}: ${err.message}` });
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

    clearInterval(keepAliveInterval);
    res.end();
  } catch (err) {
    console.error('[Generate] Unexpected error:', err);
    clearInterval(keepAliveInterval);
    if (!res.headersSent) {
      next(err);
    } else {
      sendEvent(res, { type: 'error', message: 'Внутренняя ошибка сервера' });
      res.end();
    }
  }
}

module.exports = { generateStreamHandler };
