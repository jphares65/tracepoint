begin;

-- A password operation holds Cognito password scope until it commits or
-- carries an explicit provider_unchanged resolution. A failure state alone
-- is never evidence that Cognito was unchanged; operations with an uncertain
-- provider outcome stay blocked until they are investigated and resolved.
create table public.authentication_lifecycle_resolutions (
  operation_id uuid primary key references public.authentication_lifecycle_operations(id) on delete restrict,
  resolution text not null check (resolution = 'provider_unchanged'),
  resolution_source text not null check (resolution_source in ('application_pre_write_refusal','owner_verified')),
  basis text not null check (length(btrim(basis)) between 20 and 1000),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  resolved_by text not null default session_user,
  resolved_at timestamptz not null default clock_timestamp()
);
alter table public.authentication_lifecycle_resolutions enable row level security;
revoke all on table public.authentication_lifecycle_resolutions
  from public,anon,authenticated,service_role,tracepoint_runtime;

create function tracepoint_auth.reject_lifecycle_resolution_change()
returns trigger
language plpgsql
set search_path=pg_catalog
as $$
begin
  raise exception 'authentication lifecycle resolutions are append-only'
    using errcode='42501';
end;
$$;
revoke all on function tracepoint_auth.reject_lifecycle_resolution_change()
  from public,anon,authenticated,service_role,tracepoint_runtime;

create trigger authentication_lifecycle_resolutions_append_only
before update or delete on public.authentication_lifecycle_resolutions
for each row
execute function tracepoint_auth.reject_lifecycle_resolution_change();

create trigger authentication_lifecycle_resolutions_no_truncate
before truncate on public.authentication_lifecycle_resolutions
for each statement
execute function tracepoint_auth.reject_lifecycle_resolution_change();

-- Every resolution, by whatever path it is written, records its audit entry
-- in the same transaction. A failed audit insert undoes the resolution.
create function tracepoint_auth.audit_lifecycle_resolution()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_op public.authentication_lifecycle_operations%rowtype;
begin
  select * into v_op from public.authentication_lifecycle_operations where id=new.operation_id;
  insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,summary,previous_value,new_value)
    values (v_op.department_id,null,'password_operation_resolved','authentication_lifecycle_operation',v_op.id,
      'A failed password operation was resolved after Cognito was confirmed unchanged.',
      jsonb_build_object('operation_kind',v_op.operation_kind,'state',v_op.state,'safe_error_code',v_op.safe_error_code,'attempts',v_op.attempts),
      jsonb_build_object('resolution',new.resolution,'source',new.resolution_source,'basis',new.basis,'evidence',new.evidence,'resolved_by',new.resolved_by));
  return null;
end;
$$;
revoke all on function tracepoint_auth.audit_lifecycle_resolution()
  from public,anon,authenticated,service_role,tracepoint_runtime;

create trigger authentication_lifecycle_resolutions_audit
after insert on public.authentication_lifecycle_resolutions
for each row
execute function tracepoint_auth.audit_lifecycle_resolution();

