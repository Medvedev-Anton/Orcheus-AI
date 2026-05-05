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
 * HTTP-запрос к Flowise API
 * @param {string} url - URL эндпоинта
 * @param {object} body - Тело запроса
 * @param {string} token - Токен авторизации
 * @returns {Promise<object>} Ответ от Flowise
 */
function callFlowiseHttp(url, body, token) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return reject(new Error('Invalid Flowise URL'));
    }

    const bodyStr = JSON.stringify(body);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
      'Authorization': `Bearer ${token}`
    };

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
          
          if (flowiseRes.statusCode !== 200) {
            return reject(new Error(`Flowise error ${flowiseRes.statusCode}: ${text.slice(0, 200)}`));
          }

          try {
            const payload = JSON.parse(text);
            resolve(payload);
          } catch (e) {
            resolve({ text });
          }
        });
      }
    );

    req.on('error', (err) => reject(err));
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

/**
 * Нормализует один элемент плана к { name, description }
 * Поддерживает разные варианты ключей от LLM
 */
function normalizeFileEntry(item) {
  if (!item || typeof item !== 'object') return null;
  
  // Ищем поле с именем файла
  const name = item.name || item.fileName || item.file_name || item.filename || item.path || item.filePath;
  if (!name || typeof name !== 'string') return null;
  
  // Ищем поле с описанием
  const description = item.description || item.desc || item.purpose || item.content || '';
  
  return { name: name.trim(), description: String(description) };
}

/**
 * Парсинг Generation_Plan из ответа Flowise
 * @param {object} payload - Ответ от Planner Flow
 * @returns {Array<{name: string, description: string}>}
 */
function parsePlan(payload) {
  let rawFiles = null;

  // Прямой объект с files
  if (payload?.files && Array.isArray(payload.files)) {
    rawFiles = payload.files;
  }
  // JSON-строка в поле text
  else if (typeof payload?.text === 'string') {
    const parsed = tryParseJson(payload.text);
    if (parsed?.files && Array.isArray(parsed.files)) rawFiles = parsed.files;
    else if (Array.isArray(parsed)) rawFiles = parsed;
  }
  // JSON-строка в поле json
  else if (payload?.json) {
    const parsed = typeof payload.json === 'string' ? tryParseJson(payload.json) : payload.json;
    if (parsed?.files && Array.isArray(parsed.files)) rawFiles = parsed.files;
    else if (Array.isArray(parsed)) rawFiles = parsed;
  }
  // JSON-строка в поле files (строка)
  else if (typeof payload?.files === 'string') {
    const parsed = tryParseJson(payload.files);
    if (Array.isArray(parsed)) rawFiles = parsed;
  }

  if (!rawFiles || rawFiles.length === 0) {
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
 * Извлечение содержимого файла из ответа Generator Flow
 * @param {object} payload - Ответ от Generator Flow
 * @returns {string}
 */
function extractFileContent(payload) {
  // Прямая строка
  if (typeof payload === 'string') {
    return payload;
  }

  // Поле text
  if (typeof payload?.text === 'string') {
    return payload.text;
  }

  // Поле json
  if (payload?.json) {
    if (typeof payload.json === 'string') {
      return payload.json;
    }
    return JSON.stringify(payload.json, null, 2);
  }

  throw new Error('Invalid file content format');
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
      console.log('[Generate] Client disconnected');
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

    console.log(`[Generate] Start | user: ${req.user?.id || 'unknown'} | question: ${question.slice(0, 100)}`);

    // projectRoot передаётся клиентом в query
    const projectRoot = req.query.projectRoot;
    if (!projectRoot || typeof projectRoot !== 'string' || !projectRoot.trim()) {
      sendEvent(res, { type: 'error', message: 'Не указана папка проекта (projectRoot)' });
      return res.end();
    }

    // Этап 1: Планирование
    sendEvent(res, { type: 'status', message: 'Планируем проект...' });

    const baseUrl = config.flowiseUrl.replace(/\/+$/, '');
    const plannerUrl = `${baseUrl}/api/v1/prediction/${config.plannerFlowId}`;

    let plan;
    try {
      const plannerResponse = await callFlowiseHttp(plannerUrl, { question, chatId }, config.flowiseToken);
      console.log('[Generate] Planner raw response:', JSON.stringify(plannerResponse).slice(0, 500));
      const files = parsePlan(plannerResponse);
      
      if (!Array.isArray(files) || files.length === 0) {
        throw new Error('Plan contains no files');
      }

      plan = files;
      console.log(`[Generate] Plan received: ${plan.length} files`);
      sendEvent(res, { type: 'plan', files: plan });
    } catch (err) {
      console.error('[Generate] Planner error:', err.message);
      sendEvent(res, { type: 'error', message: `Ошибка планирования: ${err.message}` });
      return res.end();
    }

    // Этап 2: Генерация файлов
    const generatorUrl = `${baseUrl}/api/v1/prediction/${config.generatorFlowId}`;
    const writtenFiles = [];

    for (const fileSpec of plan) {
      if (aborted) {
        console.log('[Generate] Aborted by client');
        break;
      }

      const fileName = sanitizeName(fileSpec.name);
      sendEvent(res, { type: 'file_start', name: fileName });

      try {
        // Генерация файла
        const generatorQuestion = `Сгенерируй файл ${fileName}: ${fileSpec.description || ''}. Контекст задачи: ${question}`;
        const generatorResponse = await callFlowiseHttp(generatorUrl, { question: generatorQuestion }, config.flowiseToken);
        const content = extractFileContent(generatorResponse);

        // Запись файла
        const result = await writeSingleFile(projectRoot, fileName, content);
        writtenFiles.push(result);

        console.log(`[Generate] File written: ${fileName}`);
        sendEvent(res, { type: 'file_done', name: result.name, fullPath: result.fullPath });
      } catch (err) {
        console.error(`[Generate] File error (${fileName}):`, err.message);
        sendEvent(res, { type: 'error', message: `Ошибка файла ${fileName}: ${err.message}` });
        // Продолжаем генерацию следующих файлов
      }
    }

    // Завершение
    if (!aborted) {
      console.log(`[Generate] Done | ${writtenFiles.length} files written`);
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
