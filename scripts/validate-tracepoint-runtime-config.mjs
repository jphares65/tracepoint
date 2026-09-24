const requiredSecrets = ['SUPABASE_SECRET_KEY','BREVO_API_KEY','NOTIFICATION_DISPATCH_SECRET','NEXT_SERVER_ACTIONS_ENCRYPTION_KEY'];
const publicNames = ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SITE_URL'];
const providers = {TRACEPOINT_DATA_PROVIDER:'supabase',TRACEPOINT_EMAIL_PROVIDER:'brevo',TRACEPOINT_STORAGE_PROVIDER:'supabase|s3'};
const targets = {
  staging: {site:'https://staging.tracepointhq.com',database:'https://wztqqqashilusoppddxi.supabase.co'},
  production: {site:'https://tracepointhq.com',database:'https://izlkwggluhlhzlumtzes.supabase.co'},
};
const legacyRuntimeName = /(^|_)(SUPABASE|BREVO|VERCEL)(_|$)/i;
const legacyRuntimeEndpoint = /\.supabase\.(?:co|net)|\.vercel\.app|(?:brevo|sendinblue)\.com/i;
const shadowDatabaseHost = 'tracepoint-production-migration-clean-4272874f-final.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const rehearsalDatabaseHost = 'tracepoint-production-migration-rehearsal-4272874f-20260923.c8r4sgs089tu.us-east-1.rds.amazonaws.com';
const rehearsalOrigin = 'https://shadow-rehearsal.tracepointhq.com';

