. /tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/verify-db/ctx.sh
E1=ea000000-0000-4000-8000-000000000001; E2=ea000000-0000-4000-8000-000000000002
F="id,manufacturer,model,serial_number,asset_number,lifecycle_status,assigned_user_id,assigned_vehicle_id,assigned_location"
echo "-- control: T2 dept-admin audit_events insert (expected to pass)"
tx $ADMA $DA "" "insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,details) values ('$DA','$ADMA','fleet_vehicle_inspected','fleet_vehicle','$VEH','{\"support_mode\":false}'::jsonb);" | RT 2>&1
echo "-- setup: equipment manager (armorer + dept-granted manage_equipment) assigns EQ-2 to officer via app-equivalent update"
tx $EQM $DA "" "update public.equipment_assets t set assigned_user_id='$OFF',updated_by='$EQM' where t.department_id='$DA' and t.id='$E2' returning id,assigned_user_id;" | RT 2>&1
echo "-- T3a officer CHECK-OUT of unassigned EQ-1: step 1 select existing"
tx $OFF $DA "" "select $F from public.equipment_assets t where t.department_id='$DA' and t.id='$E1';" | RT 2>&1
echo "-- T3a step 2 (would only run if visible): conditional update"
tx $OFF $DA "" "update public.equipment_assets t set assigned_user_id='$OFF',updated_by='$OFF' where t.department_id='$DA' and t.id='$E1' and t.lifecycle_status='active' and t.assigned_user_id is null and t.assigned_vehicle_id is null and t.assigned_location is null returning $F;" | RT 2>&1
echo "-- T3b officer CHECK-IN of EQ-2 (assigned to officer), condition serviceable"
tx $OFF $DA "" "select $F from public.equipment_assets t where t.department_id='$DA' and t.id='$E2';" | RT 2>&1
tx $OFF $DA "" "update public.equipment_assets t set assigned_user_id=null,lifecycle_status='active',updated_by='$OFF' where t.department_id='$DA' and t.id='$E2' and t.assigned_user_id='$OFF' returning $F;" | RT 2>&1
echo "-- T3c officer CHECK-IN of EQ-2 with condition=damaged -> lifecycle_status='out_of_service'"
tx $OFF $DA "" "update public.equipment_assets t set assigned_user_id=null,lifecycle_status='out_of_service',updated_by='$OFF' where t.department_id='$DA' and t.id='$E2' and t.assigned_user_id='$OFF' returning $F;" | RT 2>&1
echo "-- T3d annotateAssignment"
tx $OFF $DA "" "update public.equipment_asset_assignments t set return_notes='[condition=serviceable]' where t.department_id='$DA' and t.equipment_asset_id='$E2';" | RT 2>&1
tx $OFF $DA "" "select id,assigned_user_id,returned_at from public.equipment_asset_assignments t where t.department_id='$DA' and t.equipment_asset_id='$E2';" | RT 2>&1
echo "-- post-state"
SU -c "select id,lifecycle_status,assigned_user_id from equipment_assets order by id" 2>&1
