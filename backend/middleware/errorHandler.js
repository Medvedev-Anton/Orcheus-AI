/**
 * Error Handler Middleware - Centralized error handling
 * Requirements: 7.1, 7.2, 7.3
 */

/**
 * Централизованный обработчик ошибок
 * Логирует ошибки с user_id и временем, возвращает понятные сообщения
 */
function errorHandler(err, req, res, next) {
  const timestamp = new Date().toISOString();
  const userId = req.userId || 'anonymous';
  
  // Логируем ошибку с контекстом
  console.error(`[${timestamp}] [User: ${userId}] Error:`, err.message);
  
  // Определяем статус код
  const status = err.status || err.statusCode || 500;
  
  // Не раскрываем внутренние детали в продакшене
  const message = status === 500 
    ? 'Внутренняя ошибка сервера' 
    : err.message || 'Внутренняя ошибка сервера';
  
  res.status(status).json({ error: message });
}

module.exports = errorHandler;
