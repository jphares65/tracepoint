-- TracePoint staging preflight: read-only kit (docs/remediation/preflight/README.md).
-- Candidate code commit 70717ba (046 and 053 differ from 8574db3). Pending set: database/aws 038-046 and 048-053 (no 047).
-- Every statement below is a SELECT. Each gate runs in its own
-- `begin transaction read only; ... rollback;` block, so an error in one gate
-- does not hide the others. Nothing is written: no temporary tables, no
-- set_config, no SET. The psql meta-commands (\echo, \pset) only format output.
-- Safe to run before and after `migrate-db.ps1 staging -Action apply`.
-- Output holds ids and counts, not names; the B10 snapshot script (G4d) is separate.
\pset pager off
\pset footer off
\pset null '(null)'

\echo '==== SESSION: who and where (record in the results table) ===='
begin transaction read only;
select current_user, session_user, current_database(), inet_server_port() as port,
  split_part(version(), ' ', 2) as server_version,
  current_setting('transaction_read_only') as transaction_read_only,
  now() as run_at;
rollback;

\echo '==== G2 ledger: public.tracepoint_aws_schema_migrations ===='
begin transaction read only;
\echo '-- G2.1 ledger rows (expect 001-037 before apply; 001-046 and 048-053 after)'
select version, filename, content_sha256, applied_at, application_git_sha, environment, application_context, is_baseline
from public.tracepoint_aws_schema_migrations order by version;
\echo '-- G2.2 each repository file at 70717ba against the ledger (sha256 of the file bytes, as the runner computes)'
\echo '--      GO before apply: 001-037 "applied, hash matches"; 038-046,048-053 "pending"; no DRIFT, no unexpected row'
\echo '--      GO after apply: every row "applied, hash matches"'
with expected(version, filename, sha256) as (values
  (1, '001_provider_neutral_authorization_context.sql', 'e0c2a264ce64bd18469578b5186c9765490b108e47b5e903df2422a828949515'),
  (2, '002_cognito_application_session_idle.sql', '6f19b069025c568736b7bb1a937465d038b5f8db60cc37878c2c660c5f56de21'),
  (3, '003_runtime_role_and_auth_state.sql', '0cf4faf22bc61467bc57a4365ca6ccafc5e56585a93b1900dc0fe7ee49e55f00'),
  (4, '004_remove_supabase_authorization_runtime.sql', '440a076573ae21ad1e499d5be61d345e35b6bc83477e837f8b2f1a5d3bcc73e9'),
  (5, '005_command_dashboard_fleet_read.sql', '24547c774c5146f3b47d78a9250199bfafd5e1a19c6f898ac54295aaaf261ea7'),
  (6, '006_cognito_lifecycle_state.sql', '8554fad23498e4b68dc26aaec42efe66452515b51f83259b2cbb8a23c0d1d222'),
  (7, '007_ses_runtime_queue_access.sql', '44deea58c200a3891ee17b22dd1224e2933e7396574b3a072d2efd3951f0405c'),
  (8, '008_training_closeout_authorization.sql', '78f774cbfbd64b4017030952236b8ee54acce2777f495fbb23499c31f8f95230'),
  (9, '009_cognito_membership_lifecycle.sql', 'fa1bad83c12b714c3c2e310ed5156da4f0291fd7e7d2980fa77b8b8ab46be0f0'),
  (10, '010_cognito_inactive_invites.sql', '5ffece8ef922879df7ac4dfaccd1c8cef2a54bffdbd1ad94a9b53f2d0f2781e7'),
  (11, '011_onboarding_import_audit.sql', '53f4c04d43815680d0de243f989068d08b162aade0d14b1619f889d07f29794d'),
  (12, '012_onboarding_import_authority.sql', 'f2e75ff6c55dfcb93fe3e8a7441671ba50cdb261a4ed4f01d589ffe058abf66e'),
  (13, '013_cognito_existing_user_migration.sql', 'e62fc46e1e20fbe0b01a25dcc28accafea5859c54b0653d2849ac31a2fcf66e8'),
  (14, '014_platform_control_plane_access.sql', '425375ee94f7944fe46966996c640ddf629d673a0971782833562f9c24a8d20e'),
  (15, '015_platform_entitlements.sql', '5e9a3887b0299bed74d92424f0f632d2c22494982f6cde7da4165b76d763e574'),
  (16, '016_platform_support_mode.sql', 'e9ab64324a139eda1cd5a46eb95346ccc241935daf41f6e584c2fd144d403bc0'),
  (17, '017_bound_armory_rpc_authorization.sql', '2342fe563fe5cc97e95db2afe17808782f3893cd352deb1af9d240395d48a887'),
  (18, '018_fleet_and_off_duty_rls.sql', '63948dd92442e566e0d57f53b04d8bb82222d0ce32cf4c37e644ca6300d6abac'),
  (19, '019_authenticated_fleet_off_duty_privileges.sql', 'a7ba9bb8c50ee68855dd876b1dc8e829742f52c94945051d3b38cba1f0d310d2'),
  (20, '020_off_duty_inspection_rls.sql', '5fa8a156b76d224422861616dc518e2bc97afd8a407e7a8f1905b10194e3fdf6'),
  (21, '021_cognito_exceptional_identity_migration.sql', 'ca153fc054a026a38dfa0b50d063dbab50ba1081a23fb01cd37c5fa9ca946581'),
  (22, '022_cognito_flow_window.sql', '2d2774c456438c16457343a11dbf0eaffacabc68aeb53289c303c36e0a74f299'),
  (23, '023_audit_log_read_authorization.sql', '6b302016b812280d24e49a516018629c42d43d1b5dbfeb27f70ac77a8acfbbde'),
  (24, '024_notification_email_server_enqueue.sql', '99e8ca4d52bd4505721d0c509dd5d352162843dd8f257c0e19c71d315355abd0'),
  (25, '025_cognito_provider_username_reconciliation.sql', '4ddb1201cbfaedce154936028e4d264d4b98d3a26e40f5a2fd53435c6dcd2a9c'),
  (26, '026_cognito_invite_profile_trigger_reconciliation.sql', 'bc6fca6e5693cfad40ae9ce104a8bf5ec9cd0eda5750177737ecf167a840a612'),
  (27, '027_cognito_invite_retry_claim.sql', 'bf289e434a09658aad33b3d34b50c4e1602010636cf9594cafdccbf2ff8c1aa5'),
  (28, '028_firearm_custody_phase_a.sql', '5b80546230de13cef31b4d1f3f48103c9c014bfd981cee00428a7bba8a1ef0d0'),
  (29, '029_firearm_custody_phase_a_function_reconciliation.sql', 'dfa16cdf35ef583e960f7a700c177f9dd245685527149898041a36f1026bdf9d'),
  (30, '030_firearm_restricted_use.sql', 'f4ced487327ba4387a912a7d7bfdfbe66b004facc7ac69f1d8c44e51913bead7'),
  (31, '031_restricted_firearm_simple_custody.sql', '8a876feeaf4691171aec1f6d894880bd4bf5986d1eff33ef18336f07348f1842'),
  (32, '032_restore_audit_log_read_grant.sql', '1a10b005226b4bdfc094a6001e21076682e98cb08d911ad100f625450e8cd152'),
  (33, '033_fleet_vehicle_document_metadata.sql', 'a3c74bfbe670d2a4885521ce78390da32fb796500f12dae4b9c7b6a2fe1b0cc1'),
  (34, '034_firearm_storage_location_management.sql', '9416b3f219177dc8e4fc5e9f9cf9039245dc8e9bf1be2db25e41186ba2f7d86d'),
  (35, '035_inventory_phase1.sql', 'e617ea34b4403e0af34934de77b66f589940066f85faa5e04eb10062cdc39861'),
  (36, '036_inventory_checkout_phase2a.sql', 'e9298b65d290293c66a2f2420a7775a55a342b5c111db9b9cbaab6f8dc3ad7fc'),
  (37, '037_inventory_management_runtime_grants.sql', '8aad48a4378d7b69e392e0cdd2869e1e8a55226c0feb47e137b8006e21064f97'),
  (38, '038_equipment_out_of_service_lifecycle.sql', '1bc4a53c2b2e76d289258cc013e8c3c05dfeea52108e306941731388b7325506'),
  (39, '039_account_access_remediation.sql', '041a0a0a2f1ee3113d5e2ee9fc0bdf972f5f6cc652db7df2531a685e4c3a8162'),
  (40, '040_fleet_field_write_authorization.sql', '6746a6b6e6b82b2953a3e8723965e3077a5a931099ba5f4d3afdf2d90685a9c0'),
  (41, '041_equipment_self_custody.sql', '7c1cc8aac0e83314c0e3ab553fcb412fd9576ec6999e5922fe1b6132f641a604'),
  (42, '042_range_packet_ready_is_not_final.sql', '7f645286aadf9e7985c8cbf59b88e95177ff30e0afd1f6b9105cb55748ad6e7c'),
  (43, '043_fleet_inspection_audit_outbox.sql', 'e6916dbccc80a600ee39a2cffbe268674558b7a8ca72fa4825e3d545e6a690c1'),
  (44, '044_personnel_import_preservation.sql', '78895dd9f0fd5bf85f60a4a3cd2b4f5c6eeb172b6596cea4e034cba18d7c7655'),
  (45, '045_fleet_inspection_eligibility.sql', '8f55e6c366736fe73aeffd31e742582f4a57c81965bfc2d698afcc57bb617aad'),
  (46, '046_fleet_safety_hold_clearance.sql', 'c00da25ed9da8922db4845f9426895f2424ea9b01429bc843c9f2dbb8c4afb6f'),
  (48, '048_training_record_visibility.sql', '04fc6a4629ce3090af17925971da513e55fd6a4a0bfa1ff16600f91b862e2322'),
  (49, '049_equipment_separated_holder.sql', 'd3e6f807623a317f134a06861ac894e1a82ad3a42dfe35798b980bbb0e69b3fc'),
  (50, '050_training_closeout_records.sql', '7a58352487d58216f6e5dd7af704727d615d05feff6225dfa3408a654296ef9d'),
  (51, '051_range_instructor_line_actions.sql', '967a228e5098d2621e6f997861d96dced0f05c077b5819b490acc0b16d52986f'),
  (52, '052_armory_separation_of_duties.sql', 'dd12683cc38a37c24b49a62d17cca66dc652e2535aba3bce521f7eafccae2a65'),
  (53, '053_armory_audit_and_access.sql', '76f6af92b373f89051473064581bd9e71f0935209749045ce1a357324800067c')
), ledger as (
  select version, filename, content_sha256 from public.tracepoint_aws_schema_migrations
)
select coalesce(e.version, l.version) as version, coalesce(e.filename, l.filename) as filename,
  case
    when l.version is null then 'pending'
    when e.version is null then 'DRIFT: ledger row has no file at 70717ba'
    when l.filename is distinct from e.filename then 'DRIFT: filename differs'
    when l.content_sha256 is distinct from e.sha256 then 'DRIFT: hash differs'
    else 'applied, hash matches' end as state,
  e.sha256 as expected_sha256, l.content_sha256 as ledger_sha256
