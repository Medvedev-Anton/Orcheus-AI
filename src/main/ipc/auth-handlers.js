/**
 * IPC обработчики для авторизации
 */

const { ipcMain } = require('electron');
const { getUser, signIn, signUp, signOut } = require('../services/auth');

/**
 * Регистрация IPC обработчиков для авторизации
 */
function registerAuthHandlers() {
  ipcMain.handle('auth:get-user', async () => {
    console.log('[Auth] get-user');
    const { user } = await getUser();
    console.log('[Auth] get-user result:', user ? user.email : 'null');
    return { ok: true, user: user ?? null };
  });

  ipcMain.handle('auth:sign-in', async (_e, { email, password }) => {
    console.log('[Auth] sign-in attempt:', email);
    const result = await signIn(email, password);
    if (result.ok) console.log('[Auth] sign-in ok:', result.user.email);
    return result;
  });

  ipcMain.handle('auth:sign-up', async (_e, { email, password }) => {
    console.log('[Auth] sign-up attempt:', email);
    const result = await signUp(email, password);
    if (result.ok) console.log('[Auth] sign-up ok, session:', !!result.user);
    return result;
  });

  ipcMain.handle('auth:sign-out', async () => {
    console.log('[Auth] sign-out');
    return await signOut();
  });
}

module.exports = { registerAuthHandlers };
