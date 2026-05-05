require('dotenv').config({ path: __dirname + '/.env' });

const config = {
  // Flowise
  flowiseUrl: process.env.FLOWISE_URL,
  flowiseToken: process.env.FLOWISE_TOKEN,
  flowId: process.env.FLOW_ID,
  
  // Supabase
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  
  // Server
  port: parseInt(process.env.PORT, 10) || 3001
};

function validateConfig() {
  const missing = [];
  
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

// AITunnel LLM Proxy configuration (Requirement 5.3)
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

module.exports = { config, isConfigured, llmConfig };