from expected e full join ledger l on l.version = e.version
order by 1;
\echo '-- G2.3 summary (GO before apply: 37 / 37 / 0 / 15 / 0)'
with expected(version, filename, sha256) as (values
  (1, '001_provider_neutral_authorization_context.sql', 'e0c2a264ce64bd18469578b5186c9765490b108e47b5e903df2422a828949515'),
  (2, '002_cognito_application_session_idle.sql', '6f19b069025c568736b7bb1a937465d038b5f8db60cc37878c2c660c5f56de21'),
  (3, '003_runtime_role_and_auth_state.sql', '0cf4faf22bc61467bc57a4365ca6ccafc5e56585a93b1900dc0fe7ee49e55f00'),
  (4, '004_remove_supabase_authorization_runtime.sql', '440a076573ae21ad1e499d5be61d345e35b6bc83477e837f8b2f1a5d3bcc73e9'),
  (5, '005_command_dashboard_fleet_read.sql', '24547c774c5146f3b47d78a9250199bfafd5e1a19c6f898ac54295aaaf261ea7'),
  (6, '006_cognito_lifecycle_state.sql', '8554fad23498e4b68dc26aaec42efe66452515b51f83259b2cbb8a23c0d1d222'),
  (7, '007_ses_runtime_queue_access.sql', '44deea58c200a3891ee17b22dd1224e2933e7396574b3a072d2efd3951f0405c'),
  (8, '008_training_closeout_authorization.sql', '78f774cbfbd64b4017030952236b8ee54acce2777f495fbb23499c31f8f95230'),
  (9, '009_cognito_membership_lifecycle.sql', 'fa1bad83c12b714c3c2e310ed5156da4f0291fd7e7d2980fa77b8b8ab46be0f0'),
  (10, '010_cognito_inactive_invites.sql', '5ffece8ef922879df7ac4dfaccd1c8cef2a54bffdbd1ad94a9b53f2d0f2781e7'),
  (11, '011_onboarding_import_audit.sql', '53f4c04d43815680d0de243f989068d08b162aade0d14b1619f889d07f29794d'),
  (12, '012_onboarding_import_authority.sql', 'f2e75ff6c55dfcb93fe3e8a7441671ba50cdb261a4ed4f01d589ffe058abf66e'),
  (13, '013_cognito_existing_user_migration.sql', 'e62fc46e1e20fbe0b01a25dcc28accafea5859c54b0653d2849ac31a2fcf66e8'),
  (14, '014_platform_control_plane_access.sql', '425375ee94f7944fe46966996c640ddf629d673a0971782833562f9c24a8d20e'),
  (15, '015_platform_entitlements.sql', '5e9a3887b0299bed74d92424f0f632d2c22494982f6cde7da4165b76d763e574'),
  (16, '016_platform_support_mode.sql', 'e9ab64324a139eda1cd5a46eb95346ccc241935daf41f6e584c2fd144d403bc0'),
  (17, '017_bound_armory_rpc_authorization.sql', '2342fe563fe5cc97e95db2afe17808782f3893cd352deb1af9d240395d48a887'),
  (18, '018_fleet_and_off_duty_rls.sql', '63948dd92442e566e0d57f53b04d8bb82222d0ce32cf4c37e644ca6300d6abac'),
  (19, '019_authenticated_fleet_off_duty_privileges.sql', 'a7ba9bb8c50ee68855dd876b1dc8e829742f52c94945051d3b38cba1f0d310d2'),
  (20, '020_off_duty_inspection_rls.sql', '5fa8a156b76d224422861616dc518e2bc97afd8a407e7a8f1905b10194e3fdf6'),
  (21, '021_cognito_exceptional_identity_migration.sql', 'ca153fc054a026a38dfa0b50d063dbab50ba1081a23fb01cd37c5fa9ca946581'),
  (22, '022_cognito_flow_window.sql', '2d2774c456438c16457343a11dbf0eaffacabc68aeb53289c303c36e0a74f299'),
  (23, '023_audit_log_read_authorization.sql', '6b302016b812280d24e49a516018629c42d43d1b5dbfeb27f70ac77a8acfbbde'),
  (24, '024_notification_email_server_enqueue.sql', '99e8ca4d52bd4505721d0c509dd5d352162843dd8f257c0e19c71d315355abd0'),
  (25, '025_cognito_provider_username_reconciliation.sql', '4ddb1201cbfaedce154936028e4d264d4b98d3a26e40f5a2fd53435c6dcd2a9c'),
  (26, '026_cognito_invite_profile_trigger_reconciliation.sql', 'bc6fca6e5693cfad40ae9ce104a8bf5ec9cd0eda5750177737ecf167a840a612'),
  (27, '027_cognito_invite_retry_claim.sql', 'bf289e434a09658aad33b3d34b50c4e1602010636cf9594cafdccbf2ff8c1aa5'),
  (28, '028_firearm_custody_phase_a.sql', '5b80546230de13cef31b4d1f3f48103c9c014bfd981cee00428a7bba8a1ef0d0'),
  (29, '029_firearm_custody_phase_a_function_reconciliation.sql', 'dfa16cdf35ef583e960f7a700c177f9dd245685527149898041a36f1026bdf9d'),
  (30, '030_firearm_restricted_use.sql', 'f4ced487327ba4387a912a7d7bfdfbe66b004facc7ac69f1d8c44e51913bead7'),
  (31, '031_restricted_firearm_simple_custody.sql', '8a876feeaf4691171aec1f6d894880bd4bf5986d1eff33ef18336f07348f1842'),
  (32, '032_restore_audit_log_read_grant.sql', '1a10b005226b4bdfc094a6001e21076682e98cb08d911ad100f625450e8cd152'),
  (33, '033_fleet_vehicle_document_metadata.sql', 'a3c74bfbe670d2a4885521ce78390da32fb796500f12dae4b9c7b6a2fe1b0cc1'),
  (34, '034_firearm_storage_location_management.sql', '9416b3f219177dc8e4fc5e9f9cf9039245dc8e9bf1be2db25e41186ba2f7d86d'),
  (35, '035_inventory_phase1.sql', 'e617ea34b4403e0af34934de77b66f589940066f85faa5e04eb10062cdc39861'),
  (36, '036_inventory_checkout_phase2a.sql', 'e9298b65d290293c66a2f2420a7775a55a342b5c111db9b9cbaab6f8dc3ad7fc'),
  (37, '037_inventory_management_runtime_grants.sql', '8aad48a4378d7b69e392e0cdd2869e1e8a55226c0feb47e137b8006e21064f97'),
  (38, '038_equipment_out_of_service_lifecycle.sql', '1bc4a53c2b2e76d289258cc013e8c3c05dfeea52108e306941731388b7325506'),
  (39, '039_account_access_remediation.sql', '041a0a0a2f1ee3113d5e2ee9fc0bdf972f5f6cc652db7df2531a685e4c3a8162'),
  (40, '040_fleet_field_write_authorization.sql', '6746a6b6e6b82b2953a3e8723965e3077a5a931099ba5f4d3afdf2d90685a9c0'),
  (41, '041_equipment_self_custody.sql', '7c1cc8aac0e83314c0e3ab553fcb412fd9576ec6999e5922fe1b6132f641a604'),
  (42, '042_range_packet_ready_is_not_final.sql', '7f645286aadf9e7985c8cbf59b88e95177ff30e0afd1f6b9105cb55748ad6e7c'),
  (43, '043_fleet_inspection_audit_outbox.sql', 'e6916dbccc80a600ee39a2cffbe268674558b7a8ca72fa4825e3d545e6a690c1'),
  (44, '044_personnel_import_preservation.sql', '78895dd9f0fd5bf85f60a4a3cd2b4f5c6eeb172b6596cea4e034cba18d7c7655'),
  (45, '045_fleet_inspection_eligibility.sql', '8f55e6c366736fe73aeffd31e742582f4a57c81965bfc2d698afcc57bb617aad'),
  (46, '046_fleet_safety_hold_clearance.sql', 'c00da25ed9da8922db4845f9426895f2424ea9b01429bc843c9f2dbb8c4afb6f'),
  (48, '048_training_record_visibility.sql', '04fc6a4629ce3090af17925971da513e55fd6a4a0bfa1ff16600f91b862e2322'),
  (49, '049_equipment_separated_holder.sql', 'd3e6f807623a317f134a06861ac894e1a82ad3a42dfe35798b980bbb0e69b3fc'),
  (50, '050_training_closeout_records.sql', '7a58352487d58216f6e5dd7af704727d615d05feff6225dfa3408a654296ef9d'),
  (51, '051_range_instructor_line_actions.sql', '967a228e5098d2621e6f997861d96dced0f05c077b5819b490acc0b16d52986f'),
  (52, '052_armory_separation_of_duties.sql', 'dd12683cc38a37c24b49a62d17cca66dc652e2535aba3bce521f7eafccae2a65'),
  (53, '053_armory_audit_and_access.sql', '76f6af92b373f89051473064581bd9e71f0935209749045ce1a357324800067c')
), ledger as (
  select version, filename, content_sha256 from public.tracepoint_aws_schema_migrations
)
select
  (select count(*) from ledger) as ledger_rows,
  (select count(*) from ledger l join expected e using (version) where l.filename = e.filename and l.content_sha256 = e.sha256) as rows_matching_70717ba,
  (select count(*) from ledger l left join expected e using (version) where e.version is null or l.filename is distinct from e.filename or l.content_sha256 is distinct from e.sha256) as drift_rows,
  (select count(*) from expected e where not exists (select 1 from ledger l where l.version = e.version)) as pending_files,
  (select count(*) from ledger where version = 47) as rows_for_047,
  (select max(version) from ledger) as latest_applied;
