/**
 * Config Router - Public configuration endpoint
 * Requirements: 2.1, 2.2
 * 
 * Возвращает публичную конфигурацию для Electron клиента.
 * Никогда не возвращает секретные ключи (FLOWISE_TOKEN, AITUNNEL_API_KEY).
 */

const express = require('express');
const router = express.Router();
const { config } = require('../config');

/**
 * GET /api/config
 * 
 * Возвращает публичную конфигурацию для клиента.
 * Response: { supabaseUrl, supabaseAnonKey, backendVersion }
 * 
 * Security: Только публичные ключи, никаких секретов.
 */
router.get('/config', (req, res) => {
  // Requirements: 2.1, 2.2
  // Возвращаем только публичные ключи
  // SUPABASE_ANON_KEY - публичный ключ, безопасен для клиента
  // FLOWISE_TOKEN, AITUNNEL_API_KEY - секреты, НЕ возвращаем
  res.json({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    backendVersion: process.env.npm_package_version || '1.0.0'
  });
});

module.exports = router;
