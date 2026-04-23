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

    const result = await window.api.predict(question, this.state.getChatId());

    this.removeThinking();
    this.state.setGenerating(false);
    this.elBtnSend.disabled = false;
    this.elBtnSend.textContent = 'Отправить ▶';

    if (result.ok) {
      const n = result.files.length;
      const aiText = `✅ Готово! Записано файлов: ${n}`;
      this.addMessage('ai', aiText, result.files);
      setStatus(`Готово — ${n} файл(ов) сгенерировано`);
      
      if (chatId) {
        window.api.saveMessage(chatId, 'ai', aiText, result.files).catch(console.error);
        window.dispatchEvent(new CustomEvent('chat-updated'));
      }
      
      window.dispatchEvent(new CustomEvent('files-generated', { detail: result.files }));
    } else {
      const errText = result.error || 'Неизвестная ошибка';
      this.addMessage('err', errText);
      setStatus('Ошибка');
      
      if (chatId) {
        window.api.saveMessage(chatId, 'err', errText, []).catch(console.error);
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