rollback;

\echo '==== G3 hard schema dependencies ===='
begin transaction read only;
\echo '-- G3.1 roles named by GRANT/REVOKE in 038-053 (all must exist; runtime must be a member of authenticated)'
select r.role_name, exists (select 1 from pg_roles where rolname = r.role_name) as present
from (values ('tracepoint_runtime'), ('authenticated'), ('anon'), ('service_role'), ('tracepoint_migrator')) r(role_name)
union all
select 'tracepoint_runtime member of authenticated',
  exists (select 1 from pg_roles where rolname = 'tracepoint_runtime') and exists (select 1 from pg_roles where rolname = 'authenticated')
  and pg_has_role('tracepoint_runtime', 'authenticated', 'member');
\echo '-- G3.2 objects from 028-031 and 033-037 (all true; these are applied on staging per the ledger)'
select o.migration, o.kind, o.name,
  case o.kind when 'relation' then to_regclass(o.name) is not null
              when 'function' then to_regprocedure(o.name) is not null
              when 'column' then exists (select 1 from information_schema.columns c
                where c.table_schema = 'public' and c.table_name = split_part(o.name, '.', 2) and c.column_name = split_part(o.name, '.', 3))
              when 'index' then to_regclass(o.name) is not null end as present
from (values
  ('028','relation','public.firearm_storage_locations'), ('028','relation','public.firearm_current_custody'),
  ('028','relation','public.firearm_possession_restrictions'), ('028','relation','public.firearm_custody_events'),
  ('028','relation','public.available_firearms_for_assignment'),
  ('028','function','public.transfer_firearm_custody(uuid,text,uuid,uuid,text,text,uuid,boolean)'),
  ('029','function','public.create_firearm_storage_location(text,text)'),
  ('029','function','public.create_firearm_possession_restriction(uuid,text,boolean,boolean,boolean,boolean,text,timestamp with time zone)'),
  ('030','function','public.set_firearm_restricted_use(uuid,text,boolean,boolean,boolean,boolean,text)'),
  ('030','function','public.clear_firearm_possession_restriction(uuid,text)'),
  ('031','function','public.set_firearm_restriction(uuid,text,date,text,text,date)'),
  ('031','function','public.clear_firearm_restriction(uuid,text)'),
  ('031','function','public.operate_restricted_firearm_custody(uuid,text,uuid,text,uuid)'),
  ('031','column','public.firearm_possession_restrictions.restriction_type'),
  ('031','index','public.firearm_possession_restrictions_one_active'),
  ('033','column','public.attachments.expiration_date'),
  ('033','index','public.attachments_fleet_vehicle_document_active_idx'),
  ('034','function','public.update_firearm_storage_location(uuid,text,text)'),
  ('034','function','public.deactivate_firearm_storage_location(uuid)'),
  ('035','relation','public.inventory_items'), ('035','relation','public.inventory_locations'),
  ('035','relation','public.inventory_balances'), ('035','relation','public.inventory_transactions'),
  ('035','function','public.record_inventory_transaction(uuid,text,numeric,uuid,uuid,text,text)'),
  ('036','relation','public.inventory_checkouts'), ('036','relation','public.inventory_checkout_returns'),
  ('036','function','public.checkout_inventory(uuid,uuid,text,uuid,text,uuid,numeric,timestamp with time zone,text,text)'),
  ('036','function','public.return_inventory_checkout(uuid,numeric,text,text)')
) o(migration, kind, name)
union all
select '037', 'grant', 'authenticated insert+update on inventory_items, inventory_locations',
  to_regclass('public.inventory_items') is not null and to_regclass('public.inventory_locations') is not null
  and has_table_privilege('authenticated', 'public.inventory_items', 'insert,update')
  and has_table_privilege('authenticated', 'public.inventory_locations', 'insert,update')
order by 1, 3;
\echo '-- G3.3 existing objects that 038-053 reference or replace (all true before apply)'
select o.used_by, o.kind, o.name,
  case o.kind when 'relation' then to_regclass(o.name) is not null else to_regprocedure(o.name) is not null end as present
