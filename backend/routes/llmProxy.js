/**
 * LLM Proxy Router — OpenAI-compatible proxy to AITunnel
 *
 * Монтируется на /v1 в backend/index.js.
 * Нормализует response_format от Flowise и пересылает запросы в AITunnel.
 *
 * Requirements: 1.1–1.5, 2.1–2.5, 3.1–3.6, 4.1–4.5, 5.1, 5.5, 5.6
 */

const express = require('express');
const https = require('https');
const http = require('http');
const { llmConfig } = require('../config');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Нормализует response_format из формата Flowise в формат, совместимый с OpenAI/AITunnel.
 *
 * Правила (Requirement 2):
 *   { type: "json", schema: {...} }  →  { type: "json_schema", json_schema: { name: "flowise_output", strict: true, schema: {...} } }
 *   { type: "json" }                 →  { type: "json_object" }
 *   всё остальное                    →  без изменений
 *
 * @param {object} body — распарсенное тело запроса
 * @returns {object} — тело с нормализованным response_format
 */
function normalizeResponseFormat(body) {
  const rf = body?.response_format;
  if (!rf) return body;

  if (rf.type === 'json' && rf.schema) {
    return {
      ...body,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'flowise_output', strict: true, schema: rf.schema }
      }
    };
  }

  if (rf.type === 'json' && !rf.schema) {
    return { ...body, response_format: { type: 'json_object' } };
  }

  return body;
}

// ── GET /v1/models ────────────────────────────────────────────────────────────

/**
 * Возвращает список разрешённых моделей в формате OpenAI.
 * Requirement 1.3
 */
router.get('/models', (req, res) => {
  const models = llmConfig.allowedModels.map(id => ({
    id,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'aitunnel'
  }));
  res.json({ object: 'list', data: models });
});

// ── POST /v1/chat/completions  &  POST /v1/completions ────────────────────────

/**
 * Проксирует запросы к AITunnel с нормализацией response_format.
 * Requirements: 1.1, 1.2, 2.1–2.5, 3.1–3.6, 4.1–4.5
 */
router.post(['/chat/completions', '/completions'], (req, res) => {
  // Requirement 3.4: 503 если API key не задан
  if (!llmConfig.apiKey) {
    return res.status(503).json({ error: 'LLM proxy not configured' });
  }

  const normalizedBody = normalizeResponseFormat(req.body);
  const isStream = normalizedBody?.stream === true;
  const model = normalizedBody?.model ?? 'unknown';
  const bodyStr = JSON.stringify(normalizedBody);

  // Строим целевой URL AITunnel (Requirement 3.1)
  const targetUrl = `${llmConfig.baseUrl}${req.path}`;
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return res.status(502).json({ error: 'AITunnel connection error' });
  }

  const isHttps = parsed.protocol === 'https:';
  const mod = isHttps ? https : http;

  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyStr),
    // Requirement 3.2: Authorization header с API key
    'Authorization': `Bearer ${llmConfig.apiKey}`,
    'Accept': isStream ? 'text/event-stream' : 'application/json'
  };

  // Requirement 5.5: INFO-лог каждого запроса (без значения API key)
  if (llmConfig.debug) {
    // Requirement 5.6: расширенный лог при LLM_PROXY_DEBUG=true
    console.log(`[LLMProxy] → ${req.method} ${targetUrl} | model: ${model} | stream: ${isStream}`);
    console.log(`[LLMProxy] body:`, JSON.stringify(normalizedBody));
  } else {
    console.log(`[LLMProxy] → ${req.method} ${req.path} | model: ${model}`);
  }

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (isHttps ? 443 : 80),
    path: parsed.pathname,
    method: 'POST',
    headers,
    // Requirement 4.5: таймаут для не-streaming запросов; 0 = без таймаута для streaming
    timeout: isStream ? 0 : llmConfig.timeoutMs
  };

  const proxyReq = mod.request(options, (proxyRes) => {
    // Requirement 5.5: логируем статус ответа
    if (llmConfig.debug) {
      // Requirement 5.6: расширенный лог заголовков ответа
      console.log(`[LLMProxy] ← HTTP ${proxyRes.statusCode} | headers:`, proxyRes.headers);
    } else {
      console.log(`[LLMProxy] ← HTTP ${proxyRes.statusCode} | model: ${model}`);
    }

    // Requirements 4.1, 4.3: пробрасываем статус и Content-Type как есть (включая 4xx/5xx)
    res.status(proxyRes.statusCode);
    const contentType = proxyRes.headers['content-type'] ?? 'application/json';
    res.setHeader('Content-Type', contentType);

    if (isStream) {
      // Requirement 4.2: SSE streaming через pipe
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Accel-Buffering', 'no');
      proxyRes.pipe(res);
    } else {
      // Requirement 4.1: буферизованный ответ
      const chunks = [];
      proxyRes.on('data', chunk => chunks.push(chunk));
      proxyRes.on('end', () => res.end(Buffer.concat(chunks)));
    }
  });

  // Requirement 4.4: 502 при таймауте
  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(502).json({ error: 'AITunnel connection error' });
    }
  });

  // Requirement 4.4: 502 при ошибке соединения
  proxyReq.on('error', (err) => {
    console.error('[LLMProxy] connection error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'AITunnel connection error' });
    }
  });

  proxyReq.write(bodyStr);
  proxyReq.end();
});

module.exports = router;
