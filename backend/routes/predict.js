/**
 * POST /api/predict endpoint
 * Проксирование запросов к Flowise API
 */

const http = require('http');
const https = require('https');
const { config, isConfigured } = require('../config');

const FLOWISE_TIMEOUT = 0; // Без таймаута — AgentFlow может работать долго

/**
 * POST /api/predict
 * Проксирует запрос к Flowise API
 */
async function predictHandler(req, res, next) {
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

    console.log(`[Predict] → POST ${flowiseUrl} | user: ${req.user?.id || 'unknown'}`);
    console.log(`[Predict] Config: flowiseUrl=${config.flowiseUrl}, flowId=${config.flowId}, token=${config.flowiseToken ? 'set' : 'missing'}`);
    console.log(`[Predict] Variables: authToken=${authToken ? 'set' : 'missing'}, projectRoot=${projectRoot || 'not set'}`);

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
          
          // Обработка ошибок Flowise (Requirements 3.2, 3.3)
          if (flowiseRes.statusCode >= 500) {
            console.error(`[Predict] Flowise error ${flowiseRes.statusCode}:`, text.slice(0, 200));
            return res.status(502).json({ error: 'Ошибка соединения с Flowise' });
          }
          
          if (flowiseRes.statusCode !== 200) {
            console.error(`[Predict] Flowise error ${flowiseRes.statusCode}:`, text.slice(0, 200));
            // Пробрасываем статус ошибки Flowise
            return res.status(flowiseRes.statusCode).json({ error: text.slice(0, 500) });
          }

          // Успешный ответ (Requirement 3.1)
          console.log(`[Predict] ← HTTP ${flowiseRes.statusCode} | ${text.length} байт`);
          res.set('Content-Type', 'application/json');
          res.send(text);
        });
      }
    );

    flowiseReq.on('error', (err) => {
      console.error('[Predict] Ошибка соединения:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Ошибка соединения с Flowise' });
      }
    });

    flowiseReq.on('timeout', () => {
      flowiseReq.destroy();
      console.error('[Predict] Таймаут запроса к Flowise');
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
