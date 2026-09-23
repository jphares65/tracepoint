-- Quarantined AWS-native target only. Keep the existing lower bound and
-- replace only the six-minute upper bound with the approved ten-minute bound.
ALTER TABLE public.authentication_flow_transactions
  DROP CONSTRAINT authentication_flow_transactions_check;
ALTER TABLE public.authentication_flow_transactions
  ADD CONSTRAINT authentication_flow_transactions_check
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes');
