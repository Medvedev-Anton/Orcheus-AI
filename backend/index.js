/**
 * Backend Proxy Server - Express.js entry point
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 4.1, 4.5, 5.4, 6.1, 6.2, 6.3
 */

const express = require('express');
const cors = require('cors');
const authMiddleware = require('./middleware/auth');
const rateLimitMiddleware = require('./middleware/rateLimit');
const errorHandler = require('./middleware/errorHandler');
const ipAllowlistMiddleware = require('./middleware/ipAllowlist');
const { predictHandler } = require('./routes/predict');
const { generateStreamHandler } = require('./routes/generate');
const llmProxyRouter = require('./routes/llmProxy');
const { getUsage, resetUsage } = llmProxyRouter;
const { config, isConfigured, llmConfig, getConfigStatus, getMissingVars } = require('./config');

// Import MCP router (Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 13.1)
const mcpRouter = require('./routes/mcp');

// Import Config router (Requirements: 2.1, 2.2)
const configRouter = require('./routes/config');

// Создаём Express app
const app = express();

// ─── Trust Proxy Configuration ───
// Requirements: 4.5
// Необходим для корректного определения IP за Nginx reverse proxy
if (config.trustProxy) {
  app.set('trust proxy', 1);
}

// ─── CORS Middleware ───
// Requirements: 4.1, 4.2, 6.1, 6.2, 6.3
app.use(cors({
  origin: config.corsOrigins,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Project-Root']
}));

// ─── Body Parser with Request Size Limit ───
// Requirements: 8.1
app.use(express.json({ limit: config.maxRequestSize }));

// ─── Request Timeout ───
// Requirements: 8.2
app.use((req, res, next) => {
  const isSseRequest =
    req.path === '/api/generate/stream' ||
    req.headers.accept?.includes('text/event-stream');

  // SSE-потоки не обрабатываем глобальным JSON-timeout,
  // потому что они могут быть долгими и уже отправляют headers.
  if (isSseRequest) {
    return next();
  }

  res.setTimeout(config.requestTimeout, () => {
    console.warn(`[Timeout] ${req.method} ${req.originalUrl}`);

    if (!res.headersSent && !res.writableEnded) {
      return res.status(504).json({ error: 'Request timeout' });
    }
  });

  next();
});

// ─── LLM Proxy — OpenAI-compatible endpoints ───
// Requirements: 5.2, 5.7, 6.1
// ipAllowlistMiddleware стоит первым: защищает /v1/* до любой бизнес-логики
app.use('/v1', ipAllowlistMiddleware, llmProxyRouter);

// ─── Health Check Endpoint ───
// Requirements: 9.5
app.get('/health', (req, res) => {
  const status = getConfigStatus();
  const missing = getMissingVars();
  
  res.json({ 
    status: isConfigured ? 'ok' : 'degraded',
    configured: isConfigured,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    checks: status,
    missing: missing.length > 0 ? missing : undefined
  });
});

// ─── Config Endpoint (Public) ───
// Requirements: 2.1, 2.2
app.use('/api', configRouter);

// ─── Protected Routes ───
app.post('/api/predict', authMiddleware, rateLimitMiddleware, predictHandler);
const generateStreamStack = [authMiddleware, rateLimitMiddleware, generateStreamHandler];
app.get('/api/generate/stream', ...generateStreamStack);
app.post('/api/generate/stream', ...generateStreamStack);

// ─── MCP Endpoints ───
// Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7
app.use('/mcp', mcpRouter);

// ─── Token Usage Endpoint ───
app.get('/api/usage', authMiddleware, (req, res) => {
  const key = req.headers['x-session-id'] || req.user?.id || 'global';
  res.json(getUsage(key));
});

app.delete('/api/usage', authMiddleware, (req, res) => {
  const key = req.headers['x-session-id'] || req.user?.id || 'global';
  resetUsage(key);
  res.json({ ok: true });
});

// ─── Error Handler ───
// Должен быть последним middleware
app.use(errorHandler);

// ─── Startup Configuration Check ───
// Requirements: 9.1, 9.2, 9.3, 9.4
function printStartupStatus() {
  console.log('='.repeat(50));
  console.log('[Backend] Orcheus API Server');
  console.log('='.repeat(50));
  
  // Environment
  console.log(`[Config] NODE_ENV: ${config.nodeEnv}`);
  console.log(`[Config] PORT: ${config.port}`);
  
  // Critical variables status
  const status = getConfigStatus();
  console.log('[Config] Environment variables status:');
  console.log(`  ${status.supabase ? '✓' : '✗'} SUPABASE_URL + SUPABASE_ANON_KEY`);
  console.log(`  ${status.flowise ? '✓' : '✗'} FLOWISE_URL + FLOWISE_TOKEN + FLOW_ID`);
  console.log(`  ${status.aitunnel ? '✓' : '✗'} AITUNNEL_API_KEY`);
  console.log(`  ${status.streaming ? '✓' : '✗'} PLANNER_FLOW_ID + GENERATOR_FLOW_ID`);
  
  // Missing variables
  const missing = getMissingVars();
  if (missing.length > 0) {
    console.warn(`[Config] WARNING: Missing variables: ${missing.join(', ')}`);
    console.warn('[Config] Some endpoints will return HTTP 503');
  }
  
  // IP Allowlist status
  // Requirements: 9.4
  const ipStatus = config.ipAllowlist 
    ? `enabled (${config.ipAllowlist.split(',').length} IPs/CIDRs)`
    : 'disabled (localhost + Docker only)';
  console.log(`[Config] IP Allowlist: ${ipStatus}`);
  
  // Request limits
  // Requirements: 8.1, 8.2
  console.log(`[Config] Max Request Size: ${config.maxRequestSize}`);
  console.log(`[Config] Request Timeout: ${config.requestTimeout}ms`);
  
  console.log('='.repeat(50));
}

// ─── Запуск сервера ───
const PORT = config.port;

app.listen(PORT, () => {
  printStartupStatus();
  
  console.log(`[Backend] Server running on port ${PORT}`);
  console.log(`[Backend] Health check: http://localhost:${PORT}/health`);
  console.log(`[Backend] Config endpoint: GET http://localhost:${PORT}/api/config`);
  console.log(`[Backend] Predict endpoint: POST http://localhost:${PORT}/api/predict`);
});
