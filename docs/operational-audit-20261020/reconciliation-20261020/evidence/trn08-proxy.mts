// TRN-08: can a bearer-only scheduler reach the dispatcher in each runtime mode?
import { readFileSync } from "node:fs";
const CUR = process.argv[2];
const { isAwsNativePublicPath } = await import(`${CUR}/src/lib/authentication/request-proxy-core.ts`);
const legacy = readFileSync(`${CUR}/src/lib/supabase/proxy.ts`, "utf8").match(/const PUBLIC_PATHS = (\[[^\]]*\])/)![1];
const legacyPublic: string[] = JSON.parse(legacy);
const matcher = readFileSync(`${CUR}/src/proxy.ts`, "utf8").match(/"(\/\(\(\?![^"]+)"/)![1].replace(/\\\\/g, "\\");
const re = new RegExp(`^${matcher}$`);
const p = "/api/notifications/email-dispatch";
console.log(`proxy matcher applies to ${p}: ${re.test(p)}`);
console.log(`bridge (Supabase) proxy treats it as public: ${legacyPublic.includes(p)}`);
console.log(`aws-native proxy treats it as public: ${isAwsNativePublicPath(p)}`);
console.log(`aws-native proxy treats /api/mobile/inbox as public (bearer handled in route): ${isAwsNativePublicPath("/api/mobile/inbox")}`);
console.log("=> In aws-native mode a request with only 'Authorization: Bearer <NOTIFICATION_DISPATCH_SECRET>' and no Cognito session cookie is answered 401 by updateAwsNativeSession (request-proxy.ts:51-52, 17-18) before route.ts:195-208 checks the secret.");
