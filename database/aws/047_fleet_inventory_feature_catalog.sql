begin;

-- Fleet and Inventory catalog rows for databases that never ran 042 (production).
-- Enables nothing: entitlement rows are written only by set_platform_entitlement.
-- On databases that ran 042 the rows already exist and nothing changes; ON
-- CONFLICT DO NOTHING does not fire 042's catalog trigger. Keep the text in
-- sync with src/lib/tracepoint/module-catalog.ts.
insert into public.feature_catalog(code, display_name, description, sort_order, is_active)
values
  ('fleet', 'Fleet', 'Agency vehicle inspections, maintenance, and fleet records.', 55, true),
  ('inventory', 'Inventory', 'Agency supply inventory, locations, and checkouts.', 65, true)
on conflict (code) do nothing;

commit;
