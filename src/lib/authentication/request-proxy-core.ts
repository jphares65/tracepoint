const exactPublic = new Set(["/landing","/login","/api/health","/activate","/auth/confirm"]);
const exactCognito = new Set(["/api/auth/cognito/login","/api/auth/cognito/callback","/api/auth/cognito/refresh","/api/auth/cognito/logout","/auth/signout"]);
export function isAwsNativePublicPath(pathname:string){return exactPublic.has(pathname.toLowerCase())||exactCognito.has(pathname.toLowerCase());}
export function safeRequestedPath(pathname:string,search:string){const value=`${pathname}${search}`;return value.startsWith("/")&&!value.startsWith("//")?value:"/";}
