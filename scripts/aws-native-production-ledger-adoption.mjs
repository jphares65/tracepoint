// Catalog contract for adopting the pre-ledger production history.  These
// checks deliberately describe effects, not source-code expectations: a
// production reconciliation must fail before writing a ledger row if any
// historical schema effect is missing.
export const productionLedgerAdoptionVersions = Object.freeze({ first: 30, last: 37 });

export const productionLedgerAdoptionPostconditions = Object.freeze([
  "restricted_use_functions",
  "restricted_use_execute_grants",
  "restricted_custody_shape",
  "restricted_custody_functions",
  "restricted_custody_execute_grants",
  "audit_log_read_boundary",
  "fleet_document_metadata",
  "storage_location_management",
  "inventory_phase_one_relations",
  "inventory_phase_one_runtime_boundary",
  "inventory_checkout_phase_two",
  "inventory_checkout_runtime_boundary",
  "inventory_runtime_dml_grants",
]);

export const productionLedgerAdoptionPostconditionsSql = `select
  to_regprocedure('public.set_firearm_restricted_use(uuid,text,boolean,boolean,boolean,boolean,text)') is not null
    and to_regprocedure('public.clear_firearm_possession_restriction(uuid,text)') is not null as restricted_use_functions,
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.set_firearm_restricted_use(uuid,text,boolean,boolean,boolean,boolean,text)'), 'execute'), false)
    and coalesce(has_function_privilege('authenticated', to_regprocedure('public.clear_firearm_possession_restriction(uuid,text)'), 'execute'), false) as restricted_use_execute_grants,
  exists (select 1 from pg_attribute where attrelid = to_regclass('public.firearm_possession_restrictions') and attname = 'restriction_type' and atttypid = 'text'::regtype and attnotnull and attnum > 0 and not attisdropped)
    and exists (select 1 from pg_constraint where conrelid = to_regclass('public.firearm_possession_restrictions') and conname = 'firearm_possession_restrictions_type_check')
    and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'firearm_possession_restrictions' and indexname = 'firearm_possession_restrictions_one_active') as restricted_custody_shape,
  to_regprocedure('public.set_firearm_restriction(uuid,text,date,text,text,date)') is not null
    and to_regprocedure('public.clear_firearm_restriction(uuid,text)') is not null
    and to_regprocedure('public.operate_restricted_firearm_custody(uuid,text,uuid,text,uuid)') is not null as restricted_custody_functions,
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.set_firearm_restriction(uuid,text,date,text,text,date)'), 'execute'), false)
    and coalesce(has_function_privilege('authenticated', to_regprocedure('public.clear_firearm_restriction(uuid,text)'), 'execute'), false)
    and coalesce(has_function_privilege('authenticated', to_regprocedure('public.operate_restricted_firearm_custody(uuid,text,uuid,text,uuid)'), 'execute'), false) as restricted_custody_execute_grants,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.audit_log')), false)
    and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_select_authorized')
    and coalesce(has_table_privilege('authenticated', to_regclass('public.audit_log'), 'select'), false) as audit_log_read_boundary,
  exists (select 1 from pg_attribute where attrelid = 'public.attachments'::regclass and attname = 'expiration_date' and atttypid = 'date'::regtype and attnum > 0 and not attisdropped)
    and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'attachments' and indexname = 'attachments_fleet_vehicle_document_active_idx') as fleet_document_metadata,
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'firearm_storage_locations' and indexname = 'firearm_storage_locations_active_name_normalized')
    and to_regprocedure('public.update_firearm_storage_location(uuid,text,text)') is not null
    and to_regprocedure('public.deactivate_firearm_storage_location(uuid)') is not null
    and coalesce(has_function_privilege('authenticated', to_regprocedure('public.update_firearm_storage_location(uuid,text,text)'), 'execute'), false)
    and coalesce(has_function_privilege('authenticated', to_regprocedure('public.deactivate_firearm_storage_location(uuid)'), 'execute'), false) as storage_location_management,
  to_regclass('public.inventory_items') is not null
    and to_regclass('public.inventory_locations') is not null
    and to_regclass('public.inventory_balances') is not null
    and to_regclass('public.inventory_transactions') is not null
    and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'inventory_items' and indexname = 'inventory_items_department_active_idx')
    and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'inventory_transactions' and indexname = 'inventory_transactions_department_item_created_idx') as inventory_phase_one_relations,
  to_regprocedure('public.record_inventory_transaction(uuid,text,numeric,uuid,uuid,text,text)') is not null
    and coalesce(has_function_privilege('authenticated', to_regprocedure('public.record_inventory_transaction(uuid,text,numeric,uuid,uuid,text,text)'), 'execute'), false)
    and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inventory_items' and policyname = 'inventory_items_manage') as inventory_phase_one_runtime_boundary,
  to_regclass('public.inventory_checkouts') is not null
    and to_regclass('public.inventory_checkout_returns') is not null
    and exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'inventory_checkouts' and indexname = 'inventory_checkouts_department_open_idx')
    and exists (select 1 from pg_constraint where conrelid = to_regclass('public.inventory_transactions') and conname = 'inventory_transactions_transaction_type_check') as inventory_checkout_phase_two,
  to_regprocedure('public.checkout_inventory(uuid,uuid,text,uuid,text,uuid,numeric,timestamp with time zone,text,text)') is not null
    and to_regprocedure('public.return_inventory_checkout(uuid,numeric,text,text)') is not null
    and coalesce(has_function_privilege('authenticated', to_regprocedure('public.checkout_inventory(uuid,uuid,text,uuid,text,uuid,numeric,timestamp with time zone,text,text)'), 'execute'), false)
    and coalesce(has_function_privilege('authenticated', to_regprocedure('public.return_inventory_checkout(uuid,numeric,text,text)'), 'execute'), false)
    and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'inventory_checkouts' and policyname = 'inventory_checkouts_read') as inventory_checkout_runtime_boundary,
  coalesce(has_table_privilege('authenticated', to_regclass('public.inventory_items'), 'insert'), false)
    and coalesce(has_table_privilege('authenticated', to_regclass('public.inventory_items'), 'update'), false)
    and coalesce(has_table_privilege('authenticated', to_regclass('public.inventory_locations'), 'insert'), false)
    and coalesce(has_table_privilege('authenticated', to_regclass('public.inventory_locations'), 'update'), false) as inventory_runtime_dml_grants`;

export function assertProductionLedgerAdoptionPostconditions(row) {
  const failed = productionLedgerAdoptionPostconditions.filter((key) => row?.[key] !== true);
  if (failed.length) throw new Error(`AWS_NATIVE_PRODUCTION_ADOPTION_UNVERIFIED: ${failed.join(", ")}`);
}
