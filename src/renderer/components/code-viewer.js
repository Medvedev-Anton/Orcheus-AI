/**
 * Компонент просмотра и редактирования кода
 */

import { $ } from '../utils/dom.js';
import { setStatus } from '../utils/dom.js';

export class CodeViewer {
  constructor(appState) {
    this.state = appState;
    
    this.elCodeFname = $('code-fname');
    this.elLineNums = $('line-nums');
    this.elCodePre = $('code-pre');
    this.elCodeEditor = $('code-editor');
    this.elBtnCopy = $('btn-copy');
    this.elBtnEdit = $('btn-edit');
    this.elBtnSaveFile = $('btn-save-file');
    this.elBtnDiscard = $('btn-discard');
    
    this._bindEvents();
    this.setEditMode(false);
  }

  _bindEvents() {
    this.elBtnCopy.addEventListener('click', () => this.copyCode());
    this.elBtnEdit.addEventListener('click', () => {
      if (this.state.getCurrentFilePath()) this.setEditMode(true);
    });
    this.elBtnSaveFile.addEventListener('click', () => this.saveFile());
    this.elBtnDiscard.addEventListener('click', () => this.discardChanges());
    
    this.elCodeEditor.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        this.saveFile();
      }
      if (e.key === 'Escape') {
        this.elCodeEditor.value = this.elCodePre.textContent;
        this.setEditMode(false);
      }
    });
    
    this.elCodeEditor.addEventListener('scroll', () => {
      this.elLineNums.scrollTop = this.elCodeEditor.scrollTop;
    });
  }

  setEditMode(on) {
    this.state.setEditMode(on);
    this.elCodePre.classList.toggle('hidden', on);
    this.elCodeEditor.classList.toggle('hidden', !on);
    this.elBtnEdit.classList.toggle('hidden', on);
    this.elBtnSaveFile.classList.toggle('hidden', !on);
    this.elBtnDiscard.classList.toggle('hidden', !on);
    
    if (on) {
      this.elCodeEditor.focus();
      this.elCodeEditor.addEventListener('input', () => this._syncEditorLineNums());
    } else {
      this.elCodeEditor.removeEventListener('input', () => this._syncEditorLineNums());
    }
  }

  _syncEditorLineNums() {
    const lines = this.elCodeEditor.value.split('\n');
    const pad = String(lines.length).length;
    this.elLineNums.textContent = lines.map((_, i) => String(i + 1).padStart(pad, ' ')).join('\n');
    this.elLineNums.scrollTop = this.elCodeEditor.scrollTop;
  }

  async openFile(fullPath, name) {
    console.log('[CodeViewer] openFile:', fullPath, name);
    if (this.state.isEditMode()) this.setEditMode(false);
    this.state.setCurrentFilePath(fullPath);

    this.elCodeFname.textContent = name || fullPath;
    this.elLineNums.textContent = '';
    this.elCodePre.textContent = 'Загружаем…';
    this.elCodeEditor.value = '';

    const result = await window.api.readFile(fullPath);
    console.log('[CodeViewer] readFile result:', result);

    if (!result.ok) {
      this.elCodePre.textContent = `Ошибка чтения файла:\n${result.error}`;
      return;
    }

    const lines = result.content.split('\n');
    const pad = String(lines.length).length;
    this.elLineNums.textContent = lines.map((_, i) => String(i + 1).padStart(pad, ' ')).join('\n');
    this.elCodePre.textContent = result.content;
    this.elCodeEditor.value = result.content;
  }

  async saveFile() {
    const filePath = this.state.getCurrentFilePath();
    if (!filePath) return;
    
    const content = this.elCodeEditor.value;
    const result = await window.api.writeFile(filePath, content);
    
    if (result.ok) {
      this.elCodePre.textContent = content;
      this.setEditMode(false);
      this._syncEditorLineNums();
      setStatus('Файл сохранён');
    } else {
      setStatus('Ошибка сохранения: ' + result.error);
    }
  }

  discardChanges() {
    if (!this.state.isEditMode()) return;
    this.elCodeEditor.value = this.elCodePre.textContent;
    this.setEditMode(false);
  }

  async copyCode() {
    const code = this.state.isEditMode() ? this.elCodeEditor.value : this.elCodePre.textContent;
    if (!code) return;
    
    try {
      await navigator.clipboard.writeText(code);
      const orig = this.elBtnCopy.textContent;
      this.elBtnCopy.textContent = '✓ Скопировано';
      setTimeout(() => { this.elBtnCopy.textContent = orig; }, 1800);
    } catch (_) { /* clipboard */ }
  }
}