from (values
  ('044', 'function', 'public.attach_existing_cognito_personnel_import(uuid,text,text,text,text,text,text)'),
  ('050', 'function', 'public.close_agency_training_event_internal(uuid,uuid,uuid)'),
  ('039', 'function', 'public.create_department_with_owner(text,text,text,text,text,text)'),
  ('040,042,043,045,046,048,049,051,053', 'function', 'public.has_any_department_permission(uuid,text[])'),
  ('039,040,044,045,051,052,053', 'function', 'public.has_department_permission(uuid,text)'),
  ('041,045', 'function', 'public.is_active_department_member(uuid,uuid)'),
  ('043,046,048,051', 'function', 'public.is_department_member(uuid)'),
  ('042,051', 'function', 'public.protect_pilot_range_workspace_mutation()'),
  ('042', 'function', 'public.protect_range_day_drill_history()'),
  ('042,051', 'function', 'public.range_workspace_collection(jsonb,text,text)'),
  ('042,051', 'function', 'public.range_workspace_day_items(jsonb,text,text,text)'),
  ('052', 'function', 'public.record_off_duty_firearm_inspection_internal(uuid,uuid,uuid,date,text,text)'),
  ('050', 'function', 'public.reopen_agency_training_event_internal(uuid,uuid,uuid,text)'),
  ('049', 'function', 'public.sync_equipment_asset_assignment_history()'),
  ('040,041,043,045,046,053', 'function', 'tracepoint_auth.department_id()'),
  ('043,046', 'function', 'tracepoint_auth.is_platform_supporting(uuid)'),
  ('039,044', 'function', 'tracepoint_auth.prepare_cognito_membership_operation(uuid,text,uuid,uuid)'),
  ('039,040,041,043,044,045,046,048,049,051,052,053', 'function', 'tracepoint_auth.subject_id()'),
  ('044', 'function', 'public.update_cognito_personnel_import(uuid,uuid,text,text,text,text,text,text,text)'),
  ('049', 'function', 'public.validate_equipment_asset_assignment()'),
  ('048,050', 'relation', 'public.agency_training_attendees'),
  ('048,050', 'relation', 'public.agency_training_certificates'),
  ('050', 'relation', 'public.agency_training_event_instructors'),
  ('050', 'relation', 'public.agency_training_events'),
  ('048', 'relation', 'public.agency_training_requirement_members'),
  ('052', 'relation', 'public.ammunition_reconciliations'),
  ('048,050,051', 'relation', 'public.attachments'),
  ('039,040,043,044,045,046,051', 'relation', 'public.audit_events'),
  ('039,044', 'relation', 'public.authentication_access_sessions'),
  ('039', 'relation', 'public.authentication_identity_events'),
  ('039,044', 'relation', 'public.authentication_identity_links'),
  ('039,044', 'relation', 'public.authentication_lifecycle_operations'),
  ('039,044', 'relation', 'public.authentication_refresh_sessions'),
  ('039,044', 'relation', 'public.authentication_session_revocations'),
  ('050', 'relation', 'public.certification_types'),
  ('041', 'relation', 'public.department_features'),
  ('044,045', 'relation', 'public.department_membership_roles'),
  ('039,041,044,045,049,053', 'relation', 'public.department_memberships'),
  ('043,050', 'relation', 'public.departments'),
  ('048', 'relation', 'public.drill_run_results'),
  ('041,049', 'relation', 'public.equipment_asset_assignments'),
  ('038,041', 'relation', 'public.equipment_assets'),
  ('053', 'relation', 'public.firearm_assignments'),
  ('053', 'relation', 'public.firearm_status_history'),
  ('053', 'relation', 'public.firearms'),
  ('043,045', 'relation', 'public.fleet_rules'),
  ('040,045', 'relation', 'public.fleet_vehicle_equipment'),
  ('043,045,046', 'relation', 'public.fleet_vehicle_inspections'),
  ('040,043,045,046,049', 'relation', 'public.fleet_vehicles'),
  ('040,043,045,046', 'relation', 'public.fleet_work_orders'),
  ('052', 'relation', 'public.off_duty_firearm_inspections'),
  ('052', 'relation', 'public.off_duty_firearm_requests'),
  ('052,053', 'relation', 'public.personal_rifle_status_history'),
  ('052,053', 'relation', 'public.personal_rifles'),
  ('048,051', 'relation', 'public.pilot_range_workspaces'),
  ('044,049,053', 'relation', 'public.profiles'),
  ('048,051', 'relation', 'public.qualification_results'),
  ('048', 'relation', 'public.range_day_roster'),
  ('042', 'relation', 'public.range_days'),
  ('048', 'relation', 'public.range_packets'),
  ('048', 'relation', 'public.remedial_training_recommendations'),
  ('048,050', 'relation', 'public.training_certifications')
) o(used_by, kind, name)
order by (not (case o.kind when 'relation' then to_regclass(o.name) is not null else to_regprocedure(o.name) is not null end)) desc, 3;
\echo '-- G3.4 columns the pending files and this kit read (all true)'
select c.name, exists (select 1 from information_schema.columns ic
  where ic.table_schema = 'public' and ic.table_name = split_part(c.name, '.', 1) and ic.column_name = split_part(c.name, '.', 2)) as present
from (values
  ('fleet_vehicles.status'), ('fleet_vehicles.status_reason'), ('fleet_vehicles.status_override_active'), ('fleet_vehicles.updated_at'),
  ('fleet_vehicle_inspections.critical_defect_count'), ('fleet_vehicle_inspections.inspector_user_id'), ('fleet_vehicle_inspections.created_at'),
  ('fleet_work_orders.priority'), ('fleet_work_orders.affects_availability'), ('fleet_work_orders.status'), ('fleet_work_orders.record_type'),
  ('fleet_work_orders.created_by_user_id'), ('fleet_work_orders.created_at'),
  ('fleet_rules.status_automation_enabled'), ('fleet_rules.critical_issue_out_of_service'), ('fleet_rules.inspection_role_codes'),
  ('audit_events.details'), ('audit_events.actor_user_id'), ('audit_events.summary'),
  ('equipment_assets.lifecycle_status'), ('equipment_assets.assigned_user_id'), ('equipment_assets.removal_reason'),
  ('equipment_asset_assignments.returned_at'), ('equipment_asset_assignments.return_notes'),
  ('personal_rifles.owner_user_id'), ('personal_rifles.armorer_reviewed_by'), ('personal_rifles.chief_reviewed_by'),
  ('personal_rifles.armorer_checklist'), ('personal_rifles.qualification_verified'), ('personal_rifles.inspection_date'),
  ('personal_rifle_status_history.metadata'), ('personal_rifle_status_history.actor_user_id'),
  ('firearm_status_history.changed_by_user_id'), ('firearms.condition_status'), ('firearm_assignments.returned_at'),
  ('off_duty_firearm_requests.reviewed_by_user_id'), ('off_duty_firearm_requests.compliance_status'), ('off_duty_firearm_requests.inspection_reviewed'),
  ('ammunition_reconciliations.submitted_by'), ('ammunition_reconciliations.certified_by'),
  ('training_certifications.source_training_event_id'), ('training_certifications.source_training_attendee_id'),
  ('agency_training_events.starts_at'), ('agency_training_events.reopened_at'), ('departments.timezone'),
  ('attachments.entity_key'), ('attachments.uploaded_by_user_id'), ('qualification_results.officer_user_id'),
  ('pilot_range_workspaces.workspace'), ('pilot_range_workspaces.updated_at'),
  ('notification_events.kind'), ('notification_events.detail'), ('notification_events.source_created_at'),
  ('notification_email_queue.status'), ('notification_email_queue.notification_key')
) c(name)
order by 2, 1;
\echo '-- G3.5 owners: every table the pending files alter or put policies/triggers on, and every function they replace, must be owned by the'
\echo '--      migration login (tracepoint_migrator). 041 needs this for equipment_assets/equipment_asset_assignments (S1.3).'
select 'table' as kind, t.tablename::text as name, t.tableowner::text as owner, t.tableowner = 'tracepoint_migrator' as owned_by_migrator
from pg_tables t
where t.schemaname = 'public' and t.tablename in ('agency_training_attendees','agency_training_certificates','agency_training_requirement_members',
  'ammunition_reconciliations','attachments','audit_events','drill_run_results','equipment_asset_assignments','equipment_assets','firearm_status_history',
  'fleet_rules','fleet_vehicle_equipment','fleet_vehicle_inspections','fleet_vehicles','fleet_work_orders','off_duty_firearm_requests',
  'personal_rifle_status_history','personal_rifles','profiles','qualification_results','range_day_roster','range_packets',
  'remedial_training_recommendations','training_certifications','pilot_range_workspaces')
