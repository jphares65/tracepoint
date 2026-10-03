-- Fleet documents are private attachments. Keep their operational metadata with
-- the attachment record so it remains tenant-scoped, auditable, and retrievable
-- through the existing authenticated object-storage path.
alter table public.attachments
  add column if not exists expiration_date date;

create index if not exists attachments_fleet_vehicle_document_active_idx
  on public.attachments (department_id, entity_id, expiration_date)
  where entity_type = 'fleet_vehicle_document' and archived_at is null;

notify pgrst, 'reload schema';
