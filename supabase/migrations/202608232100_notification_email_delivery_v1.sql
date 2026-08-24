begin;

alter table public.notification_preferences
  alter column email_enabled set default true;

alter table public.notification_preferences
  alter column digest_mode set default 'Daily';

alter table public.notification_email_queue
  enable row level security;

revoke all on table public.notification_email_queue
  from anon, authenticated;

grant all on table public.notification_email_queue
  to service_role;

create index if not exists
  notification_email_queue_dispatch_idx
on public.notification_email_queue (
  status,
  scheduled_for
);

comment on table public.notification_email_queue is
  'Server-managed TracePoint notification email delivery queue.';

comment on column public.notification_preferences.digest_mode is
  'Immediate, Daily, or Weekly notification email delivery schedule.';

commit;
