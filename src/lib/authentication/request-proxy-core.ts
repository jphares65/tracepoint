import { DEFAULT_RETURN_PATH, returnPathOrHome, safeReturnPath } from "./return-path";

const exactPublic = new Set(["/landing","/login","/api/health","/activate","/auth/confirm"]);
const exactCognito = new Set(["/api/auth/cognito/login","/api/auth/cognito/callback","/api/auth/cognito/refresh","/api/auth/cognito/logout","/api/auth/mobile/logout","/auth/signout"]);
export function isAwsNativePublicPath(pathname:string){const value=pathname.toLowerCase();return exactPublic.has(value)||exactCognito.has(value)||value.startsWith('/api/mobile/');}
// One validator (return-path.ts) for every post-sign-in destination.
export function safeRequestedPath(pathname:string,search:string){return returnPathOrHome(`${pathname}${search}`);}
export function sessionExpiryRedirectTarget(pathname:string,search:string){
 if(pathname==="/")return "/landing";
 if(pathname==="/login")return null;
 const next=safeReturnPath(`${pathname}${search}`);
 return next&&next!==DEFAULT_RETURN_PATH?`/login?next=${encodeURIComponent(next)}`:"/login";
}
export function loginRedirectTarget(search:string){
 return returnPathOrHome(new URLSearchParams(search).get("next"));
}
// A-65: a signed-out top-level browser navigation to an API URL (an export or
// attachment link, a bookmarked API URL) must not render a raw JSON document.
// fetch(), native and mobile callers never send this navigation pair, so they
// keep the JSON 401 contract.
export function isDocumentNavigation(headers:Pick<Headers,"get">){
 return headers.get("sec-fetch-mode")==="navigate"&&[null,"document"].includes(headers.get("sec-fetch-dest"));
}
export const API_NAVIGATION_SIGN_IN_TARGET="/login?notice=session_expired";
