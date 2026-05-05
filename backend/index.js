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
const llmProxyRouter = require('./routes/llmProxy');
const { config, isConfigured } = require('./config');

// Создаём Express app
const app = express();

// CORS middleware (Requirements 6.1, 6.2, 6.3)
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type']
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
