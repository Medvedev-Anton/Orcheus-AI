/**
 * POST /api/predict endpoint
 * Проксирование запросов к Flowise API
 */

const http = require('http');
const https = require('https');
const { config, isConfigured } = require('../config');

const FLOWISE_TIMEOUT = 0; // Без таймаута — AgentFlow может работать долго

/**
 * Форматирование времени для логов
 * @returns {string} Время в формате HH:MM:SS
 */
function getTimestamp() {
  const now = new Date();
  return now.toTimeString().split(' ')[0]; // HH:MM:SS
}

/**
 * POST /api/predict
 * Проксирует запрос к Flowise API
 */
async function predictHandler(req, res, next) {
  const startTime = Date.now();
  
  try {
    // Проверка конфигурации (Requirement 5.2)
    if (!isConfigured || !config.flowiseUrl || !config.flowId) {
      return res.status(503).json({ error: 'Сервер не настроен' });
    }

    // Валидация body (Requirements 2.1, 2.2, 2.3)
    const { question, chatId, overrideConfig } = req.body;
    
    if (!question || typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Пустой вопрос' });
    }

    // Формирование запроса к Flowise
    const baseUrl = config.flowiseUrl.replace(/\/+$/, '');
    const flowiseUrl = `${baseUrl}/api/v1/prediction/${config.flowId}`;
    
    let parsed;
    try {
      parsed = new URL(flowiseUrl);
    } catch (e) {
      return res.status(503).json({ error: 'Сервер не настроен' });
    }

    // Подготовка динамических переменных для Flowise
    const authToken = req.headers.authorization?.replace('Bearer ', '') || '';
    const projectRoot = req.headers['x-project-root'] || req.body.projectRoot || '';
    
    // Формирование payload с overrideConfig.vars
    const flowisePayload = { 
      question, 
      streaming: false,
      overrideConfig: {
        vars: {
          authToken,
          projectRoot
        }
      }
    };
    
    // Если пользователь передал свой overrideConfig, объединяем его
    if (overrideConfig && typeof overrideConfig === 'object') {
      if (overrideConfig.vars) {
        flowisePayload.overrideConfig.vars = {
          ...flowisePayload.overrideConfig.vars,
          ...overrideConfig.vars
        };
      }
      // Копируем другие поля overrideConfig (если есть)
      Object.keys(overrideConfig).forEach(key => {
        if (key !== 'vars') {
          flowisePayload.overrideConfig[key] = overrideConfig[key];
        }
      });
    }

    const body = JSON.stringify(flowisePayload);
    const isHttps = parsed.protocol === 'https:';
    const mod = isHttps ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Authorization': `Bearer ${config.flowiseToken}`
    };

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${getTimestamp()}] [PREDICT] 🚀 Запрос к Flowise API`);
    console.log(`[${getTimestamp()}] [PREDICT] URL: ${flowiseUrl}`);
    console.log(`[${getTimestamp()}] [PREDICT] User: ${req.user?.id || 'unknown'}`);
    console.log(`[${getTimestamp()}] [PREDICT] Flow ID: ${config.flowId}`);
    console.log(`[${getTimestamp()}] [PREDICT] Node: Agent 0 (Main Agent)`);
    console.log(`[${getTimestamp()}] [PREDICT] Variables: authToken=${authToken ? 'set' : 'missing'}, projectRoot=${projectRoot || 'not set'}`);
    console.log(`${'='.repeat(80)}\n`);

    // Запрос к Flowise (Requirement 3.4 - таймаут 280 сек)
    const flowiseReq = mod.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname,
        method: 'POST',
        headers,
        timeout: FLOWISE_TIMEOUT
      },
      (flowiseRes) => {
        const chunks = [];
        flowiseRes.on('data', (chunk) => chunks.push(chunk));
        flowiseRes.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          
          // Обработка ошибок Flowise (Requirements 3.2, 3.3)
          if (flowiseRes.statusCode >= 500) {
            console.error(`[${getTimestamp()}] [PREDICT] ✗ Flowise error ${flowiseRes.statusCode} | Время: ${duration}s`);
            console.error(`[${getTimestamp()}] [PREDICT] Ответ: ${text.slice(0, 200)}`);
            return res.status(502).json({ error: 'Ошибка соединения с Flowise' });
          }
          
          if (flowiseRes.statusCode !== 200) {
            console.error(`[${getTimestamp()}] [PREDICT] ✗ Flowise error ${flowiseRes.statusCode} | Время: ${duration}s`);
            console.error(`[${getTimestamp()}] [PREDICT] Ответ: ${text.slice(0, 200)}`);
            // Пробрасываем статус ошибки Flowise
            return res.status(flowiseRes.statusCode).json({ error: text.slice(0, 500) });
          }

          // Успешный ответ (Requirement 3.1)
          console.log(`[${getTimestamp()}] [PREDICT] ✓ Ответ получен | HTTP ${flowiseRes.statusCode} | Время: ${duration}s | Размер: ${text.length} байт`);
          res.set('Content-Type', 'application/json');
          res.send(text);
        });
      }
    );

    flowiseReq.on('error', (err) => {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`[${getTimestamp()}] [PREDICT] ✗ Ошибка соединения | Время: ${duration}s | ${err.message}`);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Ошибка соединения с Flowise' });
      }
    });

    flowiseReq.on('timeout', () => {
      flowiseReq.destroy();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`[${getTimestamp()}] [PREDICT] ✗ Таймаут запроса | Время: ${duration}s`);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Таймаут: AgentFlow выполняется слишком долго' });
      }
    });

    flowiseReq.write(body);
    flowiseReq.end();

  } catch (err) {
    next(err);
  }
}

module.exports = { predictHandler };
