/**
 * Авторизация через Supabase
 */

const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_ANON, SESSION_FILE } = require('../config/constants');

if (!SUPABASE_URL || !SUPABASE_ANON) {
  console.error('[Supabase] SUPABASE_URL или SUPABASE_ANON_KEY не заданы. Проверьте файл .env');
}

// File-based storage для сессии
let _sessionStore = {};
try {
  if (fs.existsSync(SESSION_FILE)) {
    _sessionStore = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    console.log('[Auth] Session file loaded, keys:', Object.keys(_sessionStore));
  } else {
    console.log('[Auth] No session file found at:', SESSION_FILE);
  }
} catch (err) {
  console.error('[Auth] Error loading session:', err.message);
}

const _fileStorage = {
  getItem: (key) => {
    const value = _sessionStore[key] ?? null;
    console.log('[Auth] Storage.getItem:', key, value ? 'found' : 'not found');
    return value;
  },
  setItem: (key, value) => {
    console.log('[Auth] Storage.setItem:', key);
    _sessionStore[key] = value;
    try { fs.writeFileSync(SESSION_FILE, JSON.stringify(_sessionStore), 'utf8'); } catch (err) { console.error('[Auth] Storage.setItem error:', err.message); }
  },
  removeItem: (key) => {
    console.log('[Auth] Storage.removeItem:', key);
    delete _sessionStore[key];
    try { fs.writeFileSync(SESSION_FILE, JSON.stringify(_sessionStore), 'utf8'); } catch (err) { console.error('[Auth] Storage.removeItem error:', err.message); }
  },
};

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    storage: _fileStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * Получение Supabase клиента
 * @returns {object} Supabase клиент
 */
function getSupabaseClient() {
  return supabase;
}

/**
 * Получение текущего пользователя
 * @returns {Promise<{user: object|null}>}
 */
async function getUser() {
  try {
    console.log('[Auth] getUser: checking session...');
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) {
      console.error('[Auth] getUser error:', error.message);
    }
    console.log('[Auth] getUser result:', user ? user.email : 'null');
    return { user: user ?? null };
  } catch (err) {
    console.error('[Auth] getUser exception:', err.message);
    return { user: null };
  }
}

/**
 * Вход в систему
 * @param {string} email - Email пользователя
 * @param {string} password - Пароль
 * @returns {Promise<{ok: boolean, user?: object, error?: string}>}
 */
async function signIn(email, password) {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      console.error('[Auth] signIn error:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, user: data.user };
  } catch (err) {
    console.error('[Auth] signIn exception:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Регистрация
 * @param {string} email - Email пользователя
 * @param {string} password - Пароль
 * @returns {Promise<{ok: boolean, user?: object, needsConfirmation?: boolean, error?: string}>}
 */
async function signUp(email, password) {
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      console.error('[Auth] signUp error:', error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, user: data.user, needsConfirmation: !data.session };
  } catch (err) {
    console.error('[Auth] signUp exception:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Выход из системы
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function signOut() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getSupabaseClient,
  getUser,
  signIn,
  signUp,
  signOut,
};
