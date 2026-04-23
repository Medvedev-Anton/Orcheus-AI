/**
 * IPC обработчики для файловых операций
 */

const { ipcMain, shell, dialog } = require('electron');
const { listDir, readFile, writeFile } = require('../services/files');
const { loadSettings } = require('../config/settings');

let mainWindow = null;

/**
 * Установить ссылку на главное окно
 * @param {BrowserWindow} window
 */
function setMainWindow(window) {
  mainWindow = window;
}

/**
 * Регистрация IPC обработчиков для файлов
 */
function registerFileHandlers() {
  ipcMain.handle('files:list', async () => {
    const { projectRoot } = loadSettings();
    try {
      const tree = await listDir(projectRoot, '');
      return { ok: true, tree, root: projectRoot };
    } catch (err) {
      return { ok: false, error: err.message, tree: [], root: projectRoot };
    }
  });

  ipcMain.handle('files:read', async (_e, filePath) => {
    return await readFile(filePath);
  });

  ipcMain.handle('files:write', async (_e, { filePath, content }) => {
    const { projectRoot } = loadSettings();
    return await writeFile(filePath, content, projectRoot);
  });

  ipcMain.handle('shell:open-folder', async () => {
    const { projectRoot } = loadSettings();
    try {
      const fsp = require('fs/promises');
      await fsp.mkdir(projectRoot, { recursive: true });
      shell.openPath(projectRoot);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false };
    return { ok: true, path: result.filePaths[0] };
  });
}

module.exports = { registerFileHandlers, setMainWindow };
