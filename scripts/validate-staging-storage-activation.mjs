import {createClient} from '@supabase/supabase-js';
try{
 let input='';for await(const chunk of process.stdin)input+=chunk;
 let secret;try{secret=JSON.parse(input);}catch{throw new Error('Invalid staging configuration');}
 if(secret.CONFIGURATION_ENVIRONMENT!=='staging'||secret.NEXT_PUBLIC_SUPABASE_URL!=='https://wztqqqashilusoppddxi.supabase.co')throw new Error('Source target mismatch');
 const client=createClient(secret.NEXT_PUBLIC_SUPABASE_URL,secret.SUPABASE_SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 for(const bucket of ['tracepoint-attachments','department-assets']){const result=await client.storage.from(bucket).list('',{limit:1});if(result.error||result.data.length)throw new Error('Source must be empty before automatic activation');}
 console.log('Staging source storage is empty; no existing files require transfer.');
}catch{console.error('Staging storage activation gate failed; sensitive details suppressed.');process.exitCode=1;}
