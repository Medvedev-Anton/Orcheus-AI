/**
 * Backend Configuration Module
 * Requirements: 1.1, 1.2, 1.3, 3.1, 4.2, 4.4, 8.1, 8.2
 * 
 * Централизованная конфигурация для всех переменных окружения.
 * Все секреты хранятся только в backend/.env.
 */

require('dotenv').config({ path: __dirname + '/.env' });

const config = {
  // ─── Flowise Configuration ───
  // Requirements: 1.2
  flowiseUrl: process.env.FLOWISE_URL,
  flowiseToken: process.env.FLOWISE_TOKEN,
  flowId: process.env.FLOW_ID,
  plannerFlowId: process.env.PLANNER_FLOW_ID,
  generatorFlowId: process.env.GENERATOR_FLOW_ID,

  // ─── Supabase Configuration ───
  // Requirements: 1.1
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,

  // ─── Server Configuration ───
  // Requirements: 4.1, 4.2, 4.4, 4.5
  port: parseInt(process.env.PORT, 10) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigins: process.env.CORS_ORIGINS || '*',
  logLevel: process.env.LOG_LEVEL || 'info',
  trustProxy: process.env.TRUST_PROXY === 'true',

  // ─── Request Limits (for 2GB RAM server) ───
  // Requirements: 8.1, 8.2
  maxRequestSize: process.env.MAX_REQUEST_SIZE || '1mb',
  requestTimeout: parseInt(process.env.REQUEST_TIMEOUT, 10) || 120000,

  // ─── IP Allowlist Configuration ───
  // Requirements: 3.1, 3.5
  ipAllowlist: process.env.IP_ALLOWLIST || null
};

/**
 * Валидация обязательных переменных окружения
 * @returns {boolean} true если все обязательные переменные заданы
 */
function validateConfig() {
  const missing = [];

  // Обязательные переменные
  if (!config.flowiseUrl) missing.push('FLOWISE_URL');
  if (!config.flowiseToken) missing.push('FLOWISE_TOKEN');
  if (!config.flowId) missing.push('FLOW_ID');
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');

  if (missing.length > 0) {
    console.warn(`[Config] Missing environment variables: ${missing.join(', ')}`);
    return false;
  }

  return true;
}

const isConfigured = validateConfig();

// Streaming generation configuration
const isStreamingConfigured = !!(config.plannerFlowId && config.generatorFlowId);
if (!isStreamingConfigured) {
  console.warn('[Config] Streaming generation not configured: PLANNER_FLOW_ID and/or GENERATOR_FLOW_ID missing.');
}

// ─── AITunnel LLM Proxy Configuration ───
// Requirements: 1.3
const llmConfig = {
  apiKey: process.env.AITUNNEL_API_KEY || null,
  baseUrl: (process.env.AITUNNEL_BASE_URL || 'https://api.aitunnel.ru/v1').replace(/\/+$/, ''),
  timeoutMs: parseInt(process.env.AITUNNEL_TIMEOUT_MS, 10) || 120000,
  allowedModels: (process.env.AITUNNEL_ALLOWED_MODELS || 'deepseek-v4-flash')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
  debug: process.env.LLM_PROXY_DEBUG === 'true'
};

/**
 * Проверка AITunnel конфигурации
 * @returns {boolean} true если AITunnel API key задан
 */
const isLlmConfigured = !!llmConfig.apiKey;
if (!isLlmConfigured) {
  console.warn('[Config] AITunnel LLM Proxy not configured: AITUNNEL_API_KEY missing.');
}

/**
 * Получить статус всех критических переменных
 * Используется для вывода при запуске и /health endpoint
 * @returns {Object} Статус каждой переменной
 */
function getConfigStatus() {
  return {
    supabase: !!(config.supabaseUrl && config.supabaseAnonKey),
    flowise: !!(config.flowiseUrl && config.flowiseToken && config.flowId),
    aitunnel: !!llmConfig.apiKey,
    streaming: isStreamingConfigured
  };
}

/**
 * Получить список missing обязательных переменных
 * @returns {string[]} Массив названий missing переменных
 */
function getMissingVars() {
  const missing = [];
  
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabaseAnonKey) missing.push('SUPABASE_ANON_KEY');
  if (!config.flowiseUrl) missing.push('FLOWISE_URL');
  if (!config.flowiseToken) missing.push('FLOWISE_TOKEN');
  if (!config.flowId) missing.push('FLOW_ID');
  if (!llmConfig.apiKey) missing.push('AITUNNEL_API_KEY');
  
  return missing;
}

module.exports = {
  config,
  isConfigured,
  isStreamingConfigured,
  isLlmConfigured,
  llmConfig,
  getConfigStatus,
  getMissingVars
};