function validateAwsNative(environment) {
  const invalid = [];
  const required = ['CONFIGURATION_ENVIRONMENT','NEXT_PUBLIC_SITE_URL','NEXT_SERVER_ACTIONS_ENCRYPTION_KEY',
    'TRACEPOINT_RUNTIME_PROVIDER_MODE','TRACEPOINT_DATA_PROVIDER','TRACEPOINT_AUTH_PROVIDER',
    'TRACEPOINT_EMAIL_PROVIDER','TRACEPOINT_STORAGE_PROVIDER','TRACEPOINT_NOTIFICATION_MODE',
    'AWS_REGION','TRACEPOINT_AWS_ACCOUNT_ID','TRACEPOINT_DATABASE_CA_PATH','TRACEPOINT_DATABASE_SECRET_JSON',
    'TRACEPOINT_AUTH_STATE_KEYS','TRACEPOINT_AUTH_REFRESH_KEYS','TRACEPOINT_COGNITO_USER_POOL_ID',
    'TRACEPOINT_COGNITO_CLIENT_ID','TRACEPOINT_S3_BUCKET','TRACEPOINT_S3_EXPECTED_OWNER'];
  const missing = required.filter(name => !environment[name]?.trim());
  const tuple = {TRACEPOINT_RUNTIME_PROVIDER_MODE:'aws-native',TRACEPOINT_DATA_PROVIDER:'postgres',
    TRACEPOINT_AUTH_PROVIDER:'cognito',TRACEPOINT_EMAIL_PROVIDER:'ses',TRACEPOINT_STORAGE_PROVIDER:'s3'};
  for (const [name, expected] of Object.entries(tuple)) if (environment[name] !== expected) invalid.push(name);
  if (!['shadow','normal'].includes(environment.TRACEPOINT_NOTIFICATION_MODE)) invalid.push('TRACEPOINT_NOTIFICATION_MODE');
  if (environment.TRACEPOINT_NOTIFICATION_MODE === 'normal') {
    for (const name of ['TRACEPOINT_SES_CONFIGURATION_SET','TRACEPOINT_FROM_EMAIL']) if (!environment[name]?.trim()) missing.push(name);
  }
  const stage = environment.CONFIGURATION_ENVIRONMENT;
  const account = environment.TRACEPOINT_AWS_ACCOUNT_ID;
  const shadow = environment.TRACEPOINT_NOTIFICATION_MODE === 'shadow';
  const rehearsal = environment.TRACEPOINT_REHEARSAL_APP_MODE === 'object-smoke';
  if (!targets[stage] || (shadow
    ? stage !== 'production' || !/^https:\/\/shadow(?:-[a-z0-9-]+)?\.tracepointhq\.com$/.test(environment.NEXT_PUBLIC_SITE_URL ?? '')
    : environment.NEXT_PUBLIC_SITE_URL !== targets[stage]?.site)) invalid.push('NEXT_PUBLIC_SITE_URL');
  if (!/^\d{12}$/.test(account ?? '') || account === '265544358665' ||
      (stage === 'staging' ? account !== '559054714699' : account === '559054714699')) invalid.push('TRACEPOINT_AWS_ACCOUNT_ID');
  if (environment.AWS_REGION !== 'us-east-1') invalid.push('AWS_REGION');
  if (environment.TRACEPOINT_S3_EXPECTED_OWNER !== account ||
      environment.TRACEPOINT_S3_BUCKET !== `tracepoint-${stage}-private-${account}`) invalid.push('TRACEPOINT_S3_BUCKET');
  if (!/^\/app\/[A-Za-z0-9._/-]+\.pem$/.test(environment.TRACEPOINT_DATABASE_CA_PATH ?? '')) invalid.push('TRACEPOINT_DATABASE_CA_PATH');
  let secret;
  try { secret = JSON.parse(environment.TRACEPOINT_DATABASE_SECRET_JSON ?? ''); } catch { invalid.push('TRACEPOINT_DATABASE_SECRET_JSON'); }
  if (!secret || typeof secret.host !== 'string' ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.rds(?:\.[a-z0-9-]+)?\.amazonaws\.com$/.test(secret.host) ||
      secret.port !== 5432 || secret.dbname !== 'tracepoint' ||
      !/^[a-z][a-z0-9_]{2,62}$/.test(secret.username ?? '') ||
      typeof secret.password !== 'string' || secret.password.length < 20) invalid.push('TRACEPOINT_DATABASE_SECRET_JSON');
  if (rehearsal && (!shadow || environment.NEXT_PUBLIC_SITE_URL !== rehearsalOrigin)) invalid.push('TRACEPOINT_REHEARSAL_APP_MODE');
  if (shadow && secret?.host !== (rehearsal ? rehearsalDatabaseHost : shadowDatabaseHost)) invalid.push('TRACEPOINT_DATABASE_SECRET_JSON');
  if (!new RegExp(`^${environment.AWS_REGION ?? 'invalid'}_[A-Za-z0-9]+$`).test(environment.TRACEPOINT_COGNITO_USER_POOL_ID ?? '') ||
      !/^[A-Za-z0-9]{1,128}$/.test(environment.TRACEPOINT_COGNITO_CLIENT_ID ?? '')) invalid.push('TRACEPOINT_COGNITO_USER_POOL_ID');
  for (const name of ['TRACEPOINT_AUTH_STATE_KEYS','TRACEPOINT_AUTH_REFRESH_KEYS']) {
    let ring;
    try { ring = JSON.parse(environment[name] ?? ''); } catch { invalid.push(name); }
    if (!ring || typeof ring.active !== 'string' || !ring.keys?.[ring.active] ||
        !/^[A-Za-z0-9_-]{43}$/.test(ring.keys[ring.active])) invalid.push(name);
  }
  for (const [name, value] of Object.entries(environment)) {
    if (value && (legacyRuntimeName.test(name) || legacyRuntimeEndpoint.test(value))) invalid.push(name);
  }
  if (missing.length || invalid.length) throw new Error(`TracePoint AWS-native runtime configuration is invalid (missing: ${[...new Set(missing)].join(', ')}; invalid: ${[...new Set(invalid)].join(', ')}).`);
}
export function validateTracePointRuntimeConfig(environment=process.env) {
  if (environment.TRACEPOINT_RUNTIME_PROVIDER_MODE === 'aws-native' || environment.TRACEPOINT_DATA_PROVIDER === 'postgres') {
    return validateAwsNative(environment);
  }
  const missing=[...requiredSecrets,...publicNames].filter(name=>typeof environment[name]!=='string'||!environment[name].trim());
  const invalidProviders=Object.entries(providers).filter(([name,value])=>!value.split('|').includes(environment[name]?.trim().toLowerCase())).map(([name])=>name);
  const invalid=[];
  if(environment.TRACEPOINT_STORAGE_PROVIDER?.trim().toLowerCase()==='s3') {
    const account=environment.TRACEPOINT_S3_EXPECTED_OWNER, stage=environment.CONFIGURATION_ENVIRONMENT;
    if(!account||!/^\d{12}$/.test(account)||account==='265544358665'||(stage==='staging'?account!=='559054714699':stage!=='production'||account==='559054714699'))invalid.push('TRACEPOINT_S3_EXPECTED_OWNER');
    if(environment.AWS_REGION!=='us-east-1')invalid.push('AWS_REGION');
    if(environment.TRACEPOINT_S3_BUCKET!=='tracepoint-'+stage+'-private-'+account)invalid.push('TRACEPOINT_S3_BUCKET');
  }
  const target=targets[environment.CONFIGURATION_ENVIRONMENT];
  if(!target)invalid.push('CONFIGURATION_ENVIRONMENT');
  if(!target||environment.NEXT_PUBLIC_SITE_URL!==target.site)invalid.push('NEXT_PUBLIC_SITE_URL');
  if(!target||environment.NEXT_PUBLIC_SUPABASE_URL!==target.database)invalid.push('NEXT_PUBLIC_SUPABASE_URL');
  if(missing.length||invalidProviders.length||invalid.length) {
    throw new Error(`TracePoint runtime configuration is invalid (missing required variables: ${missing.join(', ')}; unsupported provider controls: ${invalidProviders.join(', ')}; invalid safe configuration: ${invalid.join(', ')}).`);
  }
}
