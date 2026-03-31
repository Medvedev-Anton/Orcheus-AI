#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const mode = process.argv[2];

function fail(message) {
  console.error(`Ошибка: ${message}`);
  process.exit(1);
}

function assertString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Поле "${fieldName}" должно быть непустой строкой`);
  }
}

function safeResolve(projectRoot, relativeFilePath) {
  assertString(relativeFilePath, 'name');

  if (relativeFilePath.includes('\0')) {
    throw new Error(`Недопустимый путь (NUL byte): ${relativeFilePath}`);
  }

  if (path.isAbsolute(relativeFilePath)) {
    throw new Error(`Абсолютные пути запрещены: ${relativeFilePath}`);
  }

  const normalized = path.normalize(relativeFilePath);

  if (
    normalized.startsWith('..') ||
    normalized.includes(`..${path.sep}`) ||
    normalized === '..'
  ) {
    throw new Error(`Выход за пределы PROJECT_ROOT запрещён: ${relativeFilePath}`);
  }

  const fullPath = path.resolve(projectRoot, normalized);
  const relative = path.relative(projectRoot, fullPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Небезопасный путь: ${relativeFilePath}`);
  }

  return fullPath;
}

function tryParseJsonString(value) {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractFiles(payload) {
  console.log("=== RAW PAYLOAD ===");
  console.dir(payload, { depth: null });

  // 1. Если сразу массив
  if (Array.isArray(payload)) return payload;

  // 2. Если payload.files
  if (payload && payload.files) {
    if (Array.isArray(payload.files)) return payload.files;

    if (typeof payload.files === 'string') {
      const parsed = tryParseJsonString(payload.files);
      if (parsed && Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.files)) return parsed.files;
    }
  }

  // 3. payload.json
  if (payload && payload.json) {
    if (Array.isArray(payload.json)) return payload.json;

    if (Array.isArray(payload.json.files)) return payload.json.files;

    if (typeof payload.json === 'string') {
      const parsed = tryParseJsonString(payload.json);
      if (parsed && Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.files)) return parsed.files;
    }
  }

  // 4. payload.text
  if (payload && typeof payload.text === 'string') {
    const parsed = tryParseJsonString(payload.text);
    if (parsed && Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.files)) return parsed.files;
  }

  // 5. OpenRouter / LLM формат
  if (payload?.choices?.[0]?.message?.content) {
    const content = payload.choices[0].message.content;

    // попытка извлечь JSON
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = tryParseJsonString(match[0]);
      if (parsed?.files && Array.isArray(parsed.files)) {
        return parsed.files;
      }
    }

    // fallback: считаем это html
    console.log("⚠️ fallback: создаём index.html из текста");

    return [
      {
        name: "index.html",
        content
      }
    ];
  }

  // 6. ГЛАВНЫЙ fallback
  console.log("⚠️ fallback: ничего не нашли, создаём дефолтный файл");

  return [
    {
      name: "index.html",
      content: "<!-- fallback file -->"
    }
  ];
}

async function writeFiles(projectRoot, files, overwrite = true) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Массив files пустой или отсутствует');
  }

  await fs.mkdir(projectRoot, { recursive: true });

  const written = [];

  for (const file of files) {
    if (!file || typeof file !== 'object') {
      throw new Error('Каждый элемент files должен быть объектом');
    }

    assertString(file.name, 'name');
    assertString(file.content, 'content');

    const fullPath = safeResolve(projectRoot, file.name);
    const dir = path.dirname(fullPath);

    await fs.mkdir(dir, { recursive: true });

    if (!overwrite) {
      try {
        await fs.access(fullPath);
        throw new Error(`Файл уже существует: ${file.name}`);
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    await fs.writeFile(fullPath, file.content, 'utf8');

    written.push({
      name: file.name,
      fullPath,
      purpose: typeof file.purpose === 'string' ? file.purpose : ''
    });
  }

  const manifestPath = path.join(projectRoot, '.flowise-write-manifest.json');
  await fs.writeFile(
    manifestPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        writtenCount: written.length,
        files: written
      },
      null,
      2
    ),
    'utf8'
  );

  return { written, manifestPath };
}

async function loadFromJsonFile(jsonPath) {
  const raw = await fs.readFile(jsonPath, 'utf8');
  return JSON.parse(raw);
}

async function loadFromFlowise(question) {
  const FLOWISE_URL = (process.env.FLOWISE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const FLOW_ID = process.env.FLOW_ID;
  const FLOWISE_TOKEN = process.env.FLOWISE_TOKEN || '';

  if (!FLOW_ID) throw new Error('Не задан FLOW_ID');
  if (!question || !question.trim()) throw new Error('Не задан вопрос');

  const headers = {
    'Content-Type': 'application/json'
  };

  if (FLOWISE_TOKEN) {
    headers.Authorization = `Bearer ${FLOWISE_TOKEN}`;
  }

  console.log("🚀 Отправляем запрос в Flowise...");
  console.log("🧠 Вопрос:", question);

  const controller = new AbortController();

  // ⏱️ 5 минут (реально нужно для multi-agent)
  const timeout = setTimeout(() => {
    console.log("⏰ Таймаут (15 минут)");
    controller.abort();
  }, 900000);

  try {
    const start = Date.now();

    const response = await fetch(`${FLOWISE_URL}/api/v1/prediction/${FLOW_ID}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        question,
        streaming: false
      }),
      signal: controller.signal
    });

    const duration = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`✅ Ответ получен за ${duration} сек`);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Flowise вернул ${response.status}: ${body}`);
    }

    const text = await response.text()

    let payload
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { raw: text }
    }

  } catch (err) {
    console.error("❌ Ошибка:", err.message);

    if (err.name === 'AbortError') {
      console.error("💡 Flowise не успел за 5 минут (слишком сложная задача)");
    }

    throw err;

  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const PROJECT_ROOT = path.resolve(process.env.PROJECT_ROOT || './generated-project');
  const overwrite = process.env.OVERWRITE !== 'false';

  let payload;

  if (mode === 'from-json') {
    const jsonPath = process.argv[3];
    if (!jsonPath) fail('Использование: node flowise-save.mjs from-json ./result.json');
    payload = await loadFromJsonFile(jsonPath);
  } else if (mode === 'from-flowise') {
    const question = process.argv.slice(3).join(' ').trim();
    if (!question) {
      fail('Использование: node flowise-save.mjs from-flowise "Создай простой index.html"');
    }
    payload = await loadFromFlowise(question);
  } else {
    fail(
      'Использование:\n' +
      '  node flowise-save.mjs from-json ./result.json\n' +
      '  node flowise-save.mjs from-flowise "Ваш запрос"'
    );
  }

  console.dir(payload, { depth: null });
  const files = extractFiles(payload);
  const result = await writeFiles(PROJECT_ROOT, files, overwrite);

  console.log(
    JSON.stringify(
      {
        ok: true,
        projectRoot: PROJECT_ROOT,
        writtenCount: result.written.length,
        manifestPath: result.manifestPath,
        files: result.written
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exit(1);
});