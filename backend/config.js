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

module.exports = { config, isConfigured };
