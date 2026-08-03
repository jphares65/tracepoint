alter table public.firearms
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by_user_id uuid references auth.users(id),
  add column if not exists archive_reason text;
