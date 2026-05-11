/**
 * Configuration Check Middleware
 * Requirement: 9.6
 * 
 * Возвращает HTTP 503 для зависимых endpoints при missing конфигурации.
 */

const { isConfigured, isLlmConfigured, getMissingVars } = require('../config');

/**
 * Middleware для проверки конфигурации перед обработкой запроса.
 * Возвращает 503 если критические переменные отсутствуют.
 * 
 * @param {Object} options - Опции проверки
 * @param {string[]} options.requires - Массив требуемых сервисов: ['supabase', 'flowise', 'aitunnel']
 */
function configCheckMiddleware(options = {}) {
  const { requires = [] } = options;
  
  return (req, res, next) => {
    const missing = getMissingVars();
    
    // Проверяем каждый требуемый сервис
    for (const service of requires) {
      if (service === 'supabase' && (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)) {
        return res.status(503).json({
          error: 'Service unavailable: missing Supabase configuration',
          missing: ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].filter(v => !process.env[v])
        });
      }
      
      if (service === 'flowise' && (!process.env.FLOWISE_URL || !process.env.FLOWISE_TOKEN || !process.env.FLOW_ID)) {
        return res.status(503).json({
          error: 'Service unavailable: missing Flowise configuration',
          missing: ['FLOWISE_URL', 'FLOWISE_TOKEN', 'FLOW_ID'].filter(v => !process.env[v])
        });
      }
      
      if (service === 'aitunnel' && !process.env.AITUNNEL_API_KEY) {
        return res.status(503).json({
          error: 'Service unavailable: missing AITunnel configuration',
          missing: ['AITUNNEL_API_KEY']
        });
      }
    }
    
    next();
  };
}

/**
 * Проверка полной конфигурации (все критические переменные)
 */
function requireFullConfig(req, res, next) {
  if (!isConfigured) {
    const missing = getMissingVars();
    return res.status(503).json({
      error: 'Service unavailable: missing configuration',
      missing
    });
  }
  next();
}

/**
 * Проверка LLM конфигурации (AITunnel)
 */
function requireLlmConfig(req, res, next) {
  if (!isLlmConfigured) {
    return res.status(503).json({
      error: 'Service unavailable: AITUNNEL_API_KEY not configured'
    });
  }
  next();
}

module.exports = {
  configCheckMiddleware,
  requireFullConfig,
  requireLlmConfig
};
