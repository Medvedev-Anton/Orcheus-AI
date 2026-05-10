/**
 * Backend Proxy Server - Express.js entry point
 * Requirements: 5.4, 6.1, 6.2, 6.3
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
const { config, isConfigured } = require('./config');

// Import MCP router (Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 13.1)
const mcpRouter = require('./routes/mcp');

// Создаём Express app
const app = express();

// CORS middleware (Requirements 6.1, 6.2, 6.3)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Project-Root']
}));

// JSON body parser
app.use(express.json());

// LLM Proxy — OpenAI-compatible endpoints (Requirements 5.2, 5.7, 6.1)
// ipAllowlistMiddleware стоит первым: защищает /v1/* до любой бизнес-логики
app.use('/v1', ipAllowlistMiddleware, llmProxyRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    configured: isConfigured,
    timestamp: new Date().toISOString()
  });
});

// Routes
app.post('/api/predict', authMiddleware, rateLimitMiddleware, predictHandler);
app.get('/api/generate/stream', authMiddleware, rateLimitMiddleware, generateStreamHandler);

// MCP endpoints (Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7)
app.use('/mcp', mcpRouter);

// Token usage endpoint
app.get('/api/usage', authMiddleware, (req, res) => {
  const key = req.headers['x-session-id'] || req.user?.id || 'global';
  res.json(getUsage(key));
});

app.delete('/api/usage', authMiddleware, (req, res) => {
  const key = req.headers['x-session-id'] || req.user?.id || 'global';
  resetUsage(key);
  res.json({ ok: true });
});

// Error handler (должен быть последним)
app.use(errorHandler);

// Запуск сервера
const PORT = config.port;

app.listen(PORT, () => {
  console.log(`[Backend] Server running on port ${PORT}`);
  console.log(`[Backend] Health check: http://localhost:${PORT}/health`);
  console.log(`[Backend] Predict endpoint: POST http://localhost:${PORT}/api/predict`);
  
  if (!isConfigured) {
    console.warn('[Backend] WARNING: Server is not fully configured. Check environment variables.');
  }
});
