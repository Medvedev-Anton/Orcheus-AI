import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ─── Secrets (set via: supabase secrets set KEY=value) ────────────────────────
const FLOWISE_URL   = Deno.env.get('FLOWISE_URL')   ?? '';
const FLOW_ID       = Deno.env.get('FLOW_ID')        ?? '';
const FLOWISE_TOKEN = Deno.env.get('FLOWISE_TOKEN')  ?? '';

// ─── CORS ─────────────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

// ─── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // ── Auth: verify user JWT ────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Необходима авторизация' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return json({ error: 'Не авторизован' }, 401);
  }

  // ── Server config check ───────────────────────────────────────────────────────
  if (!FLOWISE_URL || !FLOW_ID) {
    return json(
      { error: 'Сервер не настроен: отсутствуют FLOWISE_URL или FLOW_ID. Обратитесь к администратору.' },
      503,
    );
  }

  // ── Parse request body ────────────────────────────────────────────────────────
  let question: string;
  let chatId: string | undefined;
  let overrideConfig: Record<string, unknown> | undefined;
  try {
    const body = await req.json() as Record<string, unknown>;
    question = String(body.question ?? '').trim();
    chatId   = typeof body.chatId === 'string' && body.chatId ? body.chatId : undefined;
    overrideConfig = body.overrideConfig != null && typeof body.overrideConfig === 'object'
      ? body.overrideConfig as Record<string, unknown>
      : undefined;
  } catch {
    return json({ error: 'Неверный формат тела запроса' }, 400);
  }

  if (!question) {
    return json({ error: 'Пустой вопрос' }, 400);
  }

  // ── Proxy to Flowise ──────────────────────────────────────────────────────────
  const flowisePayload: Record<string, unknown> = { question, streaming: false };
  if (chatId) flowisePayload.chatId = chatId;
  if (overrideConfig) flowisePayload.overrideConfig = overrideConfig;

  const flowiseHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (FLOWISE_TOKEN) flowiseHeaders['Authorization'] = `Bearer ${FLOWISE_TOKEN}`;

  const endpoint = `${FLOWISE_URL.replace(/\/+$/, '')}/api/v1/prediction/${FLOW_ID}`;
  console.log(`[predict] user=${user.id} → POST ${endpoint}`);

  let flowiseRes: Response;
  try {
    flowiseRes = await fetch(endpoint, {
      method:  'POST',
      headers: flowiseHeaders,
      body:    JSON.stringify(flowisePayload),
      // 280s — safely within Supabase's 400s wall-clock hard limit
      signal:  AbortSignal.timeout(280_000),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[predict] Flowise connection error:', msg);
    return json({ error: 'Ошибка соединения с Flowise: ' + msg }, 502);
  }

  const responseText = await flowiseRes.text();
  console.log(`[predict] Flowise HTTP ${flowiseRes.status}, ${responseText.length} bytes`);

  if (!flowiseRes.ok) {
    let errMsg = responseText.slice(0, 500);
    try {
      const j = JSON.parse(responseText) as Record<string, unknown>;
      if (typeof j.message === 'string') errMsg = j.message;
    } catch { /* use raw text */ }
    return json({ error: errMsg }, flowiseRes.status);
  }

  return new Response(responseText, {
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
});
