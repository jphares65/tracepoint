begin;

-- Production imported the Fleet and Inventory catalog rows inactive, and 047's
-- ON CONFLICT DO NOTHING keeps them that way, so set_platform_entitlement
-- refuses them ("feature unavailable"). Activates them; enables nothing:
-- entitlement rows are written only by set_platform_entitlement. On databases
-- where they are already active (staging) no row is updated, so 042's
-- row-level catalog trigger does not fire.
update public.feature_catalog
set is_active = true
where code in ('fleet', 'inventory')
  and not is_active;

commit;
