/**
 * Глобальное состояние приложения
 */

export class AppState {
  constructor() {
    this._settings = {};
    this._user = null;
    this._currentChatDbId = null;
    this._chatId = this._genId();
    this._generating = false;
    this._editMode = false;
    this._currentFilePath = null;
    this._subscribers = [];
  }

  _genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  // Getters
  getSettings() { return this._settings; }
  getUser() { return this._user; }
  getCurrentChatId() { return this._currentChatDbId; }
  getChatId() { return this._chatId; }
  isGenerating() { return this._generating; }
  isEditMode() { return this._editMode; }
  getCurrentFilePath() { return this._currentFilePath; }

  // Setters
  setSettings(settings) {
    this._settings = settings;
    this._notify();
  }

  setUser(user) {
    this._user = user;
    this._notify();
  }

  setCurrentChatId(chatId) {
    this._currentChatDbId = chatId;
    this._chatId = chatId || this._genId();
    this._notify();
  }

  setGenerating(generating) {
    this._generating = generating;
    this._notify();
  }

  setEditMode(editMode) {
    this._editMode = editMode;
    this._notify();
  }

  setCurrentFilePath(path) {
    this._currentFilePath = path;
    this._notify();
  }

  // Observer pattern
  subscribe(callback) {
    this._subscribers.push(callback);
  }

  unsubscribe(callback) {
    this._subscribers = this._subscribers.filter(cb => cb !== callback);
  }

  _notify() {
    this._subscribers.forEach(cb => cb(this));
  }
}