union all
select 'function', p.oid::regprocedure::text, pg_get_userbyid(p.proowner), pg_get_userbyid(p.proowner) = 'tracepoint_migrator'
from pg_proc p
where p.oid in (select to_regprocedure(x) from (values
  ('tracepoint_auth.prepare_cognito_membership_operation(uuid,text,uuid,uuid)'),
  ('public.protect_pilot_range_workspace_mutation()'), ('public.protect_range_day_drill_history()'),
  ('public.attach_existing_cognito_personnel_import(uuid,text,text,text,text,text,text)'),
  ('public.update_cognito_personnel_import(uuid,uuid,text,text,text,text,text,text,text)'),
  ('public.validate_equipment_asset_assignment()'), ('public.sync_equipment_asset_assignment_history()'),
  ('public.close_agency_training_event_internal(uuid,uuid,uuid)'), ('public.reopen_agency_training_event_internal(uuid,uuid,uuid,text)'),
  ('public.record_off_duty_firearm_inspection_internal(uuid,uuid,uuid,date,text,text)'),
  ('public.create_department_with_owner(text,text,text,text,text,text)')) f(x))
order by 4, 1, 2;
\echo '-- G3.6 grantors of the privileges 039 and 052 REVOKE. A REVOKE by the owner removes only grants the owner made: any row with'
\echo '--      grantor <> owner means that grant SURVIVES the migration (the B8a after-check would then fail). GO: grantor_is_owner true on the'
\echo '--      personal_rifle_status_history and create_department_with_owner rows. firearm_status_history rows are context only: 053 at'
\echo '--      70717ba keeps the 037 grants (a 053 that revokes them would make those rows required too).'
select c.relname as object, pg_get_userbyid(c.relowner) as owner, pg_get_userbyid(a.grantor) as grantor, pg_get_userbyid(a.grantee) as grantee,
  a.privilege_type, a.grantor = c.relowner as grantor_is_owner
from pg_class c cross join lateral aclexplode(c.relacl) a
where c.oid in (to_regclass('public.personal_rifle_status_history'), to_regclass('public.firearm_status_history'))
  and a.grantee in (select oid from pg_roles where rolname in ('authenticated', 'tracepoint_runtime'))
  and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
union all
select p.oid::regprocedure::text, pg_get_userbyid(p.proowner), pg_get_userbyid(a.grantor),
  case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end, a.privilege_type, a.grantor = p.proowner
from pg_proc p cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
where p.oid = to_regprocedure('public.create_department_with_owner(text,text,text,text,text,text)')
  and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('authenticated', 'anon')))
order by 1, 4, 5;
\echo '-- G3.7 pre-existing policies that 048/049/051/052 drop by name and replace (053 row: context). GO before apply: every row present = true.'
\echo '--      A false row means staging uses another name: that old policy would stay next to the new one (permissive policies OR'
\echo '--      together), so the TV/B8a narrowing would not take effect. After apply: the 048 "member" rows are false;'
\echo '--      attachments_select / profiles / ammunition_reconciliations_update are true (recreated); the 053 row stays true (70717ba keeps it).'
select r.migration, r.table_name, r.policy_name,
  exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.table_name and p.policyname = r.policy_name) as present
from (values
  ('048', 'training_certifications', 'department members can view training certifications'),
  ('048', 'agency_training_attendees', 'department members can view agency training attendees'),
  ('048', 'agency_training_requirement_members', 'department members can view agency training requirement members'),
  ('048', 'agency_training_certificates', 'department members can view agency training certificates'),
  ('048', 'qualification_results', 'qualification_results_select_member'),
  ('048', 'drill_run_results', 'drill_run_results_select_member'),
  ('048', 'range_day_roster', 'range_day_roster_select_member'),
  ('048', 'remedial_training_recommendations', 'remedial_training_recommendations_select_member'),
  ('048', 'range_packets', 'range_packets_select_member'),
  ('048/051', 'attachments', 'attachments_select'),
  ('049', 'profiles', 'profiles_select_self_or_department_admin'),
  ('052', 'ammunition_reconciliations', 'ammunition_reconciliations_update'),
  ('053', 'firearm_status_history', 'firearm_status_history_insert_managers')
) r(migration, table_name, policy_name)
order by 1, 2;
\echo '-- G3.8 every SELECT/ALL policy on the tables 048/049/051 narrow (GO before apply: only the G3.7 names plus *_manage_training;'
\echo '--      GO after apply: the *_own_or_authorized / range_packets_select_authorized / attachments_select / profiles policy plus *_manage_training)'
select p.tablename, p.policyname, p.cmd, p.permissive, array_to_string(p.roles, ',') as roles
from pg_policies p
where p.schemaname = 'public' and p.cmd in ('SELECT', 'ALL')
  and p.tablename in ('training_certifications', 'agency_training_attendees', 'agency_training_requirement_members', 'agency_training_certificates',
    'qualification_results', 'drill_run_results', 'range_day_roster', 'remedial_training_recommendations', 'range_packets', 'attachments', 'profiles')
