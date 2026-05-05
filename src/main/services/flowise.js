/**
 * Клиент для Backend API (прокси-сервер)
 */

const http = require('http');
const https = require('https');
const { FLOWISE_TIMEOUT, BACKEND_URL } = require('../config/constants');
const { getSupabaseClient } = require('./auth');

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

    console.log(`[Backend] → POST ${baseUrl}/api/predict`);
    console.log(`[Backend] Вопрос: ${question.slice(0, 120)}${question.length > 120 ? '...' : ''}`);
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
          console.log(`[Backend] HTTP ${res.statusCode} | ${text.length} байт`);
          if (res.statusCode !== 200) {
            let errMsg = text.slice(0, 500);
            try {
              const errJson = JSON.parse(text);
              if (errJson.message) errMsg = errJson.message;
            } catch { /* raw text */ }
            console.error(`[Backend] Ошибка ${res.statusCode}:`, errMsg);
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
      console.error('[Backend] Ошибка соединения:', err.message);
      reject(err);
    });
    
    req.setTimeout(FLOWISE_TIMEOUT, () => {
      req.destroy();
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
 * @param {function} onEvent - Callback для событий
 * @returns {{ cancel: function }}
 */
function startGenerate(question, chatId, projectRoot, onEvent) {
  const supabase = getSupabaseClient();
  let req = null;

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session?.access_token) {
      onEvent({ type: 'error', message: 'Необходима авторизация. Войдите в аккаунт.' });
      return;
    }

    const baseUrl = BACKEND_URL.replace(/\/+$/, '').replace('localhost', '127.0.0.1');
    const params = new URLSearchParams({ question, chatId: chatId || '', projectRoot: projectRoot || '' });
    let parsed;
    try {
      parsed = new URL(`${baseUrl}/api/generate/stream?${params}`);
    } catch (e) {
      onEvent({ type: 'error', message: 'Некорректный Backend URL: ' + e.message });
      return;
    }

    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

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
              onEvent(event);
            } catch (e) {
              console.error('[SSE] Parse error:', e.message, jsonStr.slice(0, 100));
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
        });

        res.on('error', (err) => {
          onEvent({ type: 'error', message: 'Ошибка SSE-соединения: ' + err.message });
        });
      }
    );

    req.on('error', (err) => {
      onEvent({ type: 'error', message: 'Ошибка соединения с сервером: ' + err.message });
    });

    req.end();
  }).catch((err) => {
    onEvent({ type: 'error', message: 'Ошибка авторизации: ' + err.message });
  });

  return {
    cancel: () => {
      if (req) {
        req.destroy();
        req = null;
      }
    }
  };
}

module.exports = { callFlowise, extractFiles, startGenerate };
