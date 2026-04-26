/**
 * Компонент списка чатов
 */

import { $ } from '../utils/dom.js';
import { formatChatDate } from '../utils/format.js';

export class ChatList {
  constructor(appState) {
    this.state = appState;
    
    this.elChatList = $('chat-list');
    this.elTabChats = $('tab-chats');
    this.elTabFiles = $('tab-files');
    this.elChatListPanel = $('chat-list-panel');
    this.elFilePanel = $('file-panel');
    
    this._bindEvents();
  }

  _bindEvents() {
    this.elTabChats.addEventListener('click', () => this._showChatsTab());
    this.elTabFiles.addEventListener('click', () => this._showFilesTab());
  }

  _showChatsTab() {
    this.elTabChats.classList.add('active');
    this.elTabFiles.classList.remove('active');
    this.elChatListPanel.classList.remove('hidden');
    this.elFilePanel.classList.add('hidden');
  }

  _showFilesTab() {
    this.elTabFiles.classList.add('active');
    this.elTabChats.classList.remove('active');
    this.elFilePanel.classList.remove('hidden');
    this.elChatListPanel.classList.add('hidden');
  }

  async load() {
    const user = this.state.getUser();
    if (!user) return;
    
    const result = await window.api.listChats();
    this.render(result.ok ? result.chats : []);
  }

  render(chats) {
    this.elChatList.innerHTML = '';
    
    if (!chats || chats.length === 0) {
      this.elChatList.innerHTML = '<p class="hint-text">Нет сохранённых чатов.<br>Отправьте сообщение, чтобы начать.</p>';
      return;
    }

    const currentChatId = this.state.getCurrentChatId();
    
    for (const chat of chats) {
      const item = document.createElement('div');
      item.className = 'chat-item' + (chat.id === currentChatId ? ' active' : '');
      item.dataset.id = chat.id;

      const info = document.createElement('div');
      info.className = 'chat-item-info';

      const title = document.createElement('div');
      title.className = 'chat-item-title';
      title.textContent = chat.title || 'Чат';

      const date = document.createElement('div');
      date.className = 'chat-item-date';
      date.textContent = formatChatDate(chat.updated_at);

      info.appendChild(title);
      info.appendChild(date);

      const delBtn = document.createElement('button');
      delBtn.className = 'chat-item-del';
      delBtn.title = 'Удалить чат';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await window.api.deleteChat(chat.id);
        if (res.ok) {
          if (this.state.getCurrentChatId() === chat.id) {
            this.state.setCurrentChatId(null);
            window.dispatchEvent(new CustomEvent('chat-deleted'));
          }
          await this.load();
        }
      });

      item.appendChild(info);
      item.appendChild(delBtn);
      item.addEventListener('click', () => this.switchToChat(chat.id, chat.title));
      this.elChatList.appendChild(item);
    }
  }

  async switchToChat(chatId, title) {
    console.log('[ChatList] switchToChat:', chatId, title);
    this.state.setCurrentChatId(chatId);
    
    document.querySelectorAll('.chat-item').forEach((el) =>
      el.classList.toggle('active', el.dataset.id === chatId)
    );
    
    window.dispatchEvent(new CustomEvent('switch-chat', { 
      detail: { chatId, title } 
    }));
  }

  updateActive() {
    const currentChatId = this.state.getCurrentChatId();
    document.querySelectorAll('.chat-item').forEach((el) =>
      el.classList.toggle('active', el.dataset.id === currentChatId)
    );
  }
}
