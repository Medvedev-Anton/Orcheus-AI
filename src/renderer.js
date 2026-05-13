/**
 * Orcheus AI - Renderer процесс
 * Точка входа UI
 */

import { $ } from './renderer/utils/dom.js';
import { shortenPath } from './renderer/utils/format.js';
import { AppState } from './renderer/state/app-state.js';
import { AuthModal } from './renderer/components/auth-modal.js';
import { SettingsModal } from './renderer/components/settings-modal.js';
import { ChatPanel } from './renderer/components/chat-panel.js';
import { ChatList } from './renderer/components/chat-list.js';
import { FileTree } from './renderer/components/file-tree.js';
import { CodeViewer } from './renderer/components/code-viewer.js';
import { ResizablePanels } from './renderer/components/resizable-panels.js';

// Глобальное состояние
const state = new AppState();

// Компоненты
let authModal, settingsModal, chatPanel, chatList, fileTree, codeViewer;

// Инициализация
async function init() {
  // Применить тему
  const theme = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  
  // Загрузить настройки
  const settings = await window.api.loadSettings();
  state.setSettings(settings);
  $('project-path-label').textContent = shortenPath(settings.projectRoot, 50);
  
  // Проверить авторизацию
  const authResult = await window.api.getUser();
  state.setUser(authResult?.user);
  
  // Инициализировать компоненты
  authModal = new AuthModal(state);
  settingsModal = new SettingsModal(state);
  chatPanel = new ChatPanel(state);
  chatList = new ChatList(state);
  fileTree = new FileTree(state);
  codeViewer = new CodeViewer(state);
  new ResizablePanels();
  
  // Подписаться на progress events
  window.api.onProgress((msg) => chatPanel.addMessage('sys', msg));
  
  // Обработчики событий
  _setupEventListeners();
  
  // Начальные сообщения
  chatPanel.addMessage('sys', '⚡ Orcheus AI готов к работе.');
  if (authResult.user) {
    chatPanel.addMessage('sys', `👤 Вы вошли как: ${authResult.user.email}`);
    chatList.load();
  } else {
    authModal.show();
  }
  chatPanel.addMessage('sys', 'Введите запрос и нажмите «Отправить» или Ctrl+Enter.');
  
  // Загрузить дерево файлов
  await fileTree.refresh();
  
  // Обновить UI пользователя
  _updateUserUI(authResult.user);
}

function _setupEventListeners() {
  // Авторизация
  window.addEventListener('auth-success', (e) => {
    chatPanel.addMessage('sys', `✅ Добро пожаловать, ${e.detail.email}!`);
    chatList.load();
  });
  
  window.addEventListener('show-auth', () => {
    authModal.show();
  });
  
  $('btn-logout').addEventListener('click', async () => {
    const result = await window.api.signOut();
    if (result.ok) {
      state.setUser(null);
      authModal.show();
      chatPanel.addMessage('sys', 'Вы вышли из аккаунта.');
      _updateUserUI(null);
    }
  });
  
  // Настройки
  window.addEventListener('settings-saved', async () => {
    chatPanel.addMessage('sys', '✅ Настройки сохранены.');
    await fileTree.refresh();
  });
  
  // Файлы
  window.addEventListener('files-generated', async (e) => {
    await fileTree.refresh();
    if (e.detail.length > 0) {
      const first = e.detail[0];
      await codeViewer.openFile(first.fullPath, first.name);
    }
  });
  
  window.addEventListener('open-file', (e) => {
    console.log('[Renderer] open-file event:', e.detail);
    codeViewer.openFile(e.detail.fullPath, e.detail.name);
  });
  
  // Чаты
  window.addEventListener('chat-updated', () => {
    chatList.load();
  });
  
  window.addEventListener('new-chat', () => {
    chatList.updateActive();
  });
  
  window.addEventListener('chat-deleted', () => {
    chatPanel.clear();
    chatPanel.addMessage('sys', 'Чат удалён. Начните новый или выберите другой из списка.');
  });
  
  window.addEventListener('switch-chat', async (e) => {
    console.log('[Renderer] switch-chat event:', e.detail);
    chatPanel.clear();
    chatList.updateActive();
    
    const result = await window.api.loadChatMessages(e.detail.chatId);
    console.log('[Renderer] loadChatMessages result:', result);
    
    if (result.ok) {
      if (result.messages.length > 0) {
        for (const msg of result.messages) {
          chatPanel.addMessage(msg.role, msg.content, msg.files || []);
        }
      } else {
        chatPanel.addMessage('sys', `💬 ${e.detail.title || 'Чат'} — история пуста`);
      }
    } else {
      chatPanel.addMessage('err', 'Не удалось загрузить историю: ' + result.error);
    }
  });
}

function _updateUserUI(user) {
  const elUserEmail = $('user-email');
  const elBtnLogout = $('btn-logout');
  const elBtnSend = $('btn-send');
  const elInput = $('chat-input');
  
  if (user) {
    elUserEmail.textContent = user.email || '';
    elBtnLogout.classList.remove('hidden');
    elBtnSend.disabled = false;
    elInput.disabled = false;
    elInput.placeholder = 'Опишите что нужно создать...\n(Ctrl + Enter — отправить)';
  } else {
    elUserEmail.textContent = '';
    elBtnLogout.classList.add('hidden');
    elBtnSend.disabled = true;
    elInput.disabled = true;
    elInput.placeholder = 'Войдите в аккаунт для отправки запросов';
  }
}

// Запуск
init();
