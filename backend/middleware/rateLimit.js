/**
 * Rate Limit Middleware - 60 requests per minute per user
 * Requirements: 4.1, 4.2, 4.3
 */

// Хранилище счётчиков запросов: { userId: { count: number, resetAt: timestamp } }
const requestCounts = new Map();

// Очистка устаревших записей каждую минуту
setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of requestCounts.entries()) {
    if (now > data.resetAt) {
      requestCounts.delete(userId);
    }
  }
}, 60000);

/**
 * Middleware для ограничения запросов (60 в минуту на пользователя)
 * Требует наличия req.userId (устанавливается в auth middleware)
 */
function rateLimitMiddleware(req, res, next) {
  const userId = req.userId;
  
  if (!userId) {
    // Если нет userId, пропускаем (auth middleware должен был обработать это)
    return next();
  }
  
  const now = Date.now();
  const userLimit = requestCounts.get(userId);
  
  if (!userLimit || now > userLimit.resetAt) {
    // Создаём новый счётчик на минуту
    requestCounts.set(userId, {
      count: 1,
      resetAt: now + 60000
    });
    return next();
  }
  
  if (userLimit.count >= 60) {
    // Превышен лимит
    return res.status(429).json({ error: 'Слишком много запросов' });
  }
  
  // Увеличиваем счётчик
  userLimit.count++;
  next();
}

module.exports = rateLimitMiddleware;
