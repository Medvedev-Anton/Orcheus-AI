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
          projectRoot: vars.projectRoot || ''
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
  // JSON-строка в поле text
  else if (typeof payload?.text === 'string') {
    const extracted = extractJsonFromMarkdown(payload.text);
    const parsed = tryParseJson(extracted);
    if (parsed?.files && Array.isArray(parsed.files)) rawFiles = parsed.files;
    else if (Array.isArray(parsed)) rawFiles = parsed;
  }
  // JSON-строка в поле json
  else if (payload?.json) {
    const extracted = typeof payload.json === 'string' ? extractJsonFromMarkdown(payload.json) : payload.json;
    const parsed = typeof extracted === 'string' ? tryParseJson(extracted) : extracted;
    if (parsed?.files && Array.isArray(parsed.files)) rawFiles = parsed.files;
    else if (Array.isArray(parsed)) rawFiles = parsed;
  }
  // JSON-строка в поле files (строка)
  else if (typeof payload?.files === 'string') {
    const parsed = tryParseJson(payload.files);
    if (Array.isArray(parsed)) rawFiles = parsed;
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

    // Подготовка динамических переменных для Flowise
    const authToken = req.headers.authorization?.replace('Bearer ', '') || '';
    const vars = {
      authToken,
      projectRoot
    };

    console.log(`[${getTimestamp()}] [GENERATE] Variables: authToken=${authToken ? 'set' : 'missing'}, projectRoot=${projectRoot}`);

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
        
        // Извлекаем содержимое файла из ответа Generator Agent
        // Generator вызывает write_project_file, который возвращает { success, action, path, content }
        let fileContent = null;
        let filePath = fileName;
        
        // Пытаемся извлечь из разных форматов ответа
        if (typeof generatorResponse === 'string') {
          try {
            const parsed = JSON.parse(generatorResponse);
            if (parsed.action === 'write_file' && parsed.content) {
              fileContent = parsed.content;
              filePath = parsed.path || fileName;
            }
          } catch {
            // Если не JSON, возможно это просто содержимое файла
            fileContent = generatorResponse;
          }
        } else if (generatorResponse?.action === 'write_file') {
          fileContent = generatorResponse.content;
          filePath = generatorResponse.path || fileName;
        } else if (generatorResponse?.text) {
          fileContent = generatorResponse.text;
        } else if (generatorResponse?.content) {
          fileContent = generatorResponse.content;
        }
        
        if (!fileContent) {
          throw new Error(`Generator did not return file content for ${fileName}`);
        }
        
        const result = {
          name: filePath,
          content: fileContent
        };
        writtenFiles.push(result);

        console.log(`[${getTimestamp()}] [GENERATOR] ✓ Файл сгенерирован: ${filePath} (${fileContent.length} байт)`);
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
