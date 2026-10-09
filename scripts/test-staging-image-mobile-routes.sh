#!/usr/bin/env bash
set -euo pipefail

image="$1"
name="tracepoint-mobile-route-contract-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# These are syntactically valid, non-secret values. Invalid bearer tokens are rejected
# before any database, Cognito, or storage call, so this proves the exact final image's
# routing and bearer boundary without contacting a real provider.
key='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
ring="{\"active\":\"k1\",\"keys\":{\"k1\":\"$key\"}}"
database='{"host":"synthetic.cluster-abcdefghijkl.us-east-1.rds.amazonaws.com","port":5432,"dbname":"tracepoint","username":"synthetic_user","password":"AAAAAAAAAAAAAAAAAAAA"}'

docker run -d --name "$name" --read-only --user 65532:65532 \
  --mount type=volume,destination=/app/.next/cache \
  --mount type=volume,destination=/tmp \
  -p 127.0.0.1:3100:3000 \
  -e CONFIGURATION_ENVIRONMENT=staging \
  -e NEXT_PUBLIC_SITE_URL=https://staging.tracepointhq.com \
  -e NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$key" \
  -e TRACEPOINT_RUNTIME_PROVIDER_MODE=aws-native \
  -e TRACEPOINT_DATA_PROVIDER=postgres \
  -e TRACEPOINT_AUTH_PROVIDER=cognito \
  -e TRACEPOINT_EMAIL_PROVIDER=ses \
  -e TRACEPOINT_STORAGE_PROVIDER=s3 \
  -e TRACEPOINT_NOTIFICATION_MODE=normal \
  -e TRACEPOINT_SES_CONFIGURATION_SET=synthetic \
  -e TRACEPOINT_FROM_EMAIL=synthetic@example.invalid \
  -e AWS_REGION=us-east-1 \
  -e TRACEPOINT_AWS_ACCOUNT_ID=559054714699 \
  -e TRACEPOINT_DATABASE_CA_PATH=/app/rds-ca.pem \
  -e TRACEPOINT_DATABASE_SECRET_JSON="$database" \
  -e TRACEPOINT_AUTH_STATE_KEYS="$ring" \
  -e TRACEPOINT_AUTH_REFRESH_KEYS="$ring" \
  -e TRACEPOINT_COGNITO_USER_POOL_ID=us-east-1_Synthetic \
  -e TRACEPOINT_COGNITO_CLIENT_ID=syntheticclient \
  -e TRACEPOINT_COGNITO_MOBILE_CLIENT_ID=syntheticmobileclient \
  -e TRACEPOINT_S3_BUCKET=tracepoint-staging-private-559054714699 \
  -e TRACEPOINT_S3_EXPECTED_OWNER=559054714699 \
  "$image" >/dev/null

for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:3100/api/health >/dev/null; then break; fi
  if [ "$attempt" = 30 ]; then docker logs "$name" >&2; exit 1; fi
  sleep 1
done

for pair in 'POST /api/mobile/session' 'GET /api/mobile/range-days' 'GET /api/mobile/range-workspace'; do
  method=${pair%% *}; path=${pair#* }
  status=$(curl --silent --output /dev/null --write-out '%{http_code}' --request "$method" --header 'authorization: Bearer invalid-staging-token' "http://127.0.0.1:3100$path")
  case "$status" in 401|403) ;; *) echo "Mobile route contract failed for $path: expected 401/403, got $status" >&2; exit 1;; esac
done

echo 'Exact immutable image mobile route and invalid-bearer contract passed.'
