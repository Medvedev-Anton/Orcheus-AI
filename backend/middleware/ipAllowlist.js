/**
 * IP Allowlist Middleware
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 * 
 * Поддерживает два режима:
 * 1. По умолчанию: localhost + Docker-сети
 * 2. Если задан IP_ALLOWLIST: только указанные IP/CIDR
 * 
 * Формат IP_ALLOWLIST: comma-separated список IP или CIDR
 * Пример: "192.168.1.100,10.0.0.0/8,::1"
 */

const { config } = require('../config');

/**
 * Конвертирует IPv4-строку в 32-битное беззнаковое целое.
 * @param {string} ip
 * @returns {number}
 */
function ip2int(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

/**
 * Проверяет, является ли строка валидным IPv4 адресом.
 * @param {string} ip
 * @returns {boolean}
 */
function isValidIPv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255 && part === num.toString();
  });
}

/**
 * Проверяет, является ли строка валидным CIDR.
 * @param {string} cidr
 * @returns {boolean}
 */
function isValidCIDR(cidr) {
  if (!cidr.includes('/')) return false;
  const [ip, prefix] = cidr.split('/');
  const prefixNum = parseInt(prefix, 10);
  return isValidIPv4(ip) && prefixNum >= 0 && prefixNum <= 32;
}

/**
 * Проверяет, входит ли IP в CIDR диапазон.
 * @param {string} ip - IPv4 адрес
 * @param {string} cidr - CIDR нотация (например, "192.168.1.0/24")
 * @returns {boolean}
 */
function ipInCIDR(ip, cidr) {
  const [rangeIp, prefix] = cidr.split('/');
  const prefixNum = parseInt(prefix, 10);
  
  const ipInt = ip2int(ip);
  const rangeInt = ip2int(rangeIp);
  
  const mask = (0xFFFFFFFF << (32 - prefixNum)) >>> 0;
  
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * Нормализует IP адрес (убирает IPv4-mapped IPv6 префикс).
 * @param {string} rawIp
 * @returns {string}
 */
function normalizeIp(rawIp) {
  if (!rawIp) return '';
  // Нормализуем IPv4-mapped IPv6 (::ffff:x.x.x.x → x.x.x.x)
  return rawIp.replace(/^::ffff:/, '');
}

/**
 * Default allowed ranges (localhost + Docker networks).
 * Requirements: 3.2
 */
const DEFAULT_ALLOWED_RANGES = [
  // Loopback (IPv4 и IPv4-mapped IPv6 нормализуются ниже)
  { type: 'exact', value: '127.0.0.1' },
  { type: 'exact', value: '::1' },
  // Docker bridge 172.16.0.0/12
  { type: 'range', start: ip2int('172.16.0.0'), end: ip2int('172.31.255.255') },
  // Internal / Docker custom 10.0.0.0/8
  { type: 'range', start: ip2int('10.0.0.0'), end: ip2int('10.255.255.255') },
];

/**
 * Парсит IP_ALLOWLIST из переменной окружения.
 * Requirements: 3.1, 3.5
 * 
 * @param {string|null} allowlistStr - Comma-separated список IP/CIDR
 * @returns {Array|null} Массив правил или null если не задан
 */
function parseAllowlist(allowlistStr) {
  if (!allowlistStr) return null;
  
  const entries = allowlistStr
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  
  if (entries.length === 0) return null;
  
  return entries.map(entry => {
    // CIDR notation
    if (entry.includes('/')) {
      if (isValidCIDR(entry)) {
        return { type: 'cidr', value: entry };
      }
      console.warn(`[IPAllowlist] Invalid CIDR: ${entry}`);
      return null;
    }
    
    // Exact IP (IPv4 или IPv6)
    if (isValidIPv4(entry) || entry.includes(':')) {
      return { type: 'exact', value: entry };
    }
    
    console.warn(`[IPAllowlist] Invalid IP: ${entry}`);
    return null;
  }).filter(Boolean);
}

/**
 * Проверяет IP по умолчательным правилам (localhost + Docker).
 * Requirements: 3.2
 * 
 * @param {string} ip - Нормализованный IP адрес
 * @returns {boolean}
 */
function checkDefaultRanges(ip) {
  for (const rule of DEFAULT_ALLOWED_RANGES) {
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
 * Проверяет IP по кастомному allowlist.
 * Requirements: 3.3, 3.4
 * 
 * @param {string} ip - Нормализованный IP адрес
 * @param {Array} allowlist - Массив правил из parseAllowlist
 * @returns {boolean}
 */
function checkCustomAllowlist(ip, allowlist) {
  for (const rule of allowlist) {
    if (rule.type === 'exact' && ip === rule.value) {
      return true;
    }
    
    if (rule.type === 'cidr' && isValidIPv4(ip)) {
      if (ipInCIDR(ip, rule.value)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Проверяет, разрешён ли IP.
 * Requirements: 3.2, 3.3, 3.4
 * 
 * @param {string|undefined} rawIp - Сырой IP адрес из запроса
 * @param {Array|null} customAllowlist - Кастомный allowlist или null
 * @returns {boolean}
 */
function isAllowed(rawIp, customAllowlist = null) {
  if (!rawIp) return false;
  
  const ip = normalizeIp(rawIp);
  
  // Если задан кастомный allowlist, используем только его
  if (customAllowlist) {
    return checkCustomAllowlist(ip, customAllowlist);
  }
  
  // Иначе используем default ranges (localhost + Docker)
  return checkDefaultRanges(ip);
}

/**
 * Express middleware: пропускает запросы только с разрешённых IP.
 * Requirements: 3.3, 3.4, 3.6
 */
function ipAllowlistMiddleware(req, res, next) {
  // Получаем IP из заголовков (если за proxy) или напрямую
  // Requirements: 4.5 - поддержка X-Real-IP и X-Forwarded-For
  const clientIp = req.headers['x-real-ip'] ||
                   req.headers['x-forwarded-for']?.split(',')[0].trim() ||
                   req.socket.remoteAddress;
  
  // Парсим allowlist при первом вызове
  const customAllowlist = parseAllowlist(config.ipAllowlist);
  
  const allowed = isAllowed(clientIp, customAllowlist);
  
  // Debug logging
  // Requirements: 3.6
  if (process.env.LLM_PROXY_DEBUG === 'true' || config.logLevel === 'debug') {
    console.log(`[IPAllowlist] ${clientIp} → ${allowed ? 'allowed' : 'denied'}`);
    if (customAllowlist) {
      console.log(`[IPAllowlist] Custom allowlist: ${customAllowlist.length} rules`);
    }
  }
  
  if (!allowed) {
    // Requirements: 3.4
    return res.status(403).json({ error: 'Access denied' });
  }
  
  next();
}

module.exports = ipAllowlistMiddleware;

// Экспортируем функции для тестирования
module.exports.parseAllowlist = parseAllowlist;
module.exports.isAllowed = isAllowed;
module.exports.normalizeIp = normalizeIp;
module.exports.ipInCIDR = ipInCIDR;