-- The single scope predicate shared by every 039 guard that considers
-- unfinished password operations.
create function tracepoint_auth.password_scope_hold_exists(
  p_user_id uuid,
  p_except_department_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=pg_catalog,public
as $$
  select exists (
    select 1
    from public.authentication_lifecycle_operations operation
    where operation.tracepoint_user_id = p_user_id
      and operation.operation_kind in ('assign_password','reset_password')
      and operation.state <> 'committed'
      and (p_except_department_id is null or operation.department_id is distinct from p_except_department_id)
      and not exists (
        select 1
        from public.authentication_lifecycle_resolutions resolution
        where resolution.operation_id = operation.id
          and resolution.resolution = 'provider_unchanged'
      )
  )
$$;
revoke all on function tracepoint_auth.password_scope_hold_exists(uuid,uuid)
  from public,anon,authenticated,service_role,tracepoint_runtime;

create or replace function tracepoint_auth.guard_cognito_scope_membership_write()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,tracepoint_auth
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  if tracepoint_auth.password_scope_hold_exists(new.user_id, new.department_id) then
    raise exception 'membership scope change conflicts with an unresolved password operation'
      using errcode='42501';
  end if;

  return new;
end;
$$;

create or replace function tracepoint_auth.guard_cognito_scope_platform_admin_write()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,tracepoint_auth
as $$
begin
  if new.is_active then
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

    if tracepoint_auth.password_scope_hold_exists(new.user_id, null) then
      raise exception 'platform administrator scope change conflicts with an unresolved password operation'
        using errcode='42501';
    end if;
  end if;

  return new;
end;
$$;

-- Owner-verified resolutions accept only the reset refusals that the
-- application raises before any Cognito write, and require explicit evidence.
-- The application path accepts only an operation its finish call has just
-- marked failed before any Cognito write was attempted.
create function tracepoint_auth.resolve_password_operation_provider_unchanged(
  p_operation_id uuid,
  p_source text,
  p_basis text,
  p_evidence jsonb
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare v_op public.authentication_lifecycle_operations%rowtype;
begin
  select * into v_op from public.authentication_lifecycle_operations
    where id=p_operation_id for update;
  if not found or v_op.operation_kind not in ('assign_password','reset_password') then
    raise exception 'password operation unavailable for resolution' using errcode='P0002';
  end if;
  if p_source = 'owner_verified' then
    if session_user = 'tracepoint_runtime' then
      raise exception 'owner verification is not available to the application' using errcode='42501';
    end if;
    if v_op.operation_kind <> 'reset_password' or v_op.state <> 'compensation_required'
       or coalesce(v_op.safe_error_code, '') not in ('initial_password_required','recovery_unavailable') then
      raise exception 'password operation is not a verified pre-write refusal' using errcode='22023';
    end if;
    if jsonb_typeof(p_evidence) is distinct from 'object'
       or p_evidence->>'cognito_writes_by_operation' is distinct from 'none'
       or coalesce(btrim(p_evidence->>'cloudtrail_window'), '') = ''
       or coalesce(btrim(p_evidence->>'code_path'), '') = '' then
      raise exception 'provider evidence is incomplete' using errcode='22023';
    end if;
  elsif p_source = 'application_pre_write_refusal' then
    if session_user <> 'tracepoint_runtime' or v_op.state <> 'failed' then
      raise exception 'application resolution requires a failed pre-write operation' using errcode='42501';
    end if;
  else
    raise exception 'unknown resolution source' using errcode='22023';
  end if;

  insert into public.authentication_lifecycle_resolutions(operation_id,resolution,resolution_source,basis,evidence)
    values (v_op.id,'provider_unchanged',p_source,p_basis,p_evidence);
end;
$$;
revoke all on function tracepoint_auth.resolve_password_operation_provider_unchanged(uuid,text,text,jsonb)
  from public,anon,authenticated,service_role,tracepoint_runtime;

-- Callers that pass three arguments keep their behavior through the default.
-- Only a failure the application reports as occurring before any Cognito
-- write becomes a terminal, resolved failure.
drop function tracepoint_auth.finish_cognito_password_operation(uuid,boolean,text);
create function tracepoint_auth.finish_cognito_password_operation(
  p_operation_id uuid,p_succeeded boolean,p_error_code text default null,p_provider_unchanged boolean default false
) returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_op public.authentication_lifecycle_operations%rowtype; v_email text;
begin
  if session_user<>'tracepoint_runtime' then raise exception 'password operation finish rejected' using errcode='42501'; end if;
  select * into v_op from public.authentication_lifecycle_operations where id=p_operation_id and operation_kind in ('assign_password','reset_password') for update;
  if not found then raise exception 'password operation unavailable' using errcode='P0002'; end if;
  if not p_succeeded then
    if p_provider_unchanged then
      if v_op.state<>'prepared' then raise exception 'password operation is not awaiting completion' using errcode='22023'; end if;
      update public.authentication_lifecycle_operations set state='failed',attempts=attempts+1,safe_error_code=left(coalesce(p_error_code,'provider_unavailable'),80),updated_at=now() where id=v_op.id;
      perform tracepoint_auth.resolve_password_operation_provider_unchanged(v_op.id,'application_pre_write_refusal',
        'The application refused this password operation before attempting any Cognito write.',
        jsonb_build_object('source','application_lifecycle','safe_error_code',left(coalesce(p_error_code,'provider_unavailable'),80)));
      return;
    end if;
    update public.authentication_lifecycle_operations set state='compensation_required',attempts=attempts+1,safe_error_code=left(coalesce(p_error_code,'provider_unavailable'),80),updated_at=now() where id=v_op.id;
    return;
  end if;
  select email into v_email from public.profiles where id=v_op.tracepoint_user_id;
  if v_op.operation_kind='assign_password' then
    update public.department_memberships set activation_status='activated'
      where department_id=v_op.department_id and user_id=v_op.tracepoint_user_id and is_active;
    update public.authentication_identity_links set state='active',updated_at=now()
      where provider='cognito' and tracepoint_user_id=v_op.tracepoint_user_id and provider_username=v_op.provider_username;
    update public.user_activation_tokens set revoked_at=coalesce(revoked_at,now())
      where department_id=v_op.department_id and user_id=v_op.tracepoint_user_id and used_at is null;
  end if;
  insert into public.authentication_identity_events(tracepoint_user_id,provider,issuer,subject,provider_username,event_type,actor_user_id,operation_id)
    select v_op.tracepoint_user_id,'cognito',l.issuer,l.subject,l.provider_username,
      case when v_op.operation_kind='assign_password' then 'password_assigned' else 'password_reset' end,v_op.actor_user_id,v_op.id
    from public.authentication_identity_links l where l.provider='cognito' and l.tracepoint_user_id=v_op.tracepoint_user_id;
  insert into public.audit_events(department_id,actor_user_id,action,entity_type,entity_id,summary,new_value)
    values(v_op.department_id,v_op.actor_user_id,case when v_op.operation_kind='assign_password' then 'user_password_assigned' else 'password_reset_sent' end,
      'department_membership',v_op.tracepoint_user_id,
      case when v_op.operation_kind='assign_password' then 'An administrator assigned a new password.' else 'An administrator initiated a Cognito password reset.' end,
      jsonb_build_object('target_user_id',v_op.tracepoint_user_id,'target_email',v_email,'identity_provider','cognito'));
  update public.authentication_lifecycle_operations set state='committed',attempts=attempts+1,safe_error_code=null,updated_at=now() where id=v_op.id;
end;$$;
revoke all on function tracepoint_auth.finish_cognito_password_operation(uuid,boolean,text,boolean) from public,anon,authenticated,service_role;
grant execute on function tracepoint_auth.finish_cognito_password_operation(uuid,boolean,text,boolean) to tracepoint_runtime;

commit;
