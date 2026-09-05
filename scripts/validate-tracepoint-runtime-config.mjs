const requiredSecrets = ['SUPABASE_SECRET_KEY','BREVO_API_KEY','NOTIFICATION_DISPATCH_SECRET','NEXT_SERVER_ACTIONS_ENCRYPTION_KEY'];
const publicNames = ['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','NEXT_PUBLIC_SITE_URL'];
const providers = {TRACEPOINT_DATA_PROVIDER:'supabase',TRACEPOINT_EMAIL_PROVIDER:'brevo',TRACEPOINT_STORAGE_PROVIDER:'supabase'};
const targets = {
  staging: {site:'https://staging.tracepointhq.com',database:'https://wztqqqashilusoppddxi.supabase.co'},
  production: {site:'https://tracepointhq.com',database:'https://izlkwggluhlhzlumtzes.supabase.co'},
};
export function validateTracePointRuntimeConfig(environment=process.env) {
  const missing=[...requiredSecrets,...publicNames].filter(name=>typeof environment[name]!=='string'||!environment[name].trim());
  const invalidProviders=Object.entries(providers).filter(([name,value])=>environment[name]?.trim().toLowerCase()!==value).map(([name])=>name);
  const invalid=[];
  const target=targets[environment.CONFIGURATION_ENVIRONMENT];
  if(!target)invalid.push('CONFIGURATION_ENVIRONMENT');
  if(!target||environment.NEXT_PUBLIC_SITE_URL!==target.site)invalid.push('NEXT_PUBLIC_SITE_URL');
  if(!target||environment.NEXT_PUBLIC_SUPABASE_URL!==target.database)invalid.push('NEXT_PUBLIC_SUPABASE_URL');
  if(missing.length||invalidProviders.length||invalid.length) {
    throw new Error(`TracePoint runtime configuration is invalid (missing required variables: ${missing.join(', ')}; unsupported provider controls: ${invalidProviders.join(', ')}; invalid safe configuration: ${invalid.join(', ')}).`);
  }
}
