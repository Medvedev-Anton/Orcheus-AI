/**
 * Компонент панели чата
 */

import { $ } from '../utils/dom.js';
import { setStatus } from '../utils/dom.js';
import { fileIcon } from '../../shared/utils.js';

export class ChatPanel {
  constructor(appState) {
    this.state = appState;
    
    this.elMessages = $('messages');
    this.elInput = $('chat-input');
    this.elBtnSend = $('btn-send');

    this._unsubscribeStream = null;
    this._lastFileMessageEl = null;
    
    this._bindEvents();
  }

  _bindEvents() {
    this.elBtnSend.addEventListener('click', () => this.send());
    
    this.elInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        this.send();
      }
    });
    
    $('btn-new-chat').addEventListener('click', () => this.startNewChat());
  }

  addMessage(role, content, files = []) {
    const wrap = document.createElement('div');
    wrap.className = `msg ${role}`;

    if (role !== 'sys') {
      const roleLine = document.createElement('div');
      roleLine.className = 'msg-role';
      roleLine.textContent = role === 'user' ? 'Вы' : role === 'ai' ? 'Flowise AI' : role === 'err' ? '⚠ Ошибка' : '';
      wrap.appendChild(roleLine);
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = content;
    wrap.appendChild(bubble);

    if (files.length > 0) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      files.forEach((f) => {
        const btn = document.createElement('button');
        btn.className = 'chip';
        btn.textContent = `${fileIcon(f.name)} ${f.name}`;
        btn.title = f.fullPath;
        btn.addEventListener('click', () => {
          window.dispatchEvent(new CustomEvent('open-file', { detail: f }));
        });
        chips.appendChild(btn);
      });
      wrap.appendChild(chips);
    }

    this.elMessages.appendChild(wrap);
    this.elMessages.scrollTop = this.elMessages.scrollHeight;
    return wrap;
  }

  addThinking() {
    const wrap = document.createElement('div');
    wrap.className = 'msg ai';
    wrap.id = 'thinking';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    const dots = document.createElement('div');
    dots.className = 'dots';
    dots.innerHTML = '<span></span><span></span><span></span>';
    bubble.appendChild(dots);
    wrap.appendChild(bubble);
    this.elMessages.appendChild(wrap);
    this.elMessages.scrollTop = this.elMessages.scrollHeight;
    return wrap;
  }

  removeThinking() {
    const el = document.getElementById('thinking');
    if (el) el.remove();
  }

  async send() {
    const question = this.elInput.value.trim();
    if (!question || this.state.isGenerating()) return;
    
    const user = this.state.getUser();
    if (!user) {
      window.dispatchEvent(new CustomEvent('show-auth'));
      return;
    }

    // Создаём чат в БД при первом сообщении
    if (!this.state.getCurrentChatId()) {
      const chatTitle = question.length > 60 ? question.slice(0, 60) + '…' : question;
      const chatResult = await window.api.createChat(chatTitle);
      if (chatResult.ok) {
        this.state.setCurrentChatId(chatResult.chat.id);
      }
    }

    this.state.setGenerating(true);
    this.elBtnSend.disabled = true;
    this.elBtnSend.textContent = '...';
    this.elInput.value = '';

    this.addMessage('user', question);
    this.addThinking();
    setStatus('Генерируем...');

    // Сохраняем сообщение пользователя
    const chatId = this.state.getCurrentChatId();
    if (chatId) {
      window.api.saveMessage(chatId, 'user', question, []).catch(console.error);
    }

    // Подписываемся на SSE-события
    this._unsubscribeStream = window.api.onStreamEvent(this._handleStreamEvent.bind(this));

    // Запускаем потоковую генерацию
    await window.api.generate(question, this.state.getChatId());
  }

  _unlockInput() {
    this.state.setGenerating(false);
    this.elBtnSend.disabled = false;
    this.elBtnSend.textContent = 'Отправить ▶';
    if (this._unsubscribeStream) {
      this._unsubscribeStream();
      this._unsubscribeStream = null;
    }
  }

  _handleStreamEvent(event) {
    const chatId = this.state.getCurrentChatId();

    switch (event.type) {
      case 'status': {
        // Обновляем текст индикатора загрузки
        const thinking = document.getElementById('thinking');
        if (thinking) {
          const bubble = thinking.querySelector('.msg-bubble');
          if (bubble) bubble.textContent = event.message;
        }
        setStatus(event.message);
        break;
      }

      case 'plan': {
        this.removeThinking();
        const fileList = event.files.map(f => `• ${f.name}`).join('\n');
        const planText = `📋 План готов. Буду создавать:\n${fileList}`;
        this.addMessage('ai', planText);
        if (chatId) {
          window.api.saveMessage(chatId, 'ai', planText, []).catch(console.error);
        }
        break;
      }

      case 'file_start': {
        const msg = this.addMessage('ai', `⏳ Генерирую файл \`${event.name}\`...`);
        this._lastFileMessageEl = msg;
        break;
      }

      case 'file_done': {
        // Записываем файл локально
        if (event.name && event.content) {
          const projectRoot = this.state.getSettings()?.projectRoot;
          if (projectRoot) {
            // Формируем полный путь к файлу
            const path = require('path');
            const fullPath = path.join(projectRoot, event.name);
            
            // Вызываем IPC для записи файла
            window.api.writeFile(fullPath, event.content).then(result => {
              if (result.ok) {
                console.log(`[ChatPanel] Файл записан: ${event.name}`);
              } else {
                console.error(`[ChatPanel] Ошибка записи файла: ${result.error}`);
              }
            }).catch(console.error);
          }
        }
        
        if (this._lastFileMessageEl) {
          const bubble = this._lastFileMessageEl.querySelector('.msg-bubble');
          if (bubble) bubble.textContent = `✅ Файл \`${event.name}\` создан`;

          // Добавляем кликабельный chip
          const chips = document.createElement('div');
          chips.className = 'chips';
          const btn = document.createElement('button');
          btn.className = 'chip';
          btn.textContent = `${fileIcon(event.name)} ${event.name}`;
          btn.title = event.name;
          btn.addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('open-file', { detail: event }));
          });
          chips.appendChild(btn);
          this._lastFileMessageEl.appendChild(chips);
          this._lastFileMessageEl = null;
        }
        this.elMessages.scrollTop = this.elMessages.scrollHeight;
        window.dispatchEvent(new CustomEvent('files-generated', { detail: [event] }));
        break;
      }

      case 'done': {
        const n = event.files.length;
        const doneText = `🎉 Проект готов. Создано файлов: ${n}`;
        this.addMessage('ai', doneText);
        setStatus(`Готово — ${n} файл(ов) сгенерировано`);
        if (chatId) {
          window.api.saveMessage(chatId, 'ai', doneText, event.files).catch(console.error);
          window.dispatchEvent(new CustomEvent('chat-updated'));
        }
        // Показываем статистику токенов если есть
        if (event.tokenUsage && event.tokenUsage.totalTokens > 0) {
          const u = event.tokenUsage;
          this.addMessage('sys', `📊 Токены: ${u.totalTokens.toLocaleString()} (запросов к модели: ${u.requests})`);
        }
        this._unlockInput();
        break;
      }

      case 'error': {
        const errText = event.message || 'Неизвестная ошибка';
        this.addMessage('err', errText);
        setStatus('Ошибка');
        if (chatId) {
          window.api.saveMessage(chatId, 'err', errText, []).catch(console.error);
        }
        this._unlockInput();
        break;
      }
    }
  }

  startNewChat() {
    this.state.setCurrentChatId(null);
    this.elMessages.innerHTML = '';
    this.addMessage('sys', '🆕 Новый чат начат. Контекст предыдущего диалога сброшен.');
    window.dispatchEvent(new CustomEvent('new-chat'));
  }

  clear() {
    this.elMessages.innerHTML = '';
  }
}
