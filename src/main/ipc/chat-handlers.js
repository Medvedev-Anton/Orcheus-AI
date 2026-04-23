/**
 * IPC обработчики для чатов
 */

const { ipcMain } = require('electron');
const { getUser } = require('../services/auth');
const {
  createChat,
  listChats,
  loadChatMessages,
  deleteChat,
  saveMessage
} = require('../services/chat');

/**
 * Регистрация IPC обработчиков для чатов
 */
function registerChatHandlers() {
  ipcMain.handle('chats:create', async (_e, { title }) => {
    const { user } = await getUser();
    if (!user) return { ok: false, error: 'Не авторизован' };
    return await createChat(user.id, title);
  });

  ipcMain.handle('chats:list', async () => {
    const { user } = await getUser();
    if (!user) return { ok: false, error: 'Не авторизован', chats: [] };
    return await listChats(user.id);
  });

  ipcMain.handle('chats:load-messages', async (_e, { chatId }) => {
    const { user } = await getUser();
    if (!user) return { ok: false, error: 'Не авторизован', messages: [] };
    if (!chatId) return { ok: false, error: 'chatId обязателен', messages: [] };
    return await loadChatMessages(user.id, chatId);
  });

  ipcMain.handle('chats:delete', async (_e, { chatId }) => {
    const { user } = await getUser();
    if (!user) return { ok: false, error: 'Не авторизован' };
    if (!chatId) return { ok: false, error: 'chatId обязателен' };
    return await deleteChat(user.id, chatId);
  });

  ipcMain.handle('messages:save', async (_e, { chatId, role, content, files }) => {
    const { user } = await getUser();
    if (!user) return { ok: false, error: 'Не авторизован' };
    if (!chatId) return { ok: false, error: 'chatId обязателен' };
    return await saveMessage(user.id, chatId, role, content, files);
  });
}

module.exports = { registerChatHandlers };
