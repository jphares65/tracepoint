begin;

-- B8a contract step for 053. Apply only after the B8a (or later) image is
-- verified and the owner has closed the image rollback window
-- (docs/remediation/STAGING-VERIFICATION.md §5a). Firearm status history is
-- then written only by change_firearm_status, with the change, as the
-- signed-in actor; users can no longer insert, change or delete it directly.
-- After this file, an image rollback below B8a requires the forward restore
-- migration first (RELEASE-SAFETY-rollback-compatibility.md §4 step 7):
-- older images insert firearm history directly.
do $$
begin
  if to_regprocedure('public.change_firearm_status(uuid,uuid,text,text,text)') is null then
    raise exception '054 requires change_firearm_status from 053';
  end if;
end;
$$;

drop policy if exists firearm_status_history_insert_managers on public.firearm_status_history;
revoke insert, update, delete on public.firearm_status_history from authenticated;

commit;
