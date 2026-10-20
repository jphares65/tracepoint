. /tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/verify-db/ctx.sh
U=$1
{
echo "-- ===== actor $U ====="
tx $U $DA "" "select id,unit_number,current_mileage,current_hours from public.fleet_vehicles t where t.department_id='$DA' and t.id='$VEH';"
tx $U $DA "" "select inspection_role_codes, inspection_defect_creates_work_order, inspection_critical_out_of_service, inspection_include_required_equipment from public.fleet_rules t where t.department_id='$DA';"
tx $U $DA "" "select id,category,name,status,is_required,is_critical from public.fleet_vehicle_equipment t where t.department_id='$DA' and t.vehicle_id='$VEH';"
echo "-- step 4: insert inspection (route: .insert(record).select('*').single())"
tx $U $DA "" "insert into public.fleet_vehicle_inspections(department_id,vehicle_id,inspection_type,result,mileage,hours,checklist,defect_count,critical_defect_count,notes,inspector_user_id) values ('$DA','$VEH','Pre-Shift','Failed',1200,0,'[{\"id\":\"equipment:$VEQ\",\"condition\":\"Critical\",\"note\":\"AED missing pads\"}]'::jsonb,1,1,null,'$U') returning id,result,inspector_user_id;"
echo "-- step 5: update fleet_vehicle_equipment status (route: no .select(), error ignored)"
tx $U $DA "" "update public.fleet_vehicle_equipment t set status='Out of Service',updated_by_user_id='$U',updated_at=now() where t.department_id='$DA' and t.vehicle_id='$VEH' and t.id='$VEQ';"
echo "-- step 6: insert work order (route: .insert().select('*').single(); error ignored, workOrder=null)"
tx $U $DA "" "insert into public.fleet_work_orders(department_id,vehicle_id,record_type,title,description,priority,status,affects_availability,assigned_role_code,mileage,hours,created_by_user_id,updated_by_user_id) values ('$DA','$VEH','Inspection','Pre-Shift inspection defects','Safety: AED: AED missing pads','Critical','Open',true,'mechanic',1200,0,'$U','$U') returning id;"
echo "-- step 7: update fleet_vehicles mileage/hours/inspection_due_date (route: error ignored)"
tx $U $DA "" "update public.fleet_vehicles t set current_mileage=1200,current_hours=0,inspection_due_date=current_date+1,updated_by_user_id='$U',updated_at=now() where t.department_id='$DA' and t.id='$VEH';"
echo "-- step 8: auditFleet -> insert audit_events (route: throws 'Audit record failed' on error -> 500)"
tx $U $DA "" "insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,details) values ('$DA','$U','fleet_vehicle_inspected','fleet_vehicle','$VEH','{\"support_mode\":false}'::jsonb);"
echo "-- step 9: refreshFleetVehicle update status (only reached if audit succeeded)"
tx $U $DA "" "update public.fleet_vehicles t set status='Out of Service',open_issue_count=1,updated_at=now() where t.department_id='$DA' and t.id='$VEH';"
} | RT 2>&1
echo "-- ===== post-state (superuser view) ====="
SU -c "select count(*) inspections from fleet_vehicle_inspections" -c "select count(*) work_orders from fleet_work_orders" -c "select status,current_mileage,inspection_due_date,open_issue_count from fleet_vehicles where id='$VEH'" -c "select status from fleet_vehicle_equipment where id='$VEQ'" -c "select action,actor_user_id from audit_events where action='fleet_vehicle_inspected'" 2>&1
