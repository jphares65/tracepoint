const requiredSecrets = ['SUPABASE_SECRET_KEY','BREVO_API_KEY','NOTIFICATION_DISPATCH_SECRET','NEXT_SERVER_ACTIONS_ENCRYPTION_KEY'];
const publicNames = ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SITE_URL'];
const providers = {TRACEPOINT_DATA_PROVIDER:'supabase',TRACEPOINT_EMAIL_PROVIDER:'brevo',TRACEPOINT_STORAGE_PROVIDER:'supabase|s3'};
const targets = {
  staging: {site:'https://staging.tracepointhq.com',database:'https://wztqqqashilusoppddxi.supabase.co'},
  production: {site:'https://tracepointhq.com',database:'https://izlkwggluhlhzlumtzes.supabase.co'},
};
export function validateTracePointRuntimeConfig(environment=process.env) {
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
