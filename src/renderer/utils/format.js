/**
 * Утилиты форматирования для renderer процесса
 */

/**
 * Форматирование даты чата
 * @param {string} isoStr - ISO строка даты
 * @returns {string} Отформатированная дата
 */
export function formatChatDate(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

/**
 * Сокращение длинного пути
 * @param {string} p - Путь
 * @param {number} maxLen - Максимальная длина
 * @returns {string} Сокращённый путь
 */
export function shortenPath(p, maxLen) {
  if (!p) return '';
  if (p.length <= maxLen) return p;
  const parts = p.replace(/\\/g, '/').split('/');
  if (parts.length > 3) return `…/${parts.slice(-2).join('/')}`;
  return p;
}
