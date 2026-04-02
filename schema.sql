-- ─── Orcheus AI — Chat History Schema ────────────────────────────────────────
-- Run this script once in your Supabase SQL Editor.

-- ── chats ──────────────────────────────────────────────────────────────────────
create table if not exists public.chats (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  title      text        not null default 'Новый чат',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chats enable row level security;

-- Users can only see and modify their own chats
create policy "users_own_chats"
  on public.chats for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists chats_user_id_updated_idx
  on public.chats (user_id, updated_at desc);

-- ── messages ───────────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id         uuid        primary key default gen_random_uuid(),
  chat_id    uuid        not null references public.chats(id) on delete cascade,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  role       text        not null check (role in ('user', 'ai', 'err')),
  content    text        not null,
  files      jsonb       not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.messages enable row level security;

-- Users can only see and modify their own messages
create policy "users_own_messages"
  on public.messages for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists messages_chat_created_idx
  on public.messages (chat_id, created_at asc);
