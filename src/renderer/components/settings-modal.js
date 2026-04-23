/**
 * Компонент модального окна настроек
 */

import { $ } from '../utils/dom.js';

export class SettingsModal {
  constructor(appState) {
    this.state = appState;
    
    this.elModal = $('modal-settings');
    this.elModalBg = $('modal-bg');
    this.elSRoot = $('s-root');
    this.elSTheme = $('s-theme');
    
    this._bindEvents();
  }

  _bindEvents() {
    $('btn-settings').addEventListener('click', () => this.open());
    $('btn-modal-close').addEventListener('click', () => this.close());
    $('btn-cancel').addEventListener('click', () => this.close());
    $('btn-save').addEventListener('click', () => this.save());
    $('btn-pick').addEventListener('click', async () => {
      const result = await window.api.pickFolder();
      if (result.ok) this.elSRoot.value = result.path;
    });
    
    this.elModalBg.addEventListener('click', () => this.close());
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.elModal.classList.contains('hidden')) {
        this.close();
      }
    });
  }

  open() {
    const settings = this.state.getSettings();
    this.elSRoot.value = settings.projectRoot || '';
    this.elSTheme.value = localStorage.getItem('theme') || 'dark';
    this.elModal.classList.remove('hidden');
    this.elSRoot.focus();
  }

  close() {
    this.elModal.classList.add('hidden');
  }

  async save() {
    const settings = this.state.getSettings();
    const updated = {
      ...settings,
      projectRoot: this.elSRoot.value.trim() || settings.projectRoot,
    };
    
    await window.api.saveSettings(updated);
    this.state.setSettings(updated);
    this._applyTheme(this.elSTheme.value);
    this.close();
    
    window.dispatchEvent(new CustomEvent('settings-saved'));
  }

  _applyTheme(theme) {
    const t = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
  }
}