order by 1, 2;
\echo '-- G3.9 column fingerprints of the tables the pending files and previews touch (advisory: "differs" = inspect that table'
\echo '--      by hand; extra production-only columns are acceptable, missing ones are not). fleet_audit_outbox is created by 043 (046 adds two columns).'
with expected(table_name, fp_037, fp_053) as (values
  ('agency_training_attendees', 'ba9402623cc37c45cdedd6a6c0f55bb7', 'ba9402623cc37c45cdedd6a6c0f55bb7'),
  ('agency_training_certificates', 'd865067f4d6e27d2f72760393b08ac62', 'd865067f4d6e27d2f72760393b08ac62'),
  ('agency_training_event_instructors', 'badef9be4962ba371e2765bea3f3b4bc', 'badef9be4962ba371e2765bea3f3b4bc'),
  ('agency_training_events', '62d5ac8e553bb6ae21a2c6af9380f331', '62d5ac8e553bb6ae21a2c6af9380f331'),
  ('agency_training_requirement_members', 'c6b4e01774e794ede04f8ad84db2b1d8', 'c6b4e01774e794ede04f8ad84db2b1d8'),
  ('ammunition_lots', 'd6d73d8e384915c59e1cc97c68486849', 'd6d73d8e384915c59e1cc97c68486849'),
  ('ammunition_reconciliation_items', 'cfabca528c7ea24f4b02f72d7c3908e5', 'cfabca528c7ea24f4b02f72d7c3908e5'),
  ('ammunition_reconciliations', 'ee19a89ca402e6f3331b9d51c67aab06', 'ee19a89ca402e6f3331b9d51c67aab06'),
  ('attachments', '2712af1cb0b7c4465e29be133e619062', '2712af1cb0b7c4465e29be133e619062'),
  ('audit_events', 'be6fd47f1f91ae9ad9d8f99e261f9de7', 'be6fd47f1f91ae9ad9d8f99e261f9de7'),
  ('audit_log', 'e8ceeb089ea364faaa65398a4975e0d1', 'e8ceeb089ea364faaa65398a4975e0d1'),
  ('authentication_access_sessions', 'd461ad02f076eef9d0a8ad3e364f7a06', 'd461ad02f076eef9d0a8ad3e364f7a06'),
  ('authentication_identity_events', 'c8c7b1ddf1338f131ce563d079ef154b', 'c8c7b1ddf1338f131ce563d079ef154b'),
  ('authentication_identity_links', '3d65f10acc8bea4f43c629b57b02d4d3', '3d65f10acc8bea4f43c629b57b02d4d3'),
  ('authentication_lifecycle_operations', 'c53cb745cae37dad6db0c4b7c784dd36', 'c53cb745cae37dad6db0c4b7c784dd36'),
  ('authentication_refresh_sessions', 'c19409b9933c7c5ba7ca60b616ddc916', 'c19409b9933c7c5ba7ca60b616ddc916'),
  ('authentication_session_revocations', '4b8b4ca8eb93d8316fda40f8e739cd63', '4b8b4ca8eb93d8316fda40f8e739cd63'),
  ('certification_types', '8b48171710aa3a9186dadf7a1f58f2dc', '8b48171710aa3a9186dadf7a1f58f2dc'),
  ('department_certification_requirements', '0da2121cfb693a94229f994460b23b6f', '0da2121cfb693a94229f994460b23b6f'),
  ('department_features', '70d8c51e710db1549ffba649eabe8ccf', '70d8c51e710db1549ffba649eabe8ccf'),
  ('department_membership_roles', '834644ea7f3b402d6206a17448b480de', '834644ea7f3b402d6206a17448b480de'),
  ('department_memberships', '4108cc19ded93a0dc962debf41be543b', '4108cc19ded93a0dc962debf41be543b'),
  ('department_qualification_standard_components', 'cea11f864eaf2090e3fd4451620971cb', 'cea11f864eaf2090e3fd4451620971cb'),
  ('department_qualification_standards', '83efbc69b6ea7997bd79d3a42764c423', '83efbc69b6ea7997bd79d3a42764c423'),
  ('department_rules', 'df8c97f646d852061789581706ace1f1', 'df8c97f646d852061789581706ace1f1'),
  ('departments', '339669438e8c7a6fdbefe174bda20595', '339669438e8c7a6fdbefe174bda20595'),
  ('drill_run_results', '18653e45ef78641ed1d08d1b23aedfb1', '18653e45ef78641ed1d08d1b23aedfb1'),
  ('equipment_asset_assignments', '6cf4e19f1c237e90cd61a788a5e97b79', '6cf4e19f1c237e90cd61a788a5e97b79'),
  ('equipment_assets', '6f86e34deece5061a8c8e4c2933da5cf', '6f86e34deece5061a8c8e4c2933da5cf'),
  ('equipment_types', '8fa70c9f7861045b4a3be8c1efd40a3e', '8fa70c9f7861045b4a3be8c1efd40a3e'),
  ('firearm_assignments', '522ef721568dadd62c39027de612d154', '522ef721568dadd62c39027de612d154'),
  ('firearm_status_history', '6feb8cfef4894cb6e700490d54d2aa21', '6feb8cfef4894cb6e700490d54d2aa21'),
  ('firearms', '7c25bca1320428dc715cb41b1eca9aec', '7c25bca1320428dc715cb41b1eca9aec'),
  ('fleet_audit_outbox', null, 'f50cf39a5916c4c580ac47899f463391'),
  ('fleet_rules', 'b93be5e788793fb8454132adf7a2e2b8', 'b93be5e788793fb8454132adf7a2e2b8'),
  ('fleet_vehicle_equipment', '24cc5c27df560152679dbcb772b055e1', '24cc5c27df560152679dbcb772b055e1'),
  ('fleet_vehicle_inspections', '77d51b7b09c9e58fe7da34dfa84d3216', '77d51b7b09c9e58fe7da34dfa84d3216'),
  ('fleet_vehicles', 'ed5e330bceaf8f3f8a7eacc1fd421083', 'f72bae198544e5c9b53776f86a97cccd'),
  ('fleet_work_orders', '33bde0a056f343e5e6396abb4db03cc2', '33bde0a056f343e5e6396abb4db03cc2'),
  ('notification_email_queue', 'a52a0ec488c4cebec4fe7993bfb32937', 'a52a0ec488c4cebec4fe7993bfb32937'),
  ('notification_events', '373f4890b1eb7be5a82bf3c6382b5cf3', '373f4890b1eb7be5a82bf3c6382b5cf3'),
  ('off_duty_firearm_inspections', 'efc08de82c25f58fb7661351d309dc74', 'efc08de82c25f58fb7661351d309dc74'),
  ('off_duty_firearm_requests', '50c04ffb2c2f7535835ff5a4e5bb9c6e', '50c04ffb2c2f7535835ff5a4e5bb9c6e'),
  ('personal_rifle_status_history', 'f1fc6f5aac7ae769a715ced6b456e42f', 'f1fc6f5aac7ae769a715ced6b456e42f'),
  ('personal_rifles', 'f05b84f77aec7a8771b3a7fe1dfe514a', 'b6d151bcb7bcb84170682d357c5d0a58'),
  ('pilot_range_workspaces', 'e096ee65cffb8bb615cf463499a6f58e', 'e096ee65cffb8bb615cf463499a6f58e'),
  ('profiles', 'b089f6037492add19a195915c6fd045f', 'b089f6037492add19a195915c6fd045f'),
  ('qualification_results', '9038d9e52f1fb3412c8ef8a8b80e9caf', '9038d9e52f1fb3412c8ef8a8b80e9caf'),
  ('range_day_roster', 'a4929851af0bbee01d70103829465e9d', 'a4929851af0bbee01d70103829465e9d'),
  ('range_days', '6b298974e3e4fd17d1d6e7b4a1a093e3', '6b298974e3e4fd17d1d6e7b4a1a093e3'),
  ('range_packets', 'c8f7319914b8a1873f0f9e44dd30b153', 'c8f7319914b8a1873f0f9e44dd30b153'),
  ('remedial_training_recommendations', '57b4d38d8d881a450aed8b20f3f2d201', '57b4d38d8d881a450aed8b20f3f2d201'),
  ('training_certifications', '5f55c3d927f434d7c72d0eb8ca4d0090', 'c35cfdc97ac53a4da687b8a9310d087d')
), actual as (
  select c.relname as table_name,
    md5(string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end, ',' order by a.attname)) as fp
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relkind in ('r', 'p')
  group by 1
)
select e.table_name,
  case when a.fp is null then case when e.fp_037 is null then 'absent (created by 043)' else 'MISSING TABLE' end
       when a.fp = e.fp_037 then 'matches 037 rehearsal'
       when a.fp = e.fp_053 then 'matches 053 rehearsal'
       else 'differs (inspect)' end as state
from expected e left join actual a using (table_name)
order by 2 desc, 1;
rollback;

\echo '==== G4 data-impact previews (read-only; record every output) ===='
begin transaction read only;
\echo '-- G4a 046 safety-hold preview (F6a record, verbatim). Record per agency; after apply, baseline_cleared total must equal A.1 below'
with vehicles as (
  select v.id, v.department_id, v.status,
    (select max(c.created_at) from (
       select i.created_at from public.fleet_vehicle_inspections i
       where i.department_id = v.department_id and i.vehicle_id = v.id and i.critical_defect_count > 0
       union all
       select w.created_at from public.fleet_work_orders w
       where w.department_id = v.department_id and w.vehicle_id = v.id and (w.priority = 'Critical' or w.affects_availability)) c) as condition_at,
    exists (select 1 from public.fleet_work_orders w
      where w.department_id = v.department_id and w.vehicle_id = v.id
        and w.status not in ('Completed', 'Cancelled') and (w.priority = 'Critical' or w.affects_availability)) as open_critical
  from public.fleet_vehicles v
), classified as (
  select vehicles.*, condition_at is not null and exists (select 1 from public.fleet_vehicle_inspections i
      where i.department_id = vehicles.department_id and i.vehicle_id = vehicles.id
        and i.critical_defect_count = 0 and i.created_at > vehicles.condition_at) as verified
  from vehicles
)
select department_id,
  count(*) as vehicles,
  count(*) filter (where condition_at is not null) as with_critical_history,
  count(*) filter (where open_critical) as held_by_open_critical_work,
  count(*) filter (where condition_at is not null and not open_critical and verified) as baseline_cleared,
  count(*) filter (where condition_at is not null and not open_critical and not verified) as newly_held,
  count(*) filter (where condition_at is not null and not open_critical and not verified and status in ('Available', 'Attention')) as newly_held_now_available_or_attention
from classified
group by department_id
order by department_id;
\echo '-- G4a.2 newly_held subset by current status (Retired vehicles are counted above but cannot visibly change)'
with vehicles as (
  select v.id, v.department_id, v.status,
    (select max(c.created_at) from (
       select i.created_at from public.fleet_vehicle_inspections i
       where i.department_id = v.department_id and i.vehicle_id = v.id and i.critical_defect_count > 0
       union all
       select w.created_at from public.fleet_work_orders w
       where w.department_id = v.department_id and w.vehicle_id = v.id and (w.priority = 'Critical' or w.affects_availability)) c) as condition_at,
    exists (select 1 from public.fleet_work_orders w
      where w.department_id = v.department_id and w.vehicle_id = v.id
        and w.status not in ('Completed', 'Cancelled') and (w.priority = 'Critical' or w.affects_availability)) as open_critical
  from public.fleet_vehicles v
)
select department_id, status, count(*) as newly_held
from vehicles v
where condition_at is not null and not open_critical
  and not exists (select 1 from public.fleet_vehicle_inspections i where i.department_id = v.department_id and i.vehicle_id = v.id
    and i.critical_defect_count = 0 and i.created_at > v.condition_at)
