/**
 * Компонент модального окна авторизации
 */

import { $ } from '../utils/dom.js';

export class AuthModal {
  constructor(appState) {
    this.state = appState;
    this.authMode = 'login';
    
    this.elModal = $('modal-auth');
    this.elEmail = $('auth-email');
    this.elPass = $('auth-password');
    this.elError = $('auth-error');
    this.elInfo = $('auth-info');
    this.elBtnSubmit = $('btn-auth-submit');
    this.elTabLogin = $('auth-tab-login');
    this.elTabReg = $('auth-tab-register');
    
    this._bindEvents();
  }

  _bindEvents() {
    this.elTabLogin.addEventListener('click', () => this.setMode('login'));
    this.elTabReg.addEventListener('click', () => this.setMode('register'));
    this.elBtnSubmit.addEventListener('click', () => this.submit());
    
    this.elEmail.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.elPass.focus();
    });
    
    this.elPass.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submit();
    });
  }

  show() {
    this.elModal.classList.remove('hidden');
    this.elEmail.focus();
  }

  hide() {
    this.elModal.classList.add('hidden');
  }

  setMode(mode) {
    this.authMode = mode;
    if (mode === 'login') {
      this.elTabLogin.classList.add('active');
      this.elTabReg.classList.remove('active');
      this.elBtnSubmit.textContent = 'Войти';
      this.elPass.autocomplete = 'current-password';
    } else {
      this.elTabReg.classList.add('active');
      this.elTabLogin.classList.remove('active');
      this.elBtnSubmit.textContent = 'Создать аккаунт';
      this.elPass.autocomplete = 'new-password';
    }
    this.elError.classList.add('hidden');
    this.elInfo.classList.add('hidden');
  }

  showError(msg) {
    this.elError.textContent = msg;
    this.elError.classList.remove('hidden');
    this.elInfo.classList.add('hidden');
  }

  showInfo(msg) {
    this.elInfo.textContent = msg;
    this.elInfo.classList.remove('hidden');
    this.elError.classList.add('hidden');
  }

  async submit() {
    const email = this.elEmail.value.trim();
    const password = this.elPass.value;

    if (!email || !password) {
      this.showError('Заполните email и пароль');
      return;
    }
    if (password.length < 6) {
      this.showError('Пароль должен быть не менее 6 символов');
      return;
    }

    this.elBtnSubmit.disabled = true;
    this.elBtnSubmit.textContent = '…';
    this.elError.classList.add('hidden');
    this.elInfo.classList.add('hidden');

    try {
      let result;
      if (this.authMode === 'login') {
        result = await window.api.signIn(email, password);
      } else {
        result = await window.api.signUp(email, password);
      }

      if (result.ok) {
        this.state.setUser(result.user);
        this.hide();
        
        if (this.authMode === 'login') {
          window.dispatchEvent(new CustomEvent('auth-success', { 
            detail: { email: result.user.email } 
          }));
        } else if (result.needsConfirmation) {
          this.showInfo('Аккаунт создан! Проверьте почту и перейдите по ссылке для подтверждения, затем войдите.');
        } else {
          window.dispatchEvent(new CustomEvent('auth-success', { 
            detail: { email: result.user.email } 
          }));
        }
      } else {
        const msg = result.error || '';
        if (msg.includes('Invalid login credentials')) {
          this.showError('Неверный email или пароль');
        } else if (msg.includes('Email not confirmed')) {
          this.showError('Email не подтверждён — проверьте почту и перейдите по ссылке в письме');
        } else if (msg.includes('rate limit')) {
          this.showError('Слишком много попыток — подождите несколько минут и попробуйте снова');
        } else if (msg.includes('already registered') || msg.includes('User already registered')) {
          this.showError('Этот email уже зарегистрирован — войдите или восстановите пароль');
        } else if (msg.includes('invalid email')) {
          this.showError('Некорректный email');
        } else {
          this.showError(msg || 'Ошибка');
        }
      }
    } catch (err) {
      this.showError('Неожиданная ошибка: ' + err.message);
    }

    this.elBtnSubmit.disabled = false;
    this.setMode(this.authMode);
  }
}
