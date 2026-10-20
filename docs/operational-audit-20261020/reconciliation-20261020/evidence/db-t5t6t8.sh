. /tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/verify-db/ctx.sh
FB=f1000000-0000-4000-8000-00000000000b
echo "-- T5 ADM-03: no-membership user, beginSubject-style context (subject only), calls create_department_with_owner"
{ echo "begin; set local role authenticated; select set_config('tracepoint.subject_id','$NM',true) is not null;";
  echo "select exists(select 1 from public.department_memberships where user_id='$NM') as had_membership_before;";
  echo "select public.create_department_with_owner('Rogue Agency','rogue-agency','RA') as new_department_id;";
  echo "select d.name, m.is_active, r.role_code, public.has_department_permission(d.id,'administer_department') admin_perm from public.departments d join public.department_memberships m on m.department_id=d.id join public.department_membership_roles r on r.department_id=d.id and r.user_id=m.user_id where d.slug='rogue-agency';";
  echo "commit;"; } | RT 2>&1
echo "-- T5b: grants on create_department_with_owner"
SU -c "select p.oid::regprocedure, p.proacl from pg_proc p where proname='create_department_with_owner'" 2>&1
echo "-- T6 ARM-04: Dept A admin -> update_firearm_with_audit on Dept B firearm"
echo "-- T6a: p_department_id = Dept B (context Dept A)"
tx $ADMA $DA "" "select public.update_firearm_with_audit('$FB','$DB','$ADMA','x','Hacked','17','B-SN-1','handgun','9mm',null,null);" | RT 2>&1
echo "-- T6b: p_department_id = Dept A (own), firearm id from Dept B"
tx $ADMA $DA "" "select public.update_firearm_with_audit('$FB','$DA','$ADMA','x','Hacked','17','B-SN-1','handgun','9mm',null,null);" | RT 2>&1
echo "-- T6c: forged tracepoint.department_id = Dept B, p_department_id = Dept B"
tx $ADMA $DB "" "select public.update_firearm_with_audit('$FB','$DB','$ADMA','x','Hacked','17','B-SN-1','handgun','9mm',null,null);" | RT 2>&1
echo "-- T6d: p_user_id spoofed as Dept B admin"
tx $ADMA $DB "" "select public.update_firearm_with_audit('$FB','$DB','$ADMB','x','Hacked','17','B-SN-1','handgun','9mm',null,null);" | RT 2>&1
echo "-- T6e: internal function directly callable?"
SU -c "select p.oid::regprocedure, p.proacl from pg_proc p where proname like 'update_firearm_with_audit%'" 2>&1
tx $ADMA $DA "" "select public.update_firearm_with_audit_internal('$FB','$DB','$ADMA','x','Hacked','17','B-SN-1','handgun','9mm',null,null);" | RT 2>&1
echo "-- T6 control: Dept B admin legit update"
tx $ADMB $DB "" "select public.update_firearm_with_audit('$FB','$DB','$ADMB','legit','Glock','17','B-SN-1','handgun','9mm',null,null) is not null as ok;" | RT 2>&1
SU -c "select id,department_id,make from firearms" 2>&1
echo "-- T8 TRN-26: plain officer A1 reads other officers' training rows"
tx $OFF $DA "" "select user_id, certification_title from public.training_certifications t where t.department_id='$DA' order by 2; select officer_user_id, score, passed from public.qualification_results t where t.department_id='$DA' order by 2; select a.user_id, e.title from public.agency_training_attendees a join public.agency_training_events e on e.id=a.event_id where a.department_id='$DA';" | RT 2>&1
echo "-- T8 cross-tenant control: Dept B officer reads Dept A rows"
tx b0000000-0000-4000-8000-0000000000c1 $DB "" "select count(*) dept_a_certs_visible_to_b from public.training_certifications t where t.department_id='$DA'; select count(*) dept_a_quals_visible_to_b from public.qualification_results t where t.department_id='$DA';" | RT 2>&1
