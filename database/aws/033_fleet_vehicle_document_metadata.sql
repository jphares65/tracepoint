begin;

-- Fleet documents use the existing private, tenant-scoped attachments record.
-- The nullable date preserves non-expiring document types while allowing the
-- application to distinguish current, upcoming, and expired documents.
alter table public.attachments
  add column if not exists expiration_date date;

create index if not exists attachments_fleet_vehicle_document_active_idx
  on public.attachments (department_id, entity_id, expiration_date)
  where entity_type = 'fleet_vehicle_document' and archived_at is null;

commit;
