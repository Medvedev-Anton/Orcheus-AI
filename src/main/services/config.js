/**
 * Client Configuration Service
 * Requirements: 2.3, 2.4
 * 
 * Загружает публичную конфигурацию с backend при запуске клиента.
 * Fallback на локальную конфигурацию если backend недоступен.
 */

const { BACKEND_URL } = require('../config/constants');

let cachedConfig = null;
let configLoadAttempted = false;

/**
 * Загрузить конфигурацию с backend
 * Requirements: 2.3, 2.4
 * 
 * @returns {Promise<Object>} Конфигурация
 */
async function loadConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    console.log('[Config] Fetching configuration from backend...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${BACKEND_URL}/api/config`, {
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`Config fetch failed: ${response.status}`);
    }
    
    cachedConfig = await response.json();
    configLoadAttempted = true;
    
    console.log('[Config] Loaded from backend successfully');
    console.log('[Config] Supabase URL:', cachedConfig.supabaseUrl);
    
    return cachedConfig;
    
  } catch (error) {
    configLoadAttempted = true;
    console.warn('[Config] Backend unavailable, using fallback:', error.message);
    return getFallbackConfig();
  }
}

/**
 * Получить fallback конфигурацию из локального файла
 * Requirements: 2.4
 * 
 * @returns {Object} Fallback конфигурация
 */
function getFallbackConfig() {
  // Fallback из constants.js для offline режима
  const { SUPABASE_URL, SUPABASE_ANON } = require('../config/constants');
  
  console.warn('[Config] Using fallback configuration from constants.js');
  
  return {
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON,
    backendVersion: 'unknown'
  };
}

/**
 * Получить текущую конфигурацию (из кэша или fallback)
 * 
 * @returns {Object} Конфигурация
 */
function getConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  
  if (!configLoadAttempted) {
    console.warn('[Config] Config not loaded yet, using fallback');
  }
  
  return getFallbackConfig();
}

/**
 * Получить Supabase URL
 * 
 * @returns {string|null}
 */
function getSupabaseUrl() {
  const config = getConfig();
  return config.supabaseUrl || null;
}

/**
 * Получить Supabase Anon Key
 * 
 * @returns {string|null}
 */
function getSupabaseAnonKey() {
  const config = getConfig();
  return config.supabaseAnonKey || null;
}

/**
 * Проверить, загружена ли конфигурация с backend
 * 
 * @returns {boolean}
 */
function isConfigLoaded() {
  return cachedConfig !== null;
}

module.exports = {
  loadConfig,
  getConfig,
  getSupabaseUrl,
  getSupabaseAnonKey,
  isConfigLoaded
};
