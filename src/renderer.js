'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let settings        = {};
let chatId          = genId();
let generating      = false;
let unsubProgress   = null;
let currentFilePath = null;
let editMode        = false;

// ─── DOM ──────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const elMessages  = $('messages');
const elInput     = $('chat-input');
const elBtnSend   = $('btn-send');
const elBtnNew    = $('btn-new-chat');
const elBtnSett   = $('btn-settings');
const elBtnFolder = $('btn-open-folder');
const elBtnRef    = $('btn-refresh');
const elFileTree  = $('file-tree');
const elCodeFname = $('code-fname');
const elLineNums  = $('line-nums');
const elCodePre   = $('code-pre');
const elBtnCopy     = $('btn-copy');
const elBtnEdit     = $('btn-edit');
const elBtnSaveFile = $('btn-save-file');
const elBtnDiscard  = $('btn-discard');
const elCodeEditor  = $('code-editor');

const elStText    = $('st-text');
const elStRoot    = $('st-root');
const elStCount   = $('st-count');
const elPathLabel = $('project-path-label');

const elModal     = $('modal-settings');
const elModalBg   = $('modal-bg');
const elSUrl      = $('s-url');
const elSFlowId   = $('s-flow-id');
const elSToken    = $('s-token');
const elSRoot     = $('s-root');

// ─── Utils ────────────────────────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    js: '📜', mjs: '📜', cjs: '📜',
    ts: '🔷', tsx: '🔷',
    jsx: '⚛',
    html: '🌐', htm: '🌐',
    css: '🎨', scss: '🎨', sass: '🎨', less: '🎨',
    json: '📋',
    md: '📝',
    svg: '🖼', png: '🖼', jpg: '🖼', gif: '🖼', ico: '🖼',
    py:  '🐍',
    sh:  '⚡', bat: '⚡', ps1: '⚡',
    env: '🔧', yaml: '🔧', yml: '🔧', toml: '🔧',
  };
  return map[ext] || '📄';
}

function setStatus(text) {
  elStText.textContent = text;
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  settings = await window.api.loadSettings();
  applySettingsToUi();

  // Subscribe to progress from main process
  unsubProgress = window.api.onProgress((msg) => addMsg('sys', msg));

  addMsg('sys', `⚡ Orcheus AI запущен. Flow ID: ${settings.flowId || '(не настроен)'}`);
  addMsg('sys',  'Введите запрос и нажмите «Отправить» или Ctrl+Enter.');

  await refreshTree();
}

