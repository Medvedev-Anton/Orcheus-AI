/**
 * IP Allowlist Middleware
 * Requirement 6: только localhost и Docker-сети
 *
 * Разрешённые диапазоны:
 *   - 127.0.0.1        (IPv4 loopback)
 *   - ::1              (IPv6 loopback)
 *   - ::ffff:127.0.0.1 (IPv4-mapped IPv6 loopback)
 *   - 172.16.0.0/12    (Docker default bridge network)
 *   - 10.0.0.0/8       (Docker custom network / internal)
 */

/**
 * Конвертирует IPv4-строку в 32-битное беззнаковое целое.
 * @param {string} ip
 * @returns {number}
 */
function ip2int(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

const ALLOWED_RANGES = [
  // Loopback (IPv4 и IPv4-mapped IPv6 нормализуются ниже)
  { type: 'exact', value: '127.0.0.1' },
  { type: 'exact', value: '::1' },
  // Docker bridge 172.16.0.0/12
  { type: 'range', start: ip2int('172.16.0.0'), end: ip2int('172.31.255.255') },
  // Internal / Docker custom 10.0.0.0/8
  { type: 'range', start: ip2int('10.0.0.0'), end: ip2int('10.255.255.255') },
];

/**
 * Проверяет, входит ли IP в список разрешённых.
 * @param {string|undefined} rawIp
 * @returns {boolean}
 */
function isAllowed(rawIp) {
  if (!rawIp) return false;

  // Нормализуем IPv4-mapped IPv6 (::ffff:x.x.x.x → x.x.x.x)
  const ip = rawIp.replace(/^::ffff:/, '');

  for (const rule of ALLOWED_RANGES) {
    if (rule.type === 'exact' && ip === rule.value) return true;
    if (rule.type === 'range') {
      try {
        const n = ip2int(ip);
        if (n >= rule.start && n <= rule.end) return true;
      } catch {
        // Не IPv4 — пропускаем range-проверку
      }
    }
  }
  return false;
}

/**
 * Express middleware: пропускает запросы только с разрешённых IP.
 * Возвращает 403 для всех остальных.
 */
function ipAllowlistMiddleware(req, res, next) {
  const clientIp = req.socket.remoteAddress;
  const allowed = isAllowed(clientIp);

  if (process.env.LLM_PROXY_DEBUG === 'true') {
    console.log(`[LLMProxy] IP check: ${clientIp} → ${allowed ? 'allowed' : 'denied'}`);
  }

  if (!allowed) {
    return res.status(403).json({ error: 'Access denied' });
  }
  next();
}

module.exports = ipAllowlistMiddleware;
