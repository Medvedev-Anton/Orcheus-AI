'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Settings
  loadSettings: ()         => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // Auth
  getUser: ()                         => ipcRenderer.invoke('auth:get-user'),
  signIn:  (email, password)          => ipcRenderer.invoke('auth:sign-in', { email, password }),
  signUp:  (email, password)          => ipcRenderer.invoke('auth:sign-up', { email, password }),
  signOut: ()                         => ipcRenderer.invoke('auth:sign-out'),

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

  // Chat history
  createChat:       (title)                        => ipcRenderer.invoke('chats:create',       { title }),
  listChats:        ()                             => ipcRenderer.invoke('chats:list'),
  loadChatMessages: (chatId)                       => ipcRenderer.invoke('chats:load-messages', { chatId }),
  deleteChat:       (chatId)                       => ipcRenderer.invoke('chats:delete',        { chatId }),
  saveMessage:      (chatId, role, content, files) => ipcRenderer.invoke('messages:save',       { chatId, role, content, files }),
});
