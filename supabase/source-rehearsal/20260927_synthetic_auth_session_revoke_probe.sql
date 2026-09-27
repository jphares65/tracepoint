-- Paid source-rehearsal only. Run only while the matching synthetic probe is
-- paused at PAID_AUTH_DB_SESSION_READY_FOR_EMAIL_DISABLE_AND_EXACT_SYNTHETIC_SESSION_REVOCATION.
-- This intentionally revokes ONE disposable user's ONE session. Never adapt
-- this statement into a broad production session deletion without a separate
-- reviewed production control and complete writer inventory.
BEGIN;
DO $$
DECLARE
  v_user_id uuid;
  v_user_count integer;
  v_session_count integer;
  v_refresh_count integer;
  v_deleted_count integer;
BEGIN
  SELECT count(*) INTO v_user_count
    FROM auth.users
   WHERE lower(email) = 'jphares+auth-db-session-fence-20260927@tracepointhq.com';
  IF v_user_count <> 1 THEN
    RAISE EXCEPTION 'SYNTHETIC_USER_COUNT_MISMATCH';
  END IF;
  SELECT id INTO v_user_id FROM auth.users
   WHERE lower(email) = 'jphares+auth-db-session-fence-20260927@tracepointhq.com';
  SELECT count(*) INTO v_session_count FROM auth.sessions WHERE user_id = v_user_id;
  IF v_session_count <> 1 THEN
    RAISE EXCEPTION 'SYNTHETIC_SESSION_COUNT_MISMATCH';
  END IF;
  SELECT count(*) INTO v_refresh_count
    FROM auth.refresh_tokens
   WHERE session_id IN (SELECT id FROM auth.sessions WHERE user_id = v_user_id);
  IF v_refresh_count <> 1 THEN
    RAISE EXCEPTION 'SYNTHETIC_REFRESH_COUNT_MISMATCH';
  END IF;
  DELETE FROM auth.sessions WHERE user_id = v_user_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count <> 1 THEN
    RAISE EXCEPTION 'SYNTHETIC_SESSION_DELETE_COUNT_MISMATCH';
  END IF;
  IF (SELECT count(*) FROM auth.sessions WHERE user_id = v_user_id) <> 0 OR
     (SELECT count(*) FROM auth.refresh_tokens WHERE user_id = v_user_id::text) <> 0 THEN
    RAISE EXCEPTION 'SYNTHETIC_SESSION_REVOCATION_FAILED';
  END IF;
END $$;
COMMIT;
