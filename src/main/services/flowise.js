/**
 * Клиент для Flowise API
 */

const http = require('http');
const https = require('https');
const { FLOWISE_TIMEOUT } = require('../config/constants');

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
 * Вызов Flowise API
 * @param {string} question - Вопрос пользователя
 * @param {string} chatId - ID чата
 * @param {object} settings - Настройки
 * @param {function} progressCb - Callback для прогресса
 * @returns {Promise<object>} Ответ от Flowise
 */
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

    req.on('error', (err) => {
      console.error('[Flowise] Ошибка соединения:', err.message);
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

module.exports = { callFlowise, extractFiles };
