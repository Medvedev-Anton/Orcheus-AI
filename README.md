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
- **Настройки через GUI** — URL, Flow ID, токен, папка проекта (без ввода в терминал)
- **Новый чат** — сброс контекста диалога
- **Открыть в проводнике** — быстрый доступ к папке проекта

---

## Требования

- [Node.js](https://nodejs.org) 18 или новее

---

## Установка и запуск

```powershell
# Установить зависимости
npm install

# Запустить приложение
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
├── main.js                    # Точка входа главного процесса
├── preload.js                 # contextBridge — безопасный мост main ↔ renderer
├── flowise-save.mjs           # CLI-скрипт (работает независимо)
├── .env                       # Секреты (не пушить в git!)
├── .env.example               # Шаблон переменных окружения
├── package.json
└── src/
    ├── index.html             # Разметка интерфейса
    ├── styles.css             # Тёмная тема
    ├── renderer.js            # Точка входа UI
    ├── main/                  # Модули главного процесса
    │   ├── config/            # Константы и настройки
    │   │   ├── constants.js   # Константы приложения
    │   │   └── settings.js    # Управление настройками
    │   ├── services/          # Бизнес-логика
    │   │   ├── auth.js        # Авторизация Supabase
    │   │   ├── flowise.js     # Flowise API клиент
    │   │   ├── files.js       # Работа с файлами
    │   │   ├── chat.js        # Управление чатами
    │   │   └── formatter.js   # Форматирование кода
    │   ├── ipc/               # IPC обработчики
    │   │   ├── auth-handlers.js
    │   │   ├── flowise-handlers.js
    │   │   ├── file-handlers.js
    │   │   ├── chat-handlers.js
    │   │   └── settings-handlers.js
    │   └── window.js          # Создание окна
    ├── renderer/              # Модули UI
    │   ├── components/        # UI компоненты
    │   │   ├── auth-modal.js
    │   │   ├── chat-panel.js
    │   │   ├── chat-list.js
    │   │   ├── file-tree.js
    │   │   ├── code-viewer.js
    │   │   ├── settings-modal.js
    │   │   └── resizable-panels.js
    │   ├── utils/             # Утилиты
    │   │   ├── dom.js
    │   │   └── format.js
    │   └── state/             # Состояние
    │       └── app-state.js
    └── shared/                # Общие утилиты
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

## Сборка .exe

```powershell
npm run build
```

Результат — установщик NSIS в папке `dist/`.

---

## Безопасность

- Авторизация через Supabase — пароли не хранятся локально
- Сессия сохраняется в `%APPDATA%\orcheus-ai\orcheus-ai-session.json`
- Supabase anon key зашит в приложение (это публичный ключ, безопасен для клиента)
- Токен Flowise хранится локально в `%APPDATA%\orcheus-ai` — не передаётся никуда кроме вашего Flowise
- Записываемые файлы проверяются на path traversal (`../` атаки)
- Renderer-процесс не имеет прямого доступа к Node.js (contextBridge)
