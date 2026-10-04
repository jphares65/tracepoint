const exactPublic = new Set(["/landing","/login","/api/health","/activate","/auth/confirm"]);
const exactCognito = new Set(["/api/auth/cognito/login","/api/auth/cognito/callback","/api/auth/cognito/refresh","/api/auth/cognito/logout","/api/auth/mobile/logout","/auth/signout"]);
export function isAwsNativePublicPath(pathname:string){const value=pathname.toLowerCase();return exactPublic.has(value)||exactCognito.has(value)||value.startsWith('/api/mobile/');}
export function safeRequestedPath(pathname:string,search:string){const value=`${pathname}${search}`;return value.startsWith("/")&&!value.startsWith("//")?value:"/";}
export function sessionExpiryRedirectTarget(pathname:string,search:string){
 if(pathname==="/")return "/landing";
 if(pathname==="/login")return null;
 return `/login?next=${encodeURIComponent(safeRequestedPath(pathname,search))}`;
}
export function loginRedirectTarget(search:string){
 const next=new URLSearchParams(search).get("next")??"/";
 return next.startsWith("/")&&!next.startsWith("//")?next:"/";
}
