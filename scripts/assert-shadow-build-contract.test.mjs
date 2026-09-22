import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('shadow image uses the established official regional RDS CA and packages it for the non-root runtime', () => {
  const docker = read('Dockerfile.shadow');
  const rehearsal = read('Dockerfile.postgres-rehearsal');
  const source = 'https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem';
  assert.ok(rehearsal.includes(source));
  assert.ok(docker.includes(`ADD ${source} /app/rds-ca.pem`));
  assert.match(docker, /COPY --from=builder --chown=nonroot:nonroot \/app\/rds-ca\.pem \/app\/rds-ca\.pem/);
  assert.match(docker, /RUN test -r \/app\/rds-ca\.pem && grep -q 'BEGIN CERTIFICATE'/);
  assert.match(read('src/lib/database/postgres-pool.ts'), /ssl: \{ ca, rejectUnauthorized: true \}/);
  assert.doesNotMatch(docker, /SUPABASE|rejectUnauthorized=false|NODE_TLS_REJECT_UNAUTHORIZED/i);
});

test('shadow build is commit-immutable and has no Supabase URL or key dependency', () => {
  const build = read('buildspec.aws-native-shadow.yml');
  assert.match(build, /test "\$IMAGE_TAG" = "\$SOURCE_COMMIT"/);
  assert.match(build, /Dockerfile\.shadow/);
  assert.match(build, /\^https:\/\/shadow/);
  assert.match(build, /test -z "\$\{NEXT_PUBLIC_SUPABASE_URL:-\}"/);
  assert.match(build, /test -z "\$\{NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-\}"/);
  assert.doesNotMatch(build, /--build-arg NEXT_PUBLIC_SUPABASE|SUPABASE_SECRET_KEY/);
  assert.match(build, /docker run --rm --read-only --entrypoint \/nodejs\/bin\/node/);
});

test('Docker build context exposes only the shared production-target contract from infra', () => {
  const ignore = read('.dockerignore');
  const docker = read('Dockerfile.shadow');
  assert.match(ignore, /^infra\/\*\*$/m);
  assert.match(ignore, /^!infra\/lib\/$/m);
  assert.match(ignore, /^!infra\/lib\/production-target\.ts$/m);
  assert.doesNotMatch(ignore, /^!infra\/(?:\*|\*\*|lib\/\*|lib\/\*\*)\s*$/m);
  assert.match(docker, /^COPY \. \.$/m);
  assert.doesNotMatch(docker, /^COPY (?:--from=builder\s+)?(?:\/app\/)?infra\//m);
});