// ─── Messages ─────────────────────────────────────────────────────────────────
function addMsg(role, content, files = []) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${role}`;

  if (role !== 'sys') {
    const roleLine = document.createElement('div');
    roleLine.className = 'msg-role';
    roleLine.textContent =
      role === 'user' ? 'Вы' :
      role === 'ai'   ? 'Flowise AI' :
      role === 'err'  ? '⚠ Ошибка' : '';
    wrap.appendChild(roleLine);
  }

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = content; // textContent — XSS safe
  wrap.appendChild(bubble);

  if (files.length > 0) {
    const chips = document.createElement('div');
    chips.className = 'chips';
    files.forEach((f) => {
      const btn = document.createElement('button');
      btn.className = 'chip';
      btn.textContent = `${fileIcon(f.name)} ${f.name}`;
      btn.title = f.fullPath;
      btn.addEventListener('click', () => openFile(f.fullPath, f.name));
      chips.appendChild(btn);
    });
    wrap.appendChild(chips);
  }

  elMessages.appendChild(wrap);
  elMessages.scrollTop = elMessages.scrollHeight;
  return wrap;
}

/** Animated "thinking" placeholder — returns element for later removal */
function addThinking() {
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
  elMessages.appendChild(wrap);
  elMessages.scrollTop = elMessages.scrollHeight;
  return wrap;
}

function removeThinking() {
  const el = document.getElementById('thinking');
  if (el) el.remove();
}

// ─── Send ──────────────────────────────────────────────────────────────────────
async function send() {
  const question = elInput.value.trim();
  if (!question || generating) return;

  generating = true;
  elBtnSend.disabled = true;
  elBtnSend.textContent = '...';
  elInput.value = '';

  addMsg('user', question);
  const thinking = addThinking();
  setStatus('Генерируем...');

  const result = await window.api.predict(question, chatId);

  removeThinking();
  generating = false;
  elBtnSend.disabled = false;
  elBtnSend.textContent = 'Отправить ▶';

  if (result.ok) {
    const n = result.files.length;
    addMsg('ai', `✅ Готово! Записано файлов: ${n}`, result.files);
    setStatus(`Готово — ${n} файл(ов) сгенерировано`);
    await refreshTree();
    if (result.files.length > 0) {
      const first = result.files[0];
      await openFile(first.fullPath, first.name);
    }
  } else {
    addMsg('err', result.error || 'Неизвестная ошибка');
    setStatus('Ошибка');
  }
}

// ─── File tree ────────────────────────────────────────────────────────────────
async function refreshTree() {
  const result = await window.api.listFiles();

  elFileTree.innerHTML = '';
  elStRoot.textContent   = '';
  elStCount.textContent  = '';
  elPathLabel.textContent = result.root || '';

  if (!result.ok || !result.tree || result.tree.length === 0) {
    elFileTree.innerHTML = '<p class="hint-text">Файлы появятся здесь после первой генерации</p>';
    return;
  }

  let fileCount = 0;

  function renderNodes(nodes, container, depth) {
    for (const node of nodes) {
      const item = document.createElement('div');
      item.className = `t-node ${node.type === 'dir' ? 't-dir' : 't-file'}`;
      item.style.paddingLeft = `${depth * 14 + 8}px`;
      item.tabIndex = 0;

      const icon = document.createElement('span');
      icon.className = 't-icon';

      const label = document.createElement('span');
      label.className = 't-label';
      label.textContent = node.name;

      item.appendChild(icon);
      item.appendChild(label);

      if (node.type === 'dir') {
        icon.textContent = '📂';
        container.appendChild(item);

        const childWrap = document.createElement('div');
        container.appendChild(childWrap);

        let open = true;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          open = !open;
          icon.textContent = open ? '📂' : '📁';
          childWrap.style.display = open ? '' : 'none';
        });

        if (node.children && node.children.length > 0) {
          renderNodes(node.children, childWrap, depth + 1);
        }
      } else {
        fileCount++;
        icon.textContent = fileIcon(node.name);
        item.title = node.fullPath;

        item.addEventListener('click', async () => {
          document.querySelectorAll('.t-node.active')
            .forEach((e) => e.classList.remove('active'));
          item.classList.add('active');
          await openFile(node.fullPath, node.name);
        });

        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') item.click();
        });

        container.appendChild(item);
      }
    }
  }

  renderNodes(result.tree, elFileTree, 0);

  elStRoot.textContent  = shortenPath(result.root, 40);
  elStCount.textContent = `${fileCount} файл(ов)`;
}

function shortenPath(p, maxLen) {
  if (!p) return '';
  if (p.length <= maxLen) return p;
  const parts = p.replace(/\\/g, '/').split('/');
  if (parts.length > 3) return `…/${parts.slice(-2).join('/')}`;
  return p;
}

// ─── Code view/edit ──────────────────────────────────────────────────────────
function setEditMode(on) {
  editMode = on;
  elCodePre.classList.toggle('hidden', on);
  elCodeEditor.classList.toggle('hidden', !on);
  elBtnEdit.classList.toggle('hidden', on);
  elBtnSaveFile.classList.toggle('hidden', !on);
  elBtnDiscard.classList.toggle('hidden', !on);
  if (on) {
    elCodeEditor.focus();
    elCodeEditor.addEventListener('input', syncEditorLineNums);
  } else {
    elCodeEditor.removeEventListener('input', syncEditorLineNums);
  }
}

function syncEditorLineNums() {
  const lines = elCodeEditor.value.split('\n');
  const pad = String(lines.length).length;
  elLineNums.textContent = lines.map((_, i) => String(i + 1).padStart(pad, ' ')).join('\n');
  // sync scroll
  elLineNums.scrollTop = elCodeEditor.scrollTop;
}

async function openFile(fullPath, name) {
  // exit edit mode when opening new file
  if (editMode) setEditMode(false);
  currentFilePath = fullPath;

  elCodeFname.textContent = name || fullPath;
  elLineNums.textContent  = '';
  elCodePre.textContent   = 'Загружаем…';
  elCodeEditor.value      = '';

  const result = await window.api.readFile(fullPath);

  if (!result.ok) {
    elCodePre.textContent = `Ошибка чтения файла:\n${result.error}`;
    return;
  }

  const lines = result.content.split('\n');
  const pad   = String(lines.length).length;
  elLineNums.textContent = lines.map((_, i) => String(i + 1).padStart(pad, ' ')).join('\n');
  elCodePre.textContent  = result.content;
  elCodeEditor.value     = result.content;
}

async function saveCurrentFile() {
  if (!currentFilePath) return;
  const content = elCodeEditor.value;
  const result  = await window.api.writeFile(currentFilePath, content);
  if (result.ok) {
    elCodePre.textContent = content;
    setEditMode(false);
    syncEditorLineNums();
    const lines = content.split('\n');
    const pad   = String(lines.length).length;
    elLineNums.textContent = lines.map((_, i) => String(i + 1).padStart(pad, ' ')).join('\n');
    setStatus('Файл сохранён');
  } else {
    setStatus('Ошибка сохранения: ' + result.error);
  }
}

// ─── Settings modal ───────────────────────────────────────────────────────────
function openModal() {
  elSUrl.value    = settings.flowiseUrl || '';
  elSFlowId.value = settings.flowId     || '';
  elSToken.value  = settings.token      || '';
  elSRoot.value   = settings.projectRoot || '';
  elModal.classList.remove('hidden');
  elSUrl.focus();
}

function closeModal() {
  elModal.classList.add('hidden');
}

async function saveSettings() {
  const updated = {
    flowiseUrl:  elSUrl.value.trim()    || 'http://localhost:3000',
    flowId:      elSFlowId.value.trim() || '',
    token:       elSToken.value.trim()  || '',
    projectRoot: elSRoot.value.trim()   || settings.projectRoot,
  };
  await window.api.saveSettings(updated);
  settings = updated;
  applySettingsToUi();
  closeModal();
  addMsg('sys', '✅ Настройки сохранены.');
  await refreshTree();
}

function applySettingsToUi() {
  elPathLabel.textContent = settings.projectRoot
    ? shortenPath(settings.projectRoot, 50)
    : '';
}

// ─── Event listeners ──────────────────────────────────────────────────────────
elBtnSend.addEventListener('click', send);

elInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    send();
  }
});

elBtnNew.addEventListener('click', () => {
  chatId = genId();
  elMessages.innerHTML = '';
  addMsg('sys', '🆕 Новый чат начат. Контекст предыдущего диалога сброшен.');
});

elBtnSett.addEventListener('click', openModal);

elBtnFolder.addEventListener('click', () => window.api.openFolder());

elBtnRef.addEventListener('click', refreshTree);

elBtnCopy.addEventListener('click', async () => {
  const code = editMode ? elCodeEditor.value : elCodePre.textContent;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    const orig = elBtnCopy.textContent;
    elBtnCopy.textContent = '✓ Скопировано';
    setTimeout(() => { elBtnCopy.textContent = orig; }, 1800);
  } catch (_) { /* clipboard */ }
});

elBtnEdit.addEventListener('click', () => {
  if (!currentFilePath) return;
  setEditMode(true);
});

elBtnSaveFile.addEventListener('click', saveCurrentFile);

elBtnDiscard.addEventListener('click', () => {
  if (!editMode) return;
  elCodeEditor.value = elCodePre.textContent; // restore original
  setEditMode(false);
});

// Ctrl+S inside editor
elCodeEditor.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    saveCurrentFile();
  }
  if (e.key === 'Escape') {
    elCodeEditor.value = elCodePre.textContent;
    setEditMode(false);
  }
});

// Sync line numbers scroll with editor
elCodeEditor.addEventListener('scroll', () => {
  elLineNums.scrollTop = elCodeEditor.scrollTop;
});

// Settings modal controls
$('btn-modal-close') .addEventListener('click', closeModal);
$('btn-cancel')      .addEventListener('click', closeModal);
$('btn-save')        .addEventListener('click', saveSettings);
elModalBg            .addEventListener('click', closeModal);

$('btn-pick').addEventListener('click', async () => {
  const result = await window.api.pickFolder();
  if (result.ok) elSRoot.value = result.path;
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !elModal.classList.contains('hidden')) closeModal();
});

// ─── Resizable panels ────────────────────────────────────────────────────────
function setupResizer(resizerId, onDelta) {
  const el = $(resizerId);
  if (!el) return;
  let startX = 0;
  el.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    el.classList.add('dragging');
    document.body.style.cursor        = 'col-resize';
    document.body.style.userSelect    = 'none';
    document.body.style.pointerEvents = 'none';
    el.style.pointerEvents            = 'auto';

    const onMove = (e) => { onDelta(e.clientX - startX); startX = e.clientX; };
    const onUp   = () => {
      el.classList.remove('dragging');
      document.body.style.cursor        = '';
      document.body.style.userSelect    = '';
      document.body.style.pointerEvents = '';
      el.style.pointerEvents            = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

setupResizer('resizer-left', (dx) => {
  const sidebar = $('sidebar');
  const newW = Math.max(140, Math.min(520, sidebar.offsetWidth + dx));
  sidebar.style.width = newW + 'px';
});

setupResizer('resizer-right', (dx) => {
  const cp = $('code-panel');
  const newW = Math.max(200, Math.min(900, cp.offsetWidth - dx));
  cp.style.width = newW + 'px';
});

// ─── Start ────────────────────────────────────────────────────────────────────
setEditMode(false); // init button visibility
init();
