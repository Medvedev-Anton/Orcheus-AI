/**
 * Клиент для Backend API (прокси-сервер)
 */

const http = require('http');
const https = require('https');
const { FLOWISE_TIMEOUT, BACKEND_URL } = require('../config/constants');
const { getSupabaseClient } = require('./auth');

/**
 * Форматирование времени для логов
 * @returns {string} Время в формате HH:MM:SS
 */
function getTimestamp() {
  const now = new Date();
  return now.toTimeString().split(' ')[0]; // HH:MM:SS
}

/**
 * Попытка парсинга JSON
 * @param {string} value - Строка для парсинга
 * @returns {object|null} Распарсенный объект или null
 */
function tryParseJson(value) {
  if (typeof value !== 'string') return null;
  try { return JSON.parse(value); } catch { return null; }
}

/**
 * Извлечение файлов из ответа Flowise
 * @param {object} payload - Ответ от Flowise
 * @returns {Array<{name: string, content: string}>}
 */
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

/**
 * Вызов Backend API
 * @param {string} question - Вопрос пользователя
 * @param {string} chatId - ID чата
 * @param {object} settings - Настройки
 * @param {function} progressCb - Callback для прогресса
 * @returns {Promise<object>} Ответ от Backend
 */
async function callFlowise(question, chatId, settings, progressCb) {
  const startTime = Date.now();
  
  // Получаем JWT токен из Supabase сессии
  const supabase = getSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session?.access_token) {
    throw new Error('Необходима авторизация. Войдите в аккаунт.');
  }
  
  return new Promise((resolve, reject) => {
    const baseUrl = BACKEND_URL
      .replace(/\/+$/, '')
      .replace('localhost', '127.0.0.1');

    if (!question?.trim()) return reject(new Error('Пустой вопрос'));

    let parsed;
    try { parsed = new URL(`${baseUrl}/api/predict`); }
    catch (e) { return reject(new Error('Некорректный Backend URL: ' + e.message)); }

    const body = JSON.stringify({ question, chatId });
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Authorization': `Bearer ${session.access_token}`,
    };

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${getTimestamp()}] [CLIENT] 🚀 Отправка запроса к Backend`);
    console.log(`[${getTimestamp()}] [CLIENT] URL: ${baseUrl}/api/predict`);
    console.log(`[${getTimestamp()}] [CLIENT] Вопрос: ${question.slice(0, 120)}${question.length > 120 ? '...' : ''}`);
    console.log(`${'='.repeat(80)}\n`);
    progressCb?.('Подключаемся к серверу...');

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
          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          
          console.log(`[${getTimestamp()}] [CLIENT] ✓ Ответ получен | HTTP ${res.statusCode} | Время: ${duration}s | Размер: ${text.length} байт`);
          
          if (res.statusCode !== 200) {
            let errMsg = text.slice(0, 500);
            try {
              const errJson = JSON.parse(text);
              if (errJson.message) errMsg = errJson.message;
            } catch { /* raw text */ }
            console.error(`[${getTimestamp()}] [CLIENT] ✗ Ошибка ${res.statusCode}: ${errMsg}`);
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

    req.on('error', (err) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`[${getTimestamp()}] [CLIENT] ✗ Ошибка соединения | Время: ${duration}s | ${err.message}`);
      reject(err);
    });
    
    req.setTimeout(FLOWISE_TIMEOUT, () => {
      req.destroy();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`[${getTimestamp()}] [CLIENT] ✗ Таймаут запроса | Время: ${duration}s (лимит: 15 минут)`);
      reject(new Error('Таймаут запроса (15 минут)'));
    });
    
    req.write(body);
    req.end();
  });
}

/**
 * Запуск SSE-соединения с /api/generate/stream
 * @param {string} question - Вопрос пользователя
 * @param {string} chatId - ID чата
 * @param {string} projectRoot - Папка проекта
 * @param {string} projectFilesJson - JSON array string for Flowise $vars.projectFiles (from desktop listDir)
 * @param {function} onEvent - Callback для событий
 * @returns {{ cancel: function }}
 */
function startGenerate(question, chatId, projectRoot, projectFilesJson, onEvent) {
  const supabase = getSupabaseClient();
  let req = null;
  const startTime = Date.now();

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session?.access_token) {
      onEvent({ type: 'error', message: 'Необходима авторизация. Войдите в аккаунт.' });
      return;
    }

    const baseUrl = BACKEND_URL.replace(/\/+$/, '').replace('localhost', '127.0.0.1');
    const params = new URLSearchParams({
      question,
      chatId: chatId || '',
      projectRoot: projectRoot || '',
      projectFiles: projectFilesJson || '[]',
    });
    let parsed;
    try {
      parsed = new URL(`${baseUrl}/api/generate/stream?${params}`);
    } catch (e) {
      onEvent({ type: 'error', message: 'Некорректный Backend URL: ' + e.message });
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${getTimestamp()}] [CLIENT-SSE] 🚀 Начало SSE-соединения`);
    console.log(`[${getTimestamp()}] [CLIENT-SSE] URL: ${baseUrl}/api/generate/stream`);
    console.log(`[${getTimestamp()}] [CLIENT-SSE] Вопрос: ${question.slice(0, 100)}${question.length > 100 ? '...' : ''}`);
    console.log(`[${getTimestamp()}] [CLIENT-SSE] Project Root: ${projectRoot}`);
    console.log(`[${getTimestamp()}] [CLIENT-SSE] projectFiles JSON length: ${(projectFilesJson || '[]').length}`);
    console.log(`${'='.repeat(80)}\n`);

    req = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      },
      (res) => {
        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const parts = buffer.split('\n\n');
          buffer = parts.pop(); // Последний неполный фрагмент

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data:')) continue;
            const jsonStr = line.slice('data:'.length).trim();
            try {
              const event = JSON.parse(jsonStr);
              
              // Логирование событий
              if (event.type === 'plan') {
                console.log(`[${getTimestamp()}] [CLIENT-SSE] 📋 План получен: ${event.files?.length || 0} файлов`);
              } else if (event.type === 'file_start') {
                console.log(`[${getTimestamp()}] [CLIENT-SSE] 📄 Начало генерации: ${event.name}`);
              } else if (event.type === 'file_done') {
                console.log(`[${getTimestamp()}] [CLIENT-SSE] ✓ Файл готов: ${event.name}`);
              } else if (event.type === 'error') {
                console.error(`[${getTimestamp()}] [CLIENT-SSE] ✗ Ошибка: ${event.message}`);
              } else if (event.type === 'done') {
                const duration = ((Date.now() - startTime) / 1000).toFixed(2);
                console.log(`\n${'='.repeat(80)}`);
                console.log(`[${getTimestamp()}] [CLIENT-SSE] ✅ Генерация завершена | Время: ${duration}s | Файлов: ${event.files?.length || 0}`);
                console.log(`${'='.repeat(80)}\n`);
              }
              
              onEvent(event);
            } catch (e) {
              console.error(`[${getTimestamp()}] [CLIENT-SSE] ✗ Parse error: ${e.message} | Data: ${jsonStr.slice(0, 100)}`);
            }
          }
        });

        res.on('end', () => {
          // Обработка оставшегося буфера
          if (buffer.trim().startsWith('data:')) {
            const jsonStr = buffer.trim().slice('data:'.length).trim();
            try {
              onEvent(JSON.parse(jsonStr));
            } catch { /* ignore */ }
          }
          console.log(`[${getTimestamp()}] [CLIENT-SSE] 🔌 SSE-соединение закрыто`);
        });

        res.on('error', (err) => {
          console.error(`[${getTimestamp()}] [CLIENT-SSE] ✗ Ошибка SSE-соединения: ${err.message}`);
          onEvent({ type: 'error', message: 'Ошибка SSE-соединения: ' + err.message });
        });
      }
    );

    req.on('error', (err) => {
      console.error(`[${getTimestamp()}] [CLIENT-SSE] ✗ Ошибка соединения с сервером: ${err.message}`);
      onEvent({ type: 'error', message: 'Ошибка соединения с сервером: ' + err.message });
    });

    req.end();
  }).catch((err) => {
    console.error(`[${getTimestamp()}] [CLIENT-SSE] ✗ Ошибка авторизации: ${err.message}`);
    onEvent({ type: 'error', message: 'Ошибка авторизации: ' + err.message });
  });

  return {
    cancel: () => {
      if (req) {
        console.log(`[${getTimestamp()}] [CLIENT-SSE] ⚠ Отмена SSE-соединения`);
        req.destroy();
        req = null;
      }
    }
  };
}

module.exports = { callFlowise, extractFiles, startGenerate };