group by 1, 2 order by 1, 2;
\echo '-- G4b equipment lifecycle constraint (S1.4; 038 normalises it either way) and current lifecycle values'
select pg_get_constraintdef(oid) as definition from pg_constraint
where conname = 'equipment_assets_lifecycle_status_check' and conrelid = to_regclass('public.equipment_assets');
select lifecycle_status, count(*) from public.equipment_assets group by 1 order by 1;
\echo '-- G4b.2 items held by inactive members (049 lets these go out of service / be removed; S19)'
select a.department_id, count(*) as items_held_by_inactive_members
from public.equipment_assets a
join public.department_memberships m on m.department_id = a.department_id and m.user_id = a.assigned_user_id
where not m.is_active and a.lifecycle_status <> 'removed'
group by 1 order by 1;
rollback;

begin transaction read only;
\echo '-- G4c DC date-defect checks Q1-Q9 (hotfix branch DC-production-impact-inventory.md section 4, verbatim)'
\echo '-- Q1: users who would see false "Expired"'
select tc.department_id, d.name,
       count(*)                                         as affected_credentials,
       count(distinct tc.user_id)                       as affected_users,
       count(*) filter (where tc.expiration_date >= current_date) as truly_unexpired,
       count(*) filter (where tc.expiration_date <  current_date) as truly_expired
from public.training_certifications tc
join public.certification_types ct on ct.id = tc.certification_type_id
join public.department_certification_requirements r
  on r.department_id = tc.department_id and r.certification_type_id = tc.certification_type_id
 and r.is_active is not false and r.is_required is not false
join public.departments d on d.id = tc.department_id
join public.department_memberships m on m.department_id = tc.department_id and m.user_id = tc.user_id and m.is_active
where tc.is_active and ct.expiration_required is not false
  and (tc.expiration_date is not null or tc.issue_date is not null)
group by 1,2 order by 3 desc;
\echo '-- Q2: persisted false-expired events since cutover'
select ne.department_id, count(*) as events, count(distinct ne.user_id) as users,
       count(*) filter (where ne.resolved_at is null) as open_events,
       min(ne.first_seen_at), max(ne.last_seen_at)
from public.notification_events ne
where ne.kind = 'required_certification_expired'
  and ne.detail = 'Certification requires an expiration date, but no valid expiration can be determined.'
  and ne.last_seen_at >= '2026-09-29'
group by 1;
\echo '-- Q2b: of those, how many have a credential that is actually in the future'
select count(distinct ne.id)
from public.notification_events ne
join public.training_certifications tc
  on ne.notification_key = 'certification-readiness-' || tc.user_id || '-' || tc.certification_type_id
 and tc.department_id = ne.department_id and tc.is_active
where ne.kind = 'required_certification_expired'
  and ne.last_seen_at >= '2026-09-29'
  and tc.expiration_date >= current_date;
\echo '-- Q3: emails queued/sent for those alerts (the false-"Expired" emails)'
select q.status, count(*), min(q.created_at), max(q.created_at), max(q.sent_at)
from public.notification_email_queue q
join public.notification_events ne
  on ne.department_id = q.department_id and ne.user_id = q.user_id and ne.notification_key = q.notification_key
where ne.kind in ('required_certification_expired','qualification_no_record',
                  'qualification_missing_day','qualification_missing_night')
  and q.created_at >= '2026-09-29'
group by 1;
\echo '-- Q3b: any email ever sent post-cutover at all?'
select status, count(*), max(sent_at) from public.notification_email_queue
where created_at >= '2026-09-29' group by 1;
\echo '-- Q4: false qualification-missing alerts where stored results exist'
select count(distinct ne.user_id)
from public.notification_events ne
where ne.kind in ('qualification_no_record','qualification_missing_day','qualification_missing_night')
  and ne.last_seen_at >= '2026-09-29' and ne.resolved_at is null
  and exists (select 1 from public.qualification_results qr
              where qr.department_id = ne.department_id and qr.officer_user_id = ne.user_id
                and qr.passed is true and qr.qualification_date >= current_date - 365);
\echo '-- Q5: equipment hidden as "current" and 500-trigger candidates'
select ea.department_id,
  count(*) filter (where ea.expiration_date < current_date)        as truly_expired_shown_current,
  count(*) filter (where ea.next_inspection_date < current_date)   as truly_overdue_shown_current,
  count(*) filter (where ea.expiration_date is null and ea.issue_date is not null
                     and et.default_valid_days is not null)        as derive_expiration_500_risk,
  count(*) filter (where ea.next_inspection_date is null and ea.last_inspection_date is not null
                     and et.default_inspection_interval_days is not null) as derive_inspection_500_risk
from public.equipment_assets ea
join public.equipment_types et on et.id = ea.equipment_type_id
where ea.lifecycle_status <> 'removed'
group by 1;
\echo '-- Q6: off-duty requests that now show Non-Compliant / cannot be approved'
select r.department_id, r.request_status, count(*)
from public.off_duty_firearm_requests r
where exists (select 1 from public.off_duty_firearm_inspections i
              where i.request_id = r.id and i.result = 'Pass')
group by 1,2;
\echo '-- Q7: personal rifle expiry alerts suppressed'
select department_id, count(*) from public.personal_rifles
where status = 'Approved' and expiration_date between current_date and current_date + 60
group by 1;
\echo '-- Q8: duplicate certifications created since cutover (import dedupe failure)'
select department_id, user_id, certification_type_id, issue_date, expiration_date, count(*)
from public.training_certifications
where is_active and created_at >= '2026-09-29'
group by 1,2,3,4,5 having count(*) > 1;
\echo '-- Q9: fleet vehicles with due dates in window'
select department_id, count(*) from public.fleet_vehicles
where status <> 'Retired'
  and least(coalesce(next_service_date,'infinity'), coalesce(inspection_due_date,'infinity'),
            coalesce(registration_expiration_date,'infinity')) <= current_date + 30
group by 1;
rollback;

begin transaction read only;
\echo '-- G4d B10: run scripts/qualification-status-snapshot.sql + scripts/qualification-status-diff.mjs separately (README step 4).'
\echo '--      This aggregate shows how many workspace results the RNG-24 / RNG-09 rules touch. Close out completed days first.'
select w.department_id,
  count(r.value) as workspace_results,
  count(r.value) filter (where lower(coalesce(day.value ->> 'status', '')) not in ('completed', 'locked', 'archived')) as results_on_days_not_closed,
  count(r.value) filter (where lower(coalesce(drill.value ->> 'firearmType', '')) = 'any') as results_on_any_drills
from public.pilot_range_workspaces w
cross join lateral jsonb_array_elements(case when jsonb_typeof(w.workspace -> 'results') = 'array' then w.workspace -> 'results' else '[]'::jsonb end) r
left join lateral (select d.value from jsonb_array_elements(case when jsonb_typeof(w.workspace -> 'rangeDays') = 'array' then w.workspace -> 'rangeDays' else '[]'::jsonb end) d
  where d.value ->> 'id' = r.value ->> 'rangeDayId' limit 1) day on true
left join lateral (select d.value from jsonb_array_elements(case when jsonb_typeof(w.workspace -> 'rangeDayDrills') = 'array' then w.workspace -> 'rangeDayDrills' else '[]'::jsonb end) d
  where d.value ->> 'id' = r.value ->> 'drillId' limit 1) drill on true
group by 1 order by 1;
select w.department_id, coalesce(d.value ->> 'status', '(none)') as range_day_status, count(*) as range_days
from public.pilot_range_workspaces w
cross join lateral jsonb_array_elements(case when jsonb_typeof(w.workspace -> 'rangeDays') = 'array' then w.workspace -> 'rangeDays' else '[]'::jsonb end) d
group by 1, 2 order by 1, 2;
\echo '-- G4e B7 TRN-02 upcoming-event drift review (B7 record, verbatim; contains event titles: coordinator review only)'
select d.name, d.timezone, e.title, e.starts_at, e.starts_at at time zone d.timezone as local_start from agency_training_events e join departments d on d.id = e.department_id where e.starts_at > now() and e.status in ('draft','scheduled','in_progress') order by 1, 4;
\echo '-- G4e.2 B8 ARM-23: draft reconciliations whose stored expected quantity differs from the lot on hand (re-saving does not refresh them)'
select r.department_id, r.id as reconciliation_id, count(*) as items_with_stale_expected
from public.ammunition_reconciliations r
join public.ammunition_reconciliation_items i on i.reconciliation_id = r.id
join public.ammunition_lots l on l.id = i.lot_id
where r.status = 'Draft' and i.expected_quantity is distinct from l.quantity_on_hand
group by 1, 2 order by 1, 2;
rollback;

