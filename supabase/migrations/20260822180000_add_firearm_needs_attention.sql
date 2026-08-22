alter table public.firearms
  add column if not exists needs_attention boolean not null default false,
  add column if not exists attention_reasons text[] not null default '{}';

create index if not exists firearms_needs_attention_idx
  on public.firearms (department_id, needs_attention)
  where needs_attention = true;
