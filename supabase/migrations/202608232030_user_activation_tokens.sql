create table if not exists public.user_activation_tokens (
  id uuid primary key,
  department_id uuid not null
    references public.departments(id) on delete cascade,
  user_id uuid not null
    references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_by_user_id uuid
    references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  revoked_at timestamptz,
  constraint user_activation_tokens_hash_length
    check (char_length(token_hash) = 64),
  constraint user_activation_tokens_expiration
    check (expires_at > created_at),
  constraint user_activation_tokens_single_terminal_state
    check (not (used_at is not null and revoked_at is not null))
);

create index if not exists user_activation_tokens_lookup_idx
  on public.user_activation_tokens (user_id, department_id);

create index if not exists user_activation_tokens_expiration_idx
  on public.user_activation_tokens (expires_at);

alter table public.user_activation_tokens
  enable row level security;

revoke all on table public.user_activation_tokens
  from anon, authenticated;

grant all on table public.user_activation_tokens
  to service_role;

comment on table public.user_activation_tokens is
  'Server-managed, hashed, single-use TracePoint account activation tokens.';