begin transaction read only;
\echo '-- G4f DC2 R0: session settings the parser relies on. GO: TimeZone UTC, DateStyle ISO, MDY, IntervalStyle postgres, and no'
\echo '--      role/database override for tracepoint_runtime that changes them (pg_db_role_setting rows below).'
select current_setting('TimeZone') as timezone, current_setting('DateStyle') as datestyle, current_setting('IntervalStyle') as intervalstyle;
select name, setting, source from pg_settings where name in ('TimeZone', 'DateStyle', 'IntervalStyle') order by name;
select coalesce(r.rolname, '(all roles)') as role, coalesce(d.datname, '(all databases)') as database, s.setconfig
from pg_db_role_setting s left join pg_roles r on r.oid = s.setrole left join pg_database d on d.oid = s.setdatabase
order by 1, 2;
\echo '-- G4f DC2 R1-R6 impact queries (DC2 record, verbatim)'
\echo '-- R1: agencies whose dashboard upcoming/attention training lists are empty but should not be'
select department_id, count(*) filter (where starts_at between now() and now() + interval '30 days') as upcoming_30d,
       count(*) filter (where starts_at between now() and now() + interval '7 days'
                          and not exists (select 1 from public.agency_training_attendees a where a.event_id = e.id)) as unstaffed_7d
from public.agency_training_events e where status = 'scheduled' group by 1 having count(*) filter (where starts_at between now() and now() + interval '30 days') > 0;
\echo '-- R2: audit rows rendered without a time since cutover, and likely duplicate pairs'
select department_id, count(*) from public.audit_events where created_at >= '2026-09-29' group by 1;
select count(*) from public.audit_events e join public.audit_log l
  on l.department_id = e.department_id and l.entity_id::text = e.entity_id::text and abs(extract(epoch from l.created_at - e.created_at)) <= 2
 where e.created_at >= '2026-09-29' and e.action in ('insert','update','delete');
\echo '-- R3: range workspaces that cannot be saved (microsecond updated_at)'
select department_id, updated_at from public.pilot_range_workspaces where extract(microseconds from updated_at)::bigint % 1000 <> 0;
\echo '-- R4: equipment items whose custody history is long enough to be mis-ordered'
select department_id, count(distinct equipment_asset_id) from public.equipment_asset_assignments
 group by 1 having count(*) > 1;
\echo '-- R5: firearm condition alerts stored without a time'
select department_id, count(*) from public.notification_events
 where kind in ('firearm_out_of_service','firearm_maintenance','firearm_inspection_required') and source_created_at is null and resolved_at is null group by 1;
\echo '-- R6: interval values exposed as objects'
select count(*) from public.firearm_possession_restrictions where maximum_custody_duration is not null;
rollback;

begin transaction read only;
\echo '-- G4g notification_email_queue by status (record before AND after; the dispatcher stays off). Pending rows by kind:'
select department_id, status, count(*) as rows, min(created_at) as oldest, max(created_at) as newest
from public.notification_email_queue group by 1, 2 order by 1, 2;
select q.department_id, coalesce(ne.kind, '(no matching event)') as kind, count(*) as pending_rows
from public.notification_email_queue q
left join public.notification_events ne
  on ne.department_id = q.department_id and ne.user_id = q.user_id and ne.notification_key = q.notification_key
where q.status = 'Pending'
group by 1, 2 order by 1, 2;
rollback;

\echo '==== G5 snapshot: not a SQL check. Take the manual RDS snapshot tracepoint-staging-pre-integration-<date> and record its ARN once'
\echo '     it is "available", AFTER this kit and BEFORE migrate-db.ps1 -Action apply (STAGING-VERIFICATION.md S1.2).'

\echo '==== AFTER apply (also safe before: every check reads the catalog or uses to_jsonb, so it runs at 037 too) ===='
begin transaction read only;
\echo '-- A.1 046 baseline audit rows (must equal the G4a baseline_cleared total recorded before apply) and vehicles marked cleared'
select (select count(*) from public.audit_events where details ? 'baseline' and action = 'fleet_safety_hold_cleared') as baseline_audit_rows,
  (select count(*) from public.fleet_vehicles v where to_jsonb(v) ->> 'safety_hold_cleared_at' is not null) as vehicles_with_clearance;
\echo '-- A.2 functions and triggers created by 039-053 (before apply: false/0; after: all true and the counts shown)'
select f.name, to_regprocedure(f.name) is not null as present
from (values
  ('tracepoint_auth.activate_cognito_identity_on_first_login(text,text,uuid)'),
  ('public.guard_fleet_field_vehicle_update()'), ('public.guard_fleet_field_equipment_update()'),
  ('public.operate_equipment_self_custody(uuid,uuid,text,text,text)'),
  ('public.enqueue_fleet_inspection_audit()'), ('public.fleet_audit_outbox_deliver_internal(uuid,uuid)'),
  ('public.deliver_fleet_audit_outbox(uuid,jsonb)'), ('public.deliver_pending_fleet_audit(uuid)'),
  ('public.can_submit_fleet_inspection(uuid)'), ('public.guard_fleet_safety_hold_clearance()'),
  ('public.range_workspace_scorer_roster_change_allowed(jsonb,jsonb)'),
  ('public.guard_off_duty_request_self_decision()'), ('public.guard_personal_rifle_self_review()'),
  ('public.record_personal_rifle_status_history()'), ('public.guard_ammunition_reconciliation_certifier()'),
  ('public.change_firearm_status(uuid,uuid,text,text,text)'), ('public.armory_member_identities(uuid,uuid[])')
) f(name) order by 2, 1;
select t.tgrelid::regclass::text as table_name, t.tgname, not t.tgenabled = 'D' as enabled
from pg_trigger t
where not t.tgisinternal and t.tgname in ('fleet_vehicles_field_update_guard', 'fleet_vehicle_equipment_field_update_guard',
  'fleet_vehicle_inspections_audit_outbox', 'fleet_vehicles_safety_hold_clearance_guard',
  'off_duty_requests_self_decision_guard', 'personal_rifles_self_review_guard', 'ammunition_reconciliations_certifier_guard',
  'personal_rifles_status_history', 'personal_rifles_status_history_created')
order by 1, 2;
\echo '-- A.3 B8/B8a: 3 B8 guard triggers + 2 history triggers above. After apply at 70717ba: rifle_history_insert false, firearm_history_insert'
\echo '--      true (037 grant kept), rifle_history_update_or_delete false, firearm_history_update_or_delete true, workflow_note null at rest (0)'
select has_table_privilege('authenticated', 'public.personal_rifle_status_history', 'insert') as rifle_history_insert,
  has_table_privilege('authenticated', 'public.firearm_status_history', 'insert') as firearm_history_insert,
  has_table_privilege('authenticated', 'public.personal_rifle_status_history', 'update,delete') as rifle_history_update_or_delete,
  has_table_privilege('authenticated', 'public.firearm_status_history', 'update,delete') as firearm_history_update_or_delete,
  (select count(*) from public.personal_rifles r where to_jsonb(r) ->> 'workflow_note' is not null) as workflow_note_not_null;
\echo '-- A.4 B10 (051): trigger body admits instructor attendance (after: true)'
select coalesce(pg_get_functiondef(to_regprocedure('public.protect_pilot_range_workspace_mutation()')) like '%range_workspace_scorer_roster_change_allowed%', false) as b10_trigger_updated;
\echo '-- A.5 039: create_department_with_owner no longer executable by authenticated (after: false); 038 lifecycle includes out_of_service'
select has_function_privilege('authenticated', 'public.create_department_with_owner(text,text,text,text,text,text)', 'execute') as authenticated_can_create_department,
  coalesce((select pg_get_constraintdef(oid) like '%out_of_service%' from pg_constraint
    where conname = 'equipment_assets_lifecycle_status_check' and conrelid = to_regclass('public.equipment_assets')), false) as lifecycle_allows_out_of_service;
\echo '-- A.6 new columns (after: all true)'
select c.name, exists (select 1 from information_schema.columns ic where ic.table_schema = 'public'
  and ic.table_name = split_part(c.name, '.', 1) and ic.column_name = split_part(c.name, '.', 2)) as present
from (values ('fleet_vehicles.safety_hold_cleared_at'), ('fleet_vehicles.safety_hold_cleared_by'), ('fleet_vehicles.safety_hold_clearance_reason'),
  ('fleet_audit_outbox.work_order_id'), ('fleet_audit_outbox.delivered_by_existing_audit'), ('training_certifications.superseded_by_training_event_id'), ('personal_rifles.workflow_note')) c(name)
order by 1;
rollback;
\echo '==== end of kit ===='
