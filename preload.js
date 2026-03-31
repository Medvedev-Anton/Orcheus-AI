'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Settings
  loadSettings: ()         => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // Flowise generation
  predict: (question, chatId) =>
    ipcRenderer.invoke('flowise:predict', { question, chatId }),

  // Progress events from main → renderer
  onProgress: (cb) => {
    const handler = (_e, msg) => cb(msg);
    ipcRenderer.on('flowise:progress', handler);
    // Returns unsubscribe function
    return () => ipcRenderer.removeListener('flowise:progress', handler);
  },

  // File system
  listFiles:  ()                     => ipcRenderer.invoke('files:list'),
  readFile:   (filePath)             => ipcRenderer.invoke('files:read', filePath),
  writeFile:  (filePath, content)    => ipcRenderer.invoke('files:write', { filePath, content }),

  // Shell / dialogs
  openFolder: ()  => ipcRenderer.invoke('shell:open-folder'),
  pickFolder: ()  => ipcRenderer.invoke('dialog:pick-folder'),
});
