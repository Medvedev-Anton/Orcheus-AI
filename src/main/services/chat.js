/**
 * Управление чатами и сообщениями в Supabase
 */

const { getSupabaseClient } = require('./auth');

/**
 * Создание чата
 * @param {string} userId - ID пользователя
 * @param {string} title - Заголовок чата
 * @returns {Promise<{ok: boolean, chat?: object, error?: string}>}
 */
async function createChat(userId, title) {
  try {
    const supabase = getSupabaseClient();
    const safeTitle = typeof title === 'string' && title.trim()
      ? title.trim().slice(0, 200)
      : 'Новый чат';
    
    const { data, error } = await supabase
      .from('chats')
      .insert({ user_id: userId, title: safeTitle })
      .select()
      .single();
    
    if (error) {
      console.error('[Chats] create error:', error.message);
      return { ok: false, error: error.message };
    }
    
    console.log('[Chats] created:', data.id);
    return { ok: true, chat: data };
  } catch (err) {
    console.error('[Chats] create exception:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Получение списка чатов
 * @param {string} userId - ID пользователя
 * @returns {Promise<{ok: boolean, chats?: Array, error?: string}>}
 */
async function listChats(userId) {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('chats')
      .select('id, title, created_at, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(100);
    
    if (error) {
      console.error('[Chats] list error:', error.message);
      return { ok: false, error: error.message, chats: [] };
    }
    
    return { ok: true, chats: data || [] };
  } catch (err) {
    console.error('[Chats] list exception:', err.message);
    return { ok: false, error: err.message, chats: [] };
  }
}

/**
 * Загрузка сообщений чата
 * @param {string} userId - ID пользователя
 * @param {string} chatId - ID чата
 * @returns {Promise<{ok: boolean, messages?: Array, error?: string}>}
 */
async function loadChatMessages(userId, chatId) {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('messages')
      .select('id, role, content, files, created_at')
      .eq('chat_id', chatId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    
    if (error) {
      console.error('[Chats] load-messages error:', error.message);
      return { ok: false, error: error.message, messages: [] };
    }
    
    return { ok: true, messages: data || [] };
  } catch (err) {
    console.error('[Chats] load-messages exception:', err.message);
    return { ok: false, error: err.message, messages: [] };
  }
}

/**
 * Удаление чата
 * @param {string} userId - ID пользователя
 * @param {string} chatId - ID чата
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function deleteChat(userId, chatId) {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from('chats')
      .delete()
      .eq('id', chatId)
      .eq('user_id', userId);
    
    if (error) {
      console.error('[Chats] delete error:', error.message);
      return { ok: false, error: error.message };
    }
    
    console.log('[Chats] deleted:', chatId);
    return { ok: true };
  } catch (err) {
    console.error('[Chats] delete exception:', err.message);
    return { ok: false, error: err.message };
  }
}

/**
 * Сохранение сообщения
 * @param {string} userId - ID пользователя
 * @param {string} chatId - ID чата
 * @param {string} role - Роль (user, ai, err)
 * @param {string} content - Содержимое
 * @param {Array} files - Массив файлов
 * @returns {Promise<{ok: boolean, id?: string, error?: string}>}
 */
async function saveMessage(userId, chatId, role, content, files) {
  try {
    const supabase = getSupabaseClient();
    const allowedRoles = ['user', 'ai', 'err'];
    if (!allowedRoles.includes(role)) {
      return { ok: false, error: 'Недопустимая роль: ' + role };
    }

    const safeFiles = Array.isArray(files) ? files : [];
    const { data, error } = await supabase
      .from('messages')
      .insert({
        chat_id: chatId,
        user_id: userId,
        role,
        content: content ?? '',
        files: safeFiles
      })
      .select('id')
      .single();
    
    if (error) {
      console.error('[Messages] save error:', error.message);
      return { ok: false, error: error.message };
    }

    // Обновить timestamp чата
    await supabase
      .from('chats')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', chatId)
      .eq('user_id', userId);

    return { ok: true, id: data.id };
  } catch (err) {
    console.error('[Messages] save exception:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  createChat,
  listChats,
  loadChatMessages,
  deleteChat,
  saveMessage,
};
