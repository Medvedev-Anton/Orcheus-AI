# Orcheus AI

Десктопный AI-ассистент для генерации проектов через [Flowise](https://flowiseai.com).  
Вводите запрос в чат — приложение обращается к вашему Flowise-flow, получает файлы и записывает их на диск.

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron) ![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs) ![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows) ![Supabase](https://img.shields.io/badge/Supabase-Auth-3ECF8E?logo=supabase)

> Ранее: Flowise IDE

---

## Возможности

- **Авторизация / регистрация** — вход через Supabase, без аккаунта отправка запросов недоступна
- **Чат с AI** — диалог с Flowise-агентом, анимация ожидания, прогресс-сообщения в реальном времени
- **Генерация файлов** — ответ AI автоматически разбирается на файлы и записывается в папку проекта
- **Дерево файлов** — левая панель с иерархией, сворачиваемыми папками, иконками по типу файла
- **Просмотр кода** — правая панель с нумерацией строк и кнопкой «Копировать»
- **Настройки через GUI** — папка проекта, тема оформления
- **Новый чат** — сброс контекста диалога
- **Открыть в проводнике** — быстрый доступ к папке проекта
- **Безопасность** — токен Flowise скрыт на сервере, недоступен клиенту

---

## Требования

- [Node.js](https://nodejs.org) 18 или новее

---

## Установка и запуск

### 1. Установка зависимостей

```powershell
npm install
```

### 2. Настройка backend сервера

Создайте файл `backend/.env`:

```bash
# Flowise
FLOWISE_URL=https://your-flowise-server.com
FLOWISE_TOKEN=your-secret-token
FLOW_ID=your-flow-id

# Supabase (для проверки JWT)
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...

# Server
PORT=3001
```

### 3. Запуск

**Терминал 1 — Backend сервер:**
```powershell
cd backend
node index.js
```

**Терминал 2 — Electron приложение:**
```powershell
npm start
```

---

## Первый запуск

### 1. Авторизация

При запуске появится окно входа/регистрации.

| Действие | Описание |
|---|---|
| **Войти** | введите email и пароль существующего аккаунта |
| **Регистрация** | перейдите на вкладку «Регистрация», укажите email и пароль (мин. 6 символов) |

Сессия сохраняется между запусками — входить каждый раз не нужно.

### 2. Начало работы

1. Введите запрос в чат и нажмите **Отправить** или `Ctrl+Enter`
2. AI сгенерирует файлы и сохранит их в папку проекта
3. Используйте **⚙️** для изменения папки проекта

Настройки сохраняются в `%APPDATA%\orcheus-ai\orcheus-ai-settings.json`.

---

## Горячие клавиши

| Действие | Клавиши |
|---|---|
| Отправить сообщение | `Ctrl + Enter` |
| Закрыть настройки | `Escape` |

---

## Структура проекта

```
orcheus-ai/
├── backend/                  # 🆕 Прокси-сервер (скрывает токен Flowise)
│   ├── index.js              # Express сервер на порту 3001
│   ├── config.js             # Загрузка переменных окружения
│   ├── .env                  # Секреты: FLOWISE_TOKEN, FLOW_ID
│   ├── routes/
│   │   └── predict.js        # POST /api/predict — прокси к Flowise
│   └── middleware/
│       ├── auth.js           # Проверка Supabase JWT
│       ├── rateLimit.js      # Ограничение 60 req/min
│       └── errorHandler.js   # Обработка ошибок
│
├── main.js                   # Точка входа главного процесса
├── preload.js                # contextBridge — безопасный мост main ↔ renderer
├── flowise-save.mjs          # CLI-скрипт (работает независимо)
├── .env                      # Supabase ключи (публичные)
├── .env.example              # Шаблон переменных окружения
├── package.json
│
└── src/
    ├── index.html            # Разметка интерфейса
    ├── styles.css            # Тёмная тема
    ├── renderer.js           # Точка входа UI
    │
    ├── main/                 # Модули главного процесса (Node.js)
    │   ├── config/
    │   │   ├── constants.js  # Константы: SUPABASE_URL, BACKEND_URL
    │   │   └── settings.js   # Управление настройками
    │   ├── services/
    │   │   ├── auth.js       # Авторизация Supabase
    │   │   ├── flowise.js    # Запросы к backend (прокси)
    │   │   ├── files.js      # Работа с файлами
    │   │   ├── chat.js       # Управление чатами
    │   │   └── formatter.js  # Форматирование кода
    │   ├── ipc/
    │   │   ├── auth-handlers.js
    │   │   ├── flowise-handlers.js
    │   │   ├── file-handlers.js
    │   │   ├── chat-handlers.js
    │   │   └── settings-handlers.js
    │   └── window.js         # Создание окна
    │
    ├── renderer/             # Модули UI (браузер)
    │   ├── components/
    │   │   ├── auth-modal.js
    │   │   ├── chat-panel.js
    │   │   ├── chat-list.js
    │   │   ├── file-tree.js
    │   │   ├── code-viewer.js
    │   │   ├── settings-modal.js
    │   │   └── resizable-panels.js
    │   ├── utils/
    │   │   ├── dom.js
    │   │   └── format.js
    │   └── state/
    │       └── app-state.js
    │
    └── shared/
        └── utils.js
```

---

---

## CLI-режим (без GUI)

Оригинальный скрипт `flowise-save.mjs` работает независимо:

```powershell
$env:FLOWISE_TOKEN="ваш_токен"
$env:FLOWISE_URL="http://localhost:3000"
$env:FLOW_ID="ваш_flow_id"
$env:PROJECT_ROOT="./project"

node flowise-save.mjs from-flowise "создай на React лендинг страницу автосалона"
node flowise-save.mjs from-json ./result.json
```

---

## API Endpoints (Backend)

| Endpoint | Method | Описание |
|----------|--------|----------|
| `/health` | GET | Проверка состояния сервера |
| `/api/predict` | POST | Проксирование запроса к Flowise |

**POST /api/predict:**
```json
{
  "question": "создай React приложение",
  "chatId": "optional-chat-id"
}
```

Headers:
- `Authorization: Bearer <Supabase_JWT>`

---

## Сборка .exe

```powershell
npm run build
```

Результат — установщик NSIS в папке `dist/`.

---

## Безопасность

### Архитектура

```
Electron Client → Backend Proxy → Flowise API
                      │
                      └── Токен Flowise хранится здесь (секрет!)
```

### Защита

- **Токен Flowise скрыт** — хранится только на сервере в `backend/.env`, никогда не попадает к клиенту
- **Авторизация через Supabase** — пароли не хранятся локально
- **JWT verification** — сервер проверяет токен пользователя перед проксированием запроса
- **Rate limiting** — 60 запросов в минуту на пользователя
- **Supabase anon key** — публичный ключ, безопасен для клиента
- **Path traversal защита** — записываемые файлы проверяются на `../` атаки
- **contextBridge** — renderer-процесс не имеет прямого доступа к Node.js
