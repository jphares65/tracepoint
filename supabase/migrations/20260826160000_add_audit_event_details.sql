begin;

alter table public.audit_events
  add column if not exists details jsonb not null default '{}'::jsonb;

comment on column public.audit_events.details is
  'Structured audit context including reasons, workflow metadata, support-mode context, and source-specific details.';

commit;
