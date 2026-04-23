/**
 * DOM утилиты для renderer процесса
 */

/**
 * Получение элемента по ID
 * @param {string} id - ID элемента
 * @returns {HTMLElement|null}
 */
export const $ = (id) => document.getElementById(id);

/**
 * Получение элементов по селектору
 * @param {string} selector - CSS селектор
 * @returns {NodeList}
 */
export const $$ = (selector) => document.querySelectorAll(selector);

/**
 * Создание элемента с классом и текстом
 * @param {string} tag - Тег элемента
 * @param {string} className - Класс элемента
 * @param {string} textContent - Текст элемента
 * @returns {HTMLElement}
 */
export function createElement(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent) el.textContent = textContent;
  return el;
}

/**
 * Установка текста статусной строки
 * @param {string} text - Текст статуса
 */
export function setStatus(text) {
  const el = $('st-text');
  if (el) el.textContent = text;
}
