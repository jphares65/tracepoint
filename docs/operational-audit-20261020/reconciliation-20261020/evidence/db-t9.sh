. /tmp/claude-0/-home-user/37d8642d-fcb5-5f5b-86e8-f46de44d221c/scratchpad/verify-db/ctx.sh
INV=70000000-0000-4000-8000-000000000001; OP=60000000-0000-4000-8000-000000000001; SUB=50000000-0000-4000-8000-000000000001
ISS=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TESTPOOL
echo "-- T9 step 1: dept admin A prepares invite (withPostgresAuthorization context, 13-arg overload as in cognito-invite.ts)"
tx $ADMA $DA "" "select tracepoint_auth.prepare_cognito_invite('$INV','$OP','$SUB','$DA','invitee@example.test','Invited Officer','B-77',null,null,null,array['officer']::text[],array[]::uuid[],true);" | RT 2>&1
echo "-- T9 step 2: pool-level (session_user=tracepoint_runtime, no role switch) confirm + commit + finish(sent=true)"
RT -c "begin" -c "select tracepoint_auth.confirm_cognito_provider_username('$OP','$SUB','$SUB','$SUB')" -c "select tracepoint_auth.commit_cognito_invite('$OP','$SUB','$ISS')" -c "commit" -c "select tracepoint_auth.finish_cognito_invite('$OP',true,null)" 2>&1
echo "-- T9 step 3: lifecycle state of invited user"
SU -c "select provider,issuer,subject,tracepoint_user_id,state,provider_username from authentication_identity_links where tracepoint_user_id='$INV'" -c "select department_id,is_active,activation_status from department_memberships where user_id='$INV'" -c "select operation_kind,state from authentication_lifecycle_operations where id='$OP'" 2>&1
echo "-- T9 step 4: PostgresIdentityMappingStore.findActive (exact SQL from postgres-mapping.ts) as tracepoint_runtime pool"
RT -c "select tracepoint_user_id from public.authentication_identity_links where provider='cognito' and issuer='$ISS' and subject='$SUB' and state='active'" 2>&1
echo "-- T9 step 5: PostgresCognitoSessionStore.registerVerified mapping lock (postgres-sessions.ts)"
RT -c "begin" -c "select 1 from public.authentication_identity_links where provider='cognito' and issuer='$ISS' and subject='$SUB' and tracepoint_user_id='$INV' and state='active' for update" -c "rollback" 2>&1
echo "-- T9 step 6: same query without the state filter (shows the row exists but is pending)"
RT -c "select tracepoint_user_id, state from public.authentication_identity_links where provider='cognito' and issuer='$ISS' and subject='$SUB'" 2>&1
echo "-- T9 step 7: which DB functions can move cognito link pending->active?"
SU -At -c "select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','tracepoint_auth') and pg_get_functiondef(p.oid) ~* 'set\s+state\s*=\s*''active''' order by 1" 2>&1
