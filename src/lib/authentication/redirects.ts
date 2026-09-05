// Shared by Supabase callbacks/setup and the prepared authentication boundary.
export function internalAuthRedirect(value:string|null|undefined,fallback='/'):string {
 if(!value)return fallback;
 try {
  const decoded=decodeURIComponent(value);
  if(!decoded.startsWith('/')||decoded.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(decoded))return fallback;
  const target=new URL(decoded,'https://tracepoint.invalid');
  if(target.origin!=='https://tracepoint.invalid')return fallback;
  return target.pathname+target.search+target.hash;
 } catch {return fallback;}
}

// Email links must use deployment configuration, never caller-controlled
// Origin/Host/X-Forwarded-Host headers.
export function configuredSiteOrigin(value:string|undefined):string {
 try {
  if(!value)throw Error();const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)throw Error();
  return url.origin;
 } catch {throw new Error('A trusted HTTPS application site URL is required for authentication email.');}
}
