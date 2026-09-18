import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

const project='wztqqqashilusoppddxi';
const sql=String.raw`begin;
drop function if exists public.mobile_cognito_resolve_identity(text,uuid);
drop function if exists public.mobile_cognito_register_access_session(text,uuid,uuid,uuid,timestamptz,timestamptz);
drop function if exists public.mobile_cognito_revoke_access_session(text,uuid,uuid,uuid);
create or replace function public.mobile_cognito_require_service_role() returns void language plpgsql stable security definer set search_path=public as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
end; $$;
create or replace function public.mobile_cognito_resolve_identity(p_issuer text,p_subject text) returns table(tracepoint_user_id uuid) language plpgsql stable security definer set search_path=public as $$
begin
  perform public.mobile_cognito_require_service_role();
  return query select l.tracepoint_user_id from public.authentication_identity_links l where l.provider='cognito' and l.issuer=p_issuer and l.subject=p_subject and l.state='active';
end; $$;
create or replace function public.mobile_cognito_register_access_session(p_issuer text,p_subject text,p_user_id uuid,p_token_id uuid,p_issued_at timestamptz,p_expires_at timestamptz) returns boolean language plpgsql security definer set search_path=public as $$
declare existing public.authentication_access_sessions%rowtype;
begin
  perform public.mobile_cognito_require_service_role();
  if p_issued_at > clock_timestamp()+interval '30 seconds' or p_expires_at <= clock_timestamp() or p_expires_at <= p_issued_at or p_expires_at-p_issued_at > interval '15 minutes' then return false; end if;
  perform 1 from public.authentication_identity_links l where l.provider='cognito' and l.issuer=p_issuer and l.subject=p_subject and l.tracepoint_user_id=p_user_id and l.state='active' for update;
  if not found or exists(select 1 from public.authentication_session_revocations r where r.tracepoint_user_id=p_user_id and r.issuer=p_issuer and r.revoked_before>=p_issued_at) then return false; end if;
  select * into existing from public.authentication_access_sessions s where s.issuer=p_issuer and s.token_id=p_token_id;
  if found then return existing.revoked_at is null and existing.subject=p_subject and existing.tracepoint_user_id=p_user_id and existing.issued_at=p_issued_at and existing.expires_at=p_expires_at; end if;
  insert into public.authentication_access_sessions(provider,issuer,subject,tracepoint_user_id,token_id,issued_at,expires_at) values('cognito',p_issuer,p_subject,p_user_id,p_token_id,p_issued_at,p_expires_at) on conflict do nothing;
  select * into existing from public.authentication_access_sessions s where s.issuer=p_issuer and s.token_id=p_token_id;
  return found and existing.revoked_at is null and existing.subject=p_subject and existing.tracepoint_user_id=p_user_id and existing.issued_at=p_issued_at and existing.expires_at=p_expires_at;
end; $$;
create or replace function public.mobile_cognito_revoke_access_session(p_issuer text,p_subject text,p_user_id uuid,p_token_id uuid) returns boolean language plpgsql security definer set search_path=public as $$
begin
  perform public.mobile_cognito_require_service_role();
  update public.authentication_access_sessions set revoked_at=coalesce(revoked_at,clock_timestamp()) where issuer=p_issuer and subject=p_subject and tracepoint_user_id=p_user_id and token_id=p_token_id;
  return found;
end; $$;
revoke all on function public.mobile_cognito_require_service_role() from public;
revoke execute on function public.mobile_cognito_resolve_identity(text,text),public.mobile_cognito_register_access_session(text,text,uuid,uuid,timestamptz,timestamptz),public.mobile_cognito_revoke_access_session(text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.mobile_cognito_resolve_identity(text,text),public.mobile_cognito_register_access_session(text,text,uuid,uuid,timestamptz,timestamptz),public.mobile_cognito_revoke_access_session(text,text,uuid,uuid) to service_role;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;`;
let file;
function aws(args){return JSON.parse(execFileSync('aws.exe',[...args,'--region','us-east-1','--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}
try{
 assert.ok(process.argv.includes('--execute'),'Explicit staging-only execution required');
 const identity=aws(['sts','get-caller-identity']);assert.equal(identity.Account,'559054714699');assert.match(identity.Arn,/TracePointMigrationStaging/);
 file=path.join(mkdtempSync(path.join(tmpdir(),'tracepoint-mobile-cognito-rpc-')),'rpc.sql');writeFileSync(file,sql);
 const command="& npx.cmd supabase db query --linked --project-ref "+project+" --file '"+file.replaceAll("'","''")+"' --output json; exit $LASTEXITCODE";
 execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{stdio:['ignore','pipe','pipe'],encoding:'utf8'});
 console.log(JSON.stringify({project,stagingOnly:true,serviceRoleGuardedRpc:true}));
}catch{console.error('Staging mobile Cognito RPC gate failed; values suppressed.');process.exitCode=1;}
finally{if(file){unlinkSync(file);rmdirSync(path.dirname(file));}}
