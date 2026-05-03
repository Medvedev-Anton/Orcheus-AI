/**
 * Auth Middleware - Supabase JWT verification
 * Requirements: 1.2, 1.3
 */

const { createClient } = require('@supabase/supabase-js');
const { config } = require('../config');

// Создаём Supabase клиент для верификации JWT
const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

/**
 * Middleware для проверки Supabase JWT токена
 * Извлекает user_id из токена и добавляет в req.userId
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  // Проверяем наличие Authorization заголовка
  if (!authHeader) {
    return res.status(401).json({ error: 'Необходима авторизация' });
  }
  
  // Извлекаем токен из Bearer header
  const token = authHeader.startsWith('Bearer ') 
    ? authHeader.slice(7) 
    : authHeader;
  
  if (!token) {
    return res.status(401).json({ error: 'Необходима авторизация' });
  }
  
  try {
    // Верифицируем токен через Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      return res.status(401).json({ error: 'Не авторизован' });
    }
    
    // Добавляем user_id в request для использования в других middleware
    req.userId = user.id;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
}

module.exports = authMiddleware;
